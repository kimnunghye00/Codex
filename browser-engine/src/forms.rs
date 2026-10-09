//! Broker-owned editing and validated, explicit user-initiated form submission.
use crate::{ipc::*, net};
use url::Url;

pub fn editable(field: &PaintControl) -> bool {
    matches!(field.kind, FIELD_TEXT | FIELD_PASSWORD)
        && field.flags & (DISABLED | READ_ONLY) == 0
        && field.rect.width != 0
}
pub fn focusable(field: &PaintControl) -> bool {
    field.kind != FIELD_HIDDEN
        && field.kind != FIELD_UNSUPPORTED
        && field.flags & DISABLED == 0
        && field.rect.width != 0
}
pub fn append(field: &mut PaintControl, input: &str, replace: bool) -> bool {
    if !editable(field) || input.chars().any(|c| c.is_control()) {
        return false;
    }
    let current = if replace { "" } else { &field.value };
    if current.len().saturating_add(input.len()) > MAX_FIELD_BYTES
        || current
            .chars()
            .count()
            .saturating_add(input.chars().count())
            > field.max_length as usize
    {
        return false;
    }
    if replace {
        field.value.clear();
    }
    field.value.push_str(input);
    true
}
pub fn next_focus(
    controls: &[PaintControl],
    current: Option<usize>,
    backwards: bool,
) -> Option<usize> {
    let len = controls.len();
    if len == 0 {
        return None;
    }
    let start = current.unwrap_or(if backwards { 0 } else { len - 1 });
    (1..=len)
        .map(|n| {
            if backwards {
                (start + len - n) % len
            } else {
                (start + n) % len
            }
        })
        .find(|i| focusable(&controls[*i]))
}

#[derive(Debug)]
pub struct Submission {
    pub url: String,
    pub body: Option<Vec<u8>>,
}

pub fn submit(
    base: &str,
    controls: &[PaintControl],
    focused: usize,
    submitter: Option<usize>,
) -> Result<Submission, String> {
    let field = controls.get(focused).ok_or("No focused form")?;
    if field.form == 0 || field.flags & DISABLED != 0 {
        return Err("This field is not part of an enabled form".into());
    }
    let source = submitter.and_then(|i| controls.get(i)).unwrap_or(field);
    if source.form != field.form || source.kind == FIELD_UNSUPPORTED || source.flags & DISABLED != 0
    {
        return Err("Invalid form submitter".into());
    }
    if !matches!(source.method.as_str(), "get" | "post") {
        return Err("Unsupported form method or encoding; nothing was sent".into());
    }
    let action = if source.action.is_empty() {
        base.to_string()
    } else {
        net::resolve_https_url(base, &source.action).map_err(|e| e.to_string())?
    };
    let action = net::resolve_https_url(base, &action).map_err(|e| e.to_string())?;
    let mut url = Url::parse(&action).map_err(|e| e.to_string())?;
    let base = Url::parse(base).map_err(|e| e.to_string())?;
    let post = source.method == "post";
    let mut encoded = url::form_urlencoded::Serializer::new(String::new());
    let mut encoded_bytes = 0usize;
    for (i, item) in controls
        .iter()
        .enumerate()
        .filter(|(_, c)| c.form == field.form && c.flags & DISABLED == 0)
    {
        if item.kind == FIELD_UNSUPPORTED {
            return Err("This form contains an unsupported control; nothing was sent".into());
        }
        if item.flags & REQUIRED != 0
            && item.kind != FIELD_HIDDEN
            && ((item.kind == FIELD_CHECKBOX && item.flags & CHECKED == 0)
                || (matches!(item.kind, FIELD_TEXT | FIELD_PASSWORD) && item.value.is_empty()))
        {
            return Err("Complete the required form fields before submitting".into());
        }
        if item.kind == FIELD_PASSWORD && !item.value.is_empty() {
            if !post {
                return Err(
                    "Password submission through a GET URL is blocked; nothing was sent".into(),
                );
            }
            if base.origin() != url.origin() {
                return Err(
                    "Password submission to a different origin is blocked; nothing was sent".into(),
                );
            }
        }
        if item.name.is_empty()
            || (item.kind == FIELD_SUBMIT && submitter != Some(i))
            || (item.kind == FIELD_CHECKBOX && item.flags & CHECKED == 0)
        {
            continue;
        }
        let value = normalize_newlines(&item.value);
        encoded_bytes = encoded_bytes
            .saturating_add(encoded_len(&item.name))
            .saturating_add(encoded_len(&value))
            .saturating_add(2);
        if encoded_bytes > 64 * 1024 {
            return Err("Encoded form exceeds the submission limit; nothing was sent".into());
        }
        encoded.append_pair(&item.name, &value);
    }
    let encoded = encoded.finish();
    if encoded.len() > 64 * 1024 {
        return Err("Encoded form exceeds the submission limit; nothing was sent".into());
    }
    if !post {
        url.set_query(Some(&encoded));
    }
    url.set_fragment(None);
    if url.as_str().len() > net::MAX_URL_BYTES {
        return Err("Encoded form exceeds the URL limit; nothing was sent".into());
    }
    Ok(Submission {
        url: url.to_string(),
        body: post.then(|| encoded.into_bytes()),
    })
}
fn normalize_newlines(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\r\n")
}

fn encoded_len(value: &str) -> usize {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b" *-._".contains(&b) {
                1
            } else {
                3
            }
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn field(kind: u8, name: &str, value: &str) -> PaintControl {
        PaintControl {
            rect: WireRect {
                width: 240,
                height: 30,
                ..Default::default()
            },
            form: 1,
            kind,
            flags: 0,
            max_length: 4096,
            action: "/search?stale=1".into(),
            method: "get".into(),
            name: name.into(),
            value: value.into(),
            label: String::new(),
        }
    }
    #[test]
    fn get_preserves_repeated_names_and_encodes_korean_and_delimiters() {
        let mut controls = vec![
            field(FIELD_TEXT, "q", "한글 & #"),
            field(FIELD_HIDDEN, "tag", "a"),
            field(FIELD_CHECKBOX, "tag", "b"),
            field(FIELD_SUBMIT, "go", "yes"),
            field(FIELD_TEXT, "disabled", "no"),
        ];
        controls[2].flags = CHECKED;
        controls[4].flags = DISABLED;
        let submission = submit("https://example.com/start", &controls, 0, Some(3)).unwrap();
        assert!(submission.body.is_none());
        let url = Url::parse(&submission.url).unwrap();
        assert_eq!(
            url.query_pairs()
                .map(|(a, b)| (a.into_owned(), b.into_owned()))
                .collect::<Vec<_>>(),
            [
                ("q".into(), "한글 & #".into()),
                ("tag".into(), "a".into()),
                ("tag".into(), "b".into()),
                ("go".into(), "yes".into())
            ]
        );
    }
    #[test]
    fn post_keeps_password_out_of_url_and_preserves_action_query() {
        let mut control = field(FIELD_PASSWORD, "password", "secret & 한글");
        control.method = "post".into();
        let result = submit("https://example.com/login", &[control], 0, None).unwrap();
        assert_eq!(result.url, "https://example.com/search?stale=1");
        assert_eq!(
            url::form_urlencoded::parse(result.body.as_ref().unwrap())
                .next()
                .unwrap()
                .1,
            "secret & 한글"
        );
    }
    #[test]
    fn rejects_required_unsupported_insecure_and_password_leaks() {
        let mut control = field(FIELD_TEXT, "q", "");
        control.flags = REQUIRED;
        assert!(submit("https://example.com/", &[control.clone()], 0, None).is_err());
        control.value = "yes".into();
        control.action = "http://example.com/".into();
        assert!(submit("https://example.com/", &[control.clone()], 0, None).is_err());
        control.action = "file:///etc/passwd".into();
        assert!(submit("https://example.com/", &[control.clone()], 0, None).is_err());
        control.action = "/".into();
        control.kind = FIELD_PASSWORD;
        assert!(submit("https://example.com/", &[control.clone()], 0, None).is_err());
        control.method = "post".into();
        control.action = "https://other.example/".into();
        assert!(submit("https://example.com/", &[control.clone()], 0, None).is_err());
        control.action = "/".into();
        control.kind = FIELD_UNSUPPORTED;
        assert!(submit("https://example.com/", &[control], 0, None).is_err());
    }
    #[test]
    fn editing_limits_and_tab_order_skip_hidden_and_disabled_fields() {
        let mut control = field(FIELD_TEXT, "q", "");
        control.max_length = 2;
        assert!(append(&mut control, "한글", false));
        assert!(!append(&mut control, "a", false));
        assert_eq!(control.value, "한글");
        assert!(append(&mut control, "A", true));
        assert!(!append(&mut control, "\n", false));
        control.flags = READ_ONLY;
        assert!(!append(&mut control, "B", false));
        let mut controls = vec![
            field(FIELD_HIDDEN, "a", ""),
            field(FIELD_TEXT, "b", ""),
            field(FIELD_TEXT, "c", ""),
            field(FIELD_SUBMIT, "d", ""),
        ];
        controls[2].flags = DISABLED;
        assert_eq!(next_focus(&controls, None, false), Some(1));
        assert_eq!(next_focus(&controls, Some(1), false), Some(3));
        assert_eq!(next_focus(&controls, Some(1), true), Some(3));
    }
    #[test]
    fn large_form_and_cross_form_submitter_are_rejected() {
        let controls = vec![field(FIELD_TEXT, "q", &"가".repeat(1000))];
        assert!(submit("https://example.com/", &controls, 0, None).is_err());
        let mut button = field(FIELD_SUBMIT, "go", "");
        button.form = 2;
        assert!(submit(
            "https://example.com/",
            &[field(FIELD_TEXT, "q", "x"), button],
            0,
            Some(1)
        )
        .is_err());
        assert_eq!(normalize_newlines("a\nb\rc\r\nd"), "a\r\nb\r\nc\r\nd");
    }
}
