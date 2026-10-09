//! Conservative, ephemeral broker cookies. No cookie data enters the renderer.
//! Deliberately origin-bound (including port), even for Domain cookies. This is
//! stricter than RFC 6265 host/domain scope until public-suffix/site support exists.
use std::time::{Duration, SystemTime};
use url::Url;
const MAX_COOKIES: usize = 128;
const MAX_BYTES: usize = 64 * 1024;
const MAX_HEADER: usize = 16 * 1024;
#[derive(Clone, Copy, PartialEq, Eq)]
enum SameSite {
    Strict,
    Lax,
    None,
}
struct Cookie {
    origin: String,
    path: String,
    name: String,
    value: String,
    same_site: SameSite,
    expires: Option<SystemTime>,
    order: u64,
}
#[derive(Default)]
pub struct Jar {
    entries: Vec<Cookie>,
    sequence: u64,
}
impl Jar {
    pub fn store(
        &mut self,
        url: &Url,
        headers: &[String],
        initiator: Option<&Url>,
        top_level: bool,
    ) {
        let now = SystemTime::now();
        self.prune(now);
        if url.scheme() != "https"
            || (!top_level && initiator.is_none_or(|u| u.origin() != url.origin()))
        {
            return;
        }
        for header in headers.iter().take(32) {
            self.store_one(url, header, now);
        }
    }
    fn store_one(&mut self, url: &Url, header: &str, now: SystemTime) {
        if header.len() > 4096 || !header.is_ascii() || header.bytes().any(|b| b < 32 || b == 127) {
            return;
        }
        let mut pieces = header.split(';');
        let Some((name, value)) = pieces.next().and_then(|s| s.trim().split_once('=')) else {
            return;
        };
        let name = name.trim();
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .unwrap_or(value);
        if name.is_empty()
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            || value
                .bytes()
                .any(|b| b <= 32 || b >= 127 || b"\",;\\".contains(&b))
        {
            return;
        }
        let mut path = default_path(url.path()).to_string();
        let mut explicit_path = false;
        let mut same_site = SameSite::Lax;
        let mut secure = false;
        let mut domain = None;
        let mut expires = None;
        let mut max_age = None;
        for piece in pieces {
            let (key, value) = piece.trim().split_once('=').unwrap_or((piece.trim(), ""));
            match key.trim().to_ascii_lowercase().as_str() {
                "secure" => secure = true,
                "domain" => {
                    domain = Some(value.trim().trim_start_matches('.').to_ascii_lowercase())
                }
                "path" if value.starts_with('/') => {
                    path = value.to_string();
                    explicit_path = true;
                }
                "expires" => {
                    if let Ok(time) = httpdate::parse_http_date(value.trim()) {
                        expires = Some(time);
                    }
                }
                "max-age" => {
                    let value = value.trim();
                    let digits = value.strip_prefix('-').unwrap_or(value);
                    if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
                        if let Ok(age) = value.parse::<i64>() {
                            max_age = Some(age);
                        }
                    }
                }
                "samesite" => {
                    same_site = match value.trim().to_ascii_lowercase().as_str() {
                        "strict" => SameSite::Strict,
                        "none" => SameSite::None,
                        _ => SameSite::Lax,
                    }
                }
                _ => (), // HttpOnly is implicit: there is no script cookie API.
            }
        }
        if let Some(domain) = &domain {
            let host = url.host_str().unwrap_or("");
            if domain.is_empty()
                || (host != domain
                    && (!host.ends_with(&format!(".{domain}"))
                        || host.parse::<std::net::IpAddr>().is_ok()))
            {
                return;
            }
        }
        if (same_site == SameSite::None || name.starts_with("__Secure-")) && !secure {
            return;
        }
        if name.starts_with("__Host-")
            && (!secure || domain.is_some() || path != "/" || !explicit_path)
        {
            return;
        }
        if let Some(age) = max_age {
            expires = Some(if age <= 0 {
                SystemTime::UNIX_EPOCH
            } else {
                now.checked_add(Duration::from_secs((age as u64).min(400 * 86400)))
                    .unwrap_or(now)
            });
        }
        let origin = url.origin().ascii_serialization();
        let old = self
            .entries
            .iter()
            .position(|c| c.origin == origin && c.path == path && c.name == name);
        let order = old
            .map(|i| self.entries.remove(i).order)
            .unwrap_or_else(|| {
                self.sequence += 1;
                self.sequence
            });
        if expires.is_some_and(|expiry| expiry <= now) {
            return;
        }
        self.entries.push(Cookie {
            origin,
            path,
            name: name.to_string(),
            value: value.to_string(),
            same_site,
            expires,
            order,
        });
        while self.entries.len() > MAX_COOKIES
            || self
                .entries
                .iter()
                .map(|c| c.origin.len() + c.path.len() + c.name.len() + c.value.len())
                .sum::<usize>()
                > MAX_BYTES
        {
            let oldest = self
                .entries
                .iter()
                .enumerate()
                .min_by_key(|(_, c)| c.order)
                .map(|(i, _)| i)
                .unwrap();
            self.entries.remove(oldest);
        }
    }
    pub fn header(
        &mut self,
        url: &Url,
        initiator: Option<&Url>,
        top_level: bool,
        post: bool,
    ) -> String {
        self.prune(SystemTime::now());
        let same_origin = initiator.is_none_or(|u| u.origin() == url.origin());
        if url.scheme() != "https"
            || (!top_level && initiator.is_none_or(|u| u.origin() != url.origin()))
            || (post && initiator.is_none())
        {
            return String::new();
        }
        let origin = url.origin().ascii_serialization();
        let mut matches: Vec<_> = self
            .entries
            .iter()
            .filter(|c| {
                c.origin == origin
                    && path_matches(url.path(), &c.path)
                    && (same_origin || (top_level && !post && c.same_site != SameSite::Strict))
            })
            .collect();
        matches.sort_by(|a, b| b.path.len().cmp(&a.path.len()).then(a.order.cmp(&b.order)));
        let mut header = String::new();
        for cookie in matches {
            let extra =
                cookie.name.len() + cookie.value.len() + 1 + if header.is_empty() { 0 } else { 2 };
            if header.len() + extra > MAX_HEADER {
                break;
            }
            if !header.is_empty() {
                header.push_str("; ");
            }
            header.push_str(&cookie.name);
            header.push('=');
            header.push_str(&cookie.value);
        }
        header
    }
    fn prune(&mut self, now: SystemTime) {
        self.entries
            .retain(|c| c.expires.is_none_or(|expires| expires > now));
    }
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}
fn default_path(path: &str) -> &str {
    path.rsplit_once('/')
        .filter(|(p, _)| !p.is_empty())
        .map_or("/", |(p, _)| p)
}
fn path_matches(request: &str, cookie: &str) -> bool {
    request == cookie
        || (request.starts_with(cookie)
            && (cookie.ends_with('/') || request.as_bytes().get(cookie.len()) == Some(&b'/')))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn url(input: &str) -> Url {
        Url::parse(input).unwrap()
    }
    fn store(jar: &mut Jar, source: &Url, cookie: &str) {
        jar.store(source, &[cookie.into()], Some(source), true);
    }
    #[test]
    fn origin_and_path_scoping_prevent_cookie_leaks() {
        let source = url("https://www.example.com/account/login");
        let mut jar = Jar::default();
        store(
            &mut jar,
            &source,
            "session=abc; Domain=example.com; HttpOnly; Secure",
        );
        assert_eq!(
            jar.header(
                &url("https://www.example.com/account/home"),
                Some(&source),
                true,
                false
            ),
            "session=abc"
        );
        for other in [
            "https://www.example.com/accounting",
            "https://other.example.com/account",
            "https://www.example.com:8443/account",
            "https://evil.com/account",
        ] {
            assert!(jar
                .header(&url(other), Some(&source), true, false)
                .is_empty());
        }
        store(&mut jar, &source, "attack=bad; Domain=evil.com; Path=/");
        assert!(!jar
            .header(&source, Some(&source), true, false)
            .contains("attack="));
    }
    #[test]
    fn expiration_replacement_deletion_and_max_age_precedence() {
        let source = url("https://example.com/");
        let mut jar = Jar::default();
        store(&mut jar, &source, "session=old; Path=/");
        store(&mut jar, &source, "session=new; Path=/");
        assert_eq!(jar.entries.len(), 1);
        assert_eq!(
            jar.header(&source, Some(&source), true, false),
            "session=new"
        );
        store(&mut jar, &source, "session=; Path=/; Max-Age=0");
        assert!(jar.entries.is_empty());
        store(
            &mut jar,
            &source,
            "session=x; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        );
        assert!(jar.entries.is_empty());
        store(
            &mut jar,
            &source,
            "session=x; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=60",
        );
        assert_eq!(jar.entries.len(), 1);
        store(
            &mut jar,
            &source,
            "session=x; Path=/; Max-Age=0; Max-Age=999999999999999999999999",
        );
        assert!(jar.entries.is_empty());
    }
    #[test]
    fn strict_lax_and_third_party_request_policies() {
        let source = url("https://example.com/");
        let other = url("https://other.example/");
        let mut jar = Jar::default();
        store(
            &mut jar,
            &source,
            "strict=s; SameSite=Strict; Path=/; Secure",
        );
        store(&mut jar, &source, "lax=l; Path=/; Secure");
        assert_eq!(jar.header(&source, Some(&other), true, false), "lax=l");
        assert!(jar.header(&source, Some(&other), true, true).is_empty());
        assert!(jar.header(&source, Some(&other), false, false).is_empty());
        assert!(jar.header(&source, None, false, false).is_empty());
        jar.store(&source, &["third=x; Path=/".into()], Some(&other), false);
        assert!(!jar
            .header(&source, Some(&source), true, false)
            .contains("third="));
    }
    #[test]
    fn secure_prefixes_and_header_injection_are_rejected() {
        let source = url("https://example.com/");
        let mut jar = Jar::default();
        for cookie in [
            "bad=x\r\nX-Test: injected",
            "bad=x,y",
            "bad=x y",
            "__Secure-x=v",
            "__Host-x=v; Secure",
            "__Host-x=v; Secure; Path=/; Domain=example.com",
            "none=v; SameSite=None",
        ] {
            store(&mut jar, &source, cookie);
        }
        assert!(jar.entries.is_empty());
        store(&mut jar, &source, "__Host-good=v; Secure; Path=/; HttpOnly");
        assert_eq!(jar.entries.len(), 1);
    }
    #[test]
    fn jar_size_and_clear_are_bounded() {
        let source = url("https://example.com/");
        let mut jar = Jar::default();
        for n in 0..200 {
            store(
                &mut jar,
                &source,
                &format!("k{n}={}; Path=/", "x".repeat(1000)),
            );
        }
        assert!(jar.entries.len() <= MAX_COOKIES);
        assert!(
            jar.entries
                .iter()
                .map(|c| c.origin.len() + c.path.len() + c.name.len() + c.value.len())
                .sum::<usize>()
                <= MAX_BYTES
        );
        assert!(jar.header(&source, Some(&source), true, false).len() <= MAX_HEADER);
        jar.clear();
        assert!(jar.entries.is_empty());
    }
    #[test]
    fn longer_paths_are_sent_first_and_matching_respects_boundaries() {
        let source = url("https://example.com/a/b");
        let mut jar = Jar::default();
        store(&mut jar, &source, "id=root; Path=/");
        store(&mut jar, &source, "id=area; Path=/a");
        assert_eq!(
            jar.header(&source, Some(&source), true, false),
            "id=area; id=root"
        );
        assert!(!path_matches("/abc", "/a"));
        assert!(path_matches("/a/b", "/a"));
    }
}
