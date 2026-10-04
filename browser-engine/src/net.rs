use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use std::error::Error;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;
use url::Url;

const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_URL_BYTES: usize = 8 * 1024;
const MAX_REDIRECTS: usize = 8;
const IO_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
    pub final_url: String,
}

#[derive(Debug)]
struct RawResponse {
    status: u16,
    body: Vec<u8>,
    location: Option<String>,
}

pub fn fetch_https(input: &str) -> Result<HttpResponse, Box<dyn Error>> {
    let mut current = parse_secure_url(input)?;
    let mut visited = Vec::with_capacity(MAX_REDIRECTS + 1);

    for redirect_count in 0..=MAX_REDIRECTS {
        let normalized = current.as_str().to_string();
        if visited.iter().any(|item| item == &normalized) {
            return Err("redirect loop detected".into());
        }
        visited.push(normalized);

        let response = fetch_once(&current)?;

        if !is_redirect(response.status) {
            return Ok(HttpResponse {
                status: response.status,
                body: response.body,
                final_url: current.to_string(),
            });
        }

        if redirect_count == MAX_REDIRECTS {
            return Err("too many redirects".into());
        }

        let location = response
            .location
            .as_deref()
            .ok_or("redirect response did not contain a Location header")?;
        let next = current.join(location)?;

        if next.scheme() != "https" {
            return Err("redirect to a non-HTTPS URL was blocked".into());
        }
        if next.as_str().len() > MAX_URL_BYTES {
            return Err("redirect URL exceeded the safety limit".into());
        }

        current = next;
    }

    Err("redirect handling terminated unexpectedly".into())
}

pub fn resolve_https_url(base: &str, href: &str) -> Result<String, Box<dyn Error>> {
    if href.len() > MAX_URL_BYTES {
        return Err("link URL exceeded the safety limit".into());
    }

    let base = parse_secure_url(base)?;
    let resolved = base.join(href.trim())?;

    if resolved.scheme() != "https" {
        return Err("navigation to a non-HTTPS URL was blocked".into());
    }
    if resolved.as_str().len() > MAX_URL_BYTES {
        return Err("resolved URL exceeded the safety limit".into());
    }

    Ok(resolved.to_string())
}

fn parse_secure_url(input: &str) -> Result<Url, Box<dyn Error>> {
    if input.len() > MAX_URL_BYTES {
        return Err("URL exceeded the safety limit".into());
    }

    let url = Url::parse(input)?;
    if url.scheme() != "https" {
        return Err("only https:// URLs are allowed".into());
    }
    if url.host_str().is_none() {
        return Err("URL does not contain a valid host".into());
    }

    Ok(url)
}

fn fetch_once(url: &Url) -> Result<RawResponse, Box<dyn Error>> {
    let host = url
        .host_str()
        .ok_or("URL does not contain a valid host")?
        .to_string();
    let port = url.port_or_known_default().unwrap_or(443);

    let mut path = url.path().to_string();
    if path.is_empty() {
        path.push('/');
    }
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }

    let address = format!("{host}:{port}");
    let tcp = TcpStream::connect(address)?;
    tcp.set_read_timeout(Some(IO_TIMEOUT))?;
    tcp.set_write_timeout(Some(IO_TIMEOUT))?;

    let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();

    let server_name = ServerName::try_from(host.clone())
        .map_err(|_| "host name cannot be used for TLS verification")?;
    let connection = ClientConnection::new(Arc::new(config), server_name)?;
    let mut tls = StreamOwned::new(connection, tcp);

    let host_header = if port == 443 {
        host.clone()
    } else {
        format!("{host}:{port}")
    };

    let request = format!(
        "GET {path} HTTP/1.1\r\n\
         Host: {host_header}\r\n\
         User-Agent: browser-core/0.5\r\n\
         Accept: text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5\r\n\
         Accept-Encoding: identity\r\n\
         Connection: close\r\n\
         \r\n"
    );

    tls.write_all(request.as_bytes())?;
    tls.flush()?;

    let mut raw = Vec::with_capacity(32 * 1024);
    let mut chunk = [0_u8; 8192];

    loop {
        let read = tls.read(&mut chunk)?;
        if read == 0 {
            break;
        }

        if raw.len().saturating_add(read) > MAX_RESPONSE_BYTES {
            return Err(format!(
                "response exceeded the {} byte safety limit",
                MAX_RESPONSE_BYTES
            )
            .into());
        }

        raw.extend_from_slice(&chunk[..read]);
    }

    parse_http_response(&raw)
}

fn parse_http_response(raw: &[u8]) -> Result<RawResponse, Box<dyn Error>> {
    let header_end = find_bytes(raw, b"\r\n\r\n")
        .ok_or("invalid HTTP response: header terminator not found")?;
    let header_bytes = &raw[..header_end];
    let body_bytes = &raw[header_end + 4..];
    let headers = std::str::from_utf8(header_bytes)?;

    let mut lines = headers.lines();
    let status_line = lines.next().ok_or("missing HTTP status line")?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .ok_or("missing HTTP status code")?
        .parse::<u16>()?;

    let mut chunked = false;
    let mut content_length: Option<usize> = None;
    let mut location: Option<String> = None;

    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };

        if name.eq_ignore_ascii_case("transfer-encoding")
            && value.to_ascii_lowercase().contains("chunked")
        {
            chunked = true;
        }

        if name.eq_ignore_ascii_case("content-length") {
            if let Ok(length) = value.trim().parse::<usize>() {
                content_length = Some(length);
            }
        }

        if name.eq_ignore_ascii_case("location") {
            let value = value.trim();
            if value.len() <= MAX_URL_BYTES {
                location = Some(value.to_string());
            }
        }
    }

    if let Some(length) = content_length {
        if length > MAX_RESPONSE_BYTES {
            return Err("Content-Length exceeds the browser safety limit".into());
        }
    }

    let body = if chunked {
        decode_chunked(body_bytes)?
    } else {
        let end = content_length
            .map(|length| length.min(body_bytes.len()))
            .unwrap_or(body_bytes.len());
        body_bytes[..end].to_vec()
    };

    Ok(RawResponse {
        status,
        body,
        location,
    })
}

fn is_redirect(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

fn decode_chunked(input: &[u8]) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut output = Vec::new();
    let mut cursor = 0;

    loop {
        let line_end_rel = find_bytes(&input[cursor..], b"\r\n")
            .ok_or("invalid chunked body: missing chunk-size terminator")?;
        let line_end = cursor + line_end_rel;
        let size_text = std::str::from_utf8(&input[cursor..line_end])?;
        let size_text = size_text.split(';').next().unwrap_or(size_text).trim();
        let size = usize::from_str_radix(size_text, 16)?;

        cursor = line_end + 2;

        if size == 0 {
            break;
        }

        if size > MAX_RESPONSE_BYTES
            || output.len().saturating_add(size) > MAX_RESPONSE_BYTES
            || cursor.saturating_add(size + 2) > input.len()
        {
            return Err("invalid or oversized chunked body".into());
        }

        output.extend_from_slice(&input[cursor..cursor + size]);
        cursor += size;

        if input.get(cursor..cursor + 2) != Some(b"\r\n") {
            return Err("invalid chunked body: missing chunk terminator".into());
        }
        cursor += 2;
    }

    Ok(output)
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_response() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello";
        let response = parse_http_response(raw).unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, b"hello");
    }

    #[test]
    fn parses_chunked_response() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n";
        let response = parse_http_response(raw).unwrap();
        assert_eq!(response.body, b"hello");
    }

    #[test]
    fn captures_redirect_location() {
        let raw = b"HTTP/1.1 302 Found\r\nLocation: /next\r\nContent-Length: 0\r\n\r\n";
        let response = parse_http_response(raw).unwrap();
        assert_eq!(response.status, 302);
        assert_eq!(response.location.as_deref(), Some("/next"));
    }

    #[test]
    fn resolves_relative_secure_links() {
        assert_eq!(
            resolve_https_url("https://example.com/a/page", "../next").unwrap(),
            "https://example.com/next"
        );
    }

    #[test]
    fn blocks_insecure_navigation() {
        assert!(resolve_https_url("https://example.com/", "http://example.com/").is_err());
    }
}
