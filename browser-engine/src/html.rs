use crate::dom::{Attribute, Document, ElementData, NodeId, NodeKind};
use std::error::Error;
use std::fmt;

const MAX_DOM_NODES: usize = 100_000;
const MAX_DOM_DEPTH: usize = 1_024;
const MAX_ATTRIBUTES_PER_ELEMENT: usize = 256;

#[derive(Debug)]
pub struct ParseError {
    message: String,
}

impl ParseError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for ParseError {}

pub fn parse(input: &str) -> Result<Document, ParseError> {
    let mut document = Document::new();
    let mut stack: Vec<NodeId> = vec![document.root()];
    let mut cursor = 0;

    while cursor < input.len() {
        if document.len() >= MAX_DOM_NODES {
            return Err(ParseError::new("HTML exceeded the DOM node safety limit"));
        }

        if let Some(raw_tag) = current_raw_text_tag(&document, &stack) {
            let closing = format!("</{raw_tag}");
            if let Some(relative) =
                find_ascii_case_insensitive(input[cursor..].as_bytes(), closing.as_bytes())
            {
                if relative > 0 {
                    append_text(
                        &mut document,
                        *stack.last().unwrap(),
                        &input[cursor..cursor + relative],
                    );
                }
                cursor += relative;
            } else {
                append_text(&mut document, *stack.last().unwrap(), &input[cursor..]);
                break;
            }
        }

        let bytes = input.as_bytes();
        if bytes[cursor] != b'<' {
            let next_tag = bytes[cursor..]
                .iter()
                .position(|byte| *byte == b'<')
                .map(|offset| cursor + offset)
                .unwrap_or(input.len());

            append_text(
                &mut document,
                *stack.last().unwrap(),
                &input[cursor..next_tag],
            );
            cursor = next_tag;
            continue;
        }

        if input[cursor..].starts_with("<!--") {
            if let Some(relative_end) = input[cursor + 4..].find("-->") {
                cursor += 4 + relative_end + 3;
            } else {
                break;
            }
            continue;
        }

        if input[cursor..].starts_with("<!") || input[cursor..].starts_with("<?") {
            cursor = find_tag_end(input, cursor)
                .map(|end| end + 1)
                .unwrap_or(input.len());
            continue;
        }

        let Some(end) = find_tag_end(input, cursor) else {
            append_text(&mut document, *stack.last().unwrap(), &input[cursor..]);
            break;
        };

        let raw = input[cursor + 1..end].trim();
        if let Some(close_body) = raw.strip_prefix('/') {
            let tag_name = parse_tag_name(close_body);
            close_element(&document, &mut stack, tag_name);
            cursor = end + 1;
            continue;
        }

        let self_closing = raw.trim_end().ends_with('/');
        let (tag_name, attributes) = parse_start_tag(raw)?;

        if tag_name.is_empty() {
            cursor = end + 1;
            continue;
        }

        let parent = *stack.last().unwrap();
        let element = document.append(
            parent,
            NodeKind::Element(ElementData::new(tag_name.clone(), attributes)),
        );

        if !self_closing && !is_void_element(&tag_name) {
            if stack.len() >= MAX_DOM_DEPTH {
                return Err(ParseError::new("HTML exceeded the DOM depth safety limit"));
            }
            stack.push(element);
        }

        cursor = end + 1;
    }

    Ok(document)
}

fn append_text(document: &mut Document, parent: NodeId, source: &str) {
    if source.is_empty() {
        return;
    }

    let decoded = decode_entities(source);
    if !decoded.is_empty() {
        document.append(parent, NodeKind::Text(decoded.into_boxed_str()));
    }
}

fn current_raw_text_tag<'a>(document: &'a Document, stack: &[NodeId]) -> Option<&'a str> {
    let current = *stack.last()?;
    let node = document.node(current)?;

    let NodeKind::Element(element) = node.kind() else {
        return None;
    };

    matches!(element.tag_name(), "script" | "style").then_some(element.tag_name())
}

fn close_element(document: &Document, stack: &mut Vec<NodeId>, closing_tag: &str) {
    if closing_tag.is_empty() {
        return;
    }

    let Some(position) = stack.iter().rposition(|id| {
        let Some(node) = document.node(*id) else {
            return false;
        };
        let NodeKind::Element(element) = node.kind() else {
            return false;
        };
        element.tag_name().eq_ignore_ascii_case(closing_tag)
    }) else {
        return;
    };

    stack.truncate(position);
    if stack.is_empty() {
        stack.push(document.root());
    }
}

fn parse_start_tag(raw: &str) -> Result<(String, Vec<Attribute>), ParseError> {
    let bytes = raw.as_bytes();
    let mut cursor = 0;

    skip_whitespace(bytes, &mut cursor);
    let name_start = cursor;
    while cursor < bytes.len()
        && !bytes[cursor].is_ascii_whitespace()
        && bytes[cursor] != b'/'
    {
        cursor += 1;
    }

    let tag_name = raw[name_start..cursor].to_ascii_lowercase();
    let mut attributes = Vec::new();

    while cursor < bytes.len() {
        skip_whitespace(bytes, &mut cursor);
        if cursor >= bytes.len() || bytes[cursor] == b'/' {
            break;
        }

        if attributes.len() >= MAX_ATTRIBUTES_PER_ELEMENT {
            return Err(ParseError::new(
                "HTML element exceeded the attribute safety limit",
            ));
        }

        let attr_start = cursor;
        while cursor < bytes.len()
            && !bytes[cursor].is_ascii_whitespace()
            && bytes[cursor] != b'='
            && bytes[cursor] != b'/'
        {
            cursor += 1;
        }

        let name = raw[attr_start..cursor].trim().to_ascii_lowercase();
        skip_whitespace(bytes, &mut cursor);

        let mut value = String::new();
        if cursor < bytes.len() && bytes[cursor] == b'=' {
            cursor += 1;
            skip_whitespace(bytes, &mut cursor);

            if cursor < bytes.len() && matches!(bytes[cursor], b'\'' | b'"') {
                let quote = bytes[cursor];
                cursor += 1;
                let value_start = cursor;
                while cursor < bytes.len() && bytes[cursor] != quote {
                    cursor += 1;
                }
                value = decode_entities(&raw[value_start..cursor]);
                if cursor < bytes.len() {
                    cursor += 1;
                }
            } else {
                let value_start = cursor;
                while cursor < bytes.len()
                    && !bytes[cursor].is_ascii_whitespace()
                    && bytes[cursor] != b'/'
                {
                    cursor += 1;
                }
                value = decode_entities(&raw[value_start..cursor]);
            }
        }

        if !name.is_empty() {
            attributes.push(Attribute::new(name, value));
        }
    }

    Ok((tag_name, attributes))
}

fn parse_tag_name(input: &str) -> &str {
    let trimmed = input.trim_start();
    let end = trimmed
        .bytes()
        .position(|byte| byte.is_ascii_whitespace() || byte == b'>')
        .unwrap_or(trimmed.len());
    &trimmed[..end]
}

fn find_tag_end(input: &str, start: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut quote: Option<u8> = None;
    let mut cursor = start + 1;

    while cursor < bytes.len() {
        match (quote, bytes[cursor]) {
            (Some(active), byte) if byte == active => quote = None,
            (None, b'\'' | b'"') => quote = Some(bytes[cursor]),
            (None, b'>') => return Some(cursor),
            _ => {}
        }
        cursor += 1;
    }

    None
}

fn skip_whitespace(bytes: &[u8], cursor: &mut usize) {
    while *cursor < bytes.len() && bytes[*cursor].is_ascii_whitespace() {
        *cursor += 1;
    }
}

fn is_void_element(tag: &str) -> bool {
    matches!(
        tag,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

fn find_ascii_case_insensitive(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }

    haystack.windows(needle.len()).position(|window| {
        window
            .iter()
            .zip(needle)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
    })
}

fn decode_entities(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;

    while cursor < input.len() {
        let Some(relative_amp) = input[cursor..].find('&') else {
            output.push_str(&input[cursor..]);
            break;
        };

        let amp = cursor + relative_amp;
        output.push_str(&input[cursor..amp]);

        let Some(relative_semi) = input[amp + 1..].find(';') else {
            output.push_str(&input[amp..]);
            break;
        };

        let semi = amp + 1 + relative_semi;
        if semi - amp > 16 {
            output.push('&');
            cursor = amp + 1;
            continue;
        }

        let entity = &input[amp + 1..semi];
        if let Some(decoded) = decode_entity(entity) {
            output.push(decoded);
            cursor = semi + 1;
        } else {
            output.push('&');
            cursor = amp + 1;
        }
    }

    output
}

fn decode_entity(entity: &str) -> Option<char> {
    match entity {
        "nbsp" => Some(' '),
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" | "#39" => Some('\''),
        _ if entity.starts_with("#x") || entity.starts_with("#X") => {
            u32::from_str_radix(&entity[2..], 16)
                .ok()
                .and_then(char::from_u32)
        }
        _ if entity.starts_with('#') => entity[1..]
            .parse::<u32>()
            .ok()
            .and_then(char::from_u32),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dom::NodeKind;

    #[test]
    fn builds_nested_dom_tree() {
        let document = parse(
            r#"<html lang="en"><body><h1 id="hero">Hello</h1><p>World</p></body></html>"#,
        )
        .unwrap();

        let html = document.find_first_element("html").unwrap();
        let body = document.find_first_element("body").unwrap();
        let h1 = document.find_first_element("h1").unwrap();

        assert_eq!(document.node(html).unwrap().parent(), Some(document.root()));
        assert_eq!(document.node(body).unwrap().parent(), Some(html));
        assert_eq!(document.node(h1).unwrap().parent(), Some(body));

        let NodeKind::Element(h1_element) = document.node(h1).unwrap().kind() else {
            panic!("h1 should be an element");
        };
        assert_eq!(h1_element.attribute("id"), Some("hero"));
    }

    #[test]
    fn renders_visible_text_from_dom() {
        let document = parse(
            r#"
            <html>
              <head>
                <style>body { color: red; }</style>
                <script>alert('no');</script>
              </head>
              <body><h1>Hello</h1><p>World &amp; browser</p></body>
            </html>
        "#,
        )
        .unwrap();

        assert_eq!(document.visible_text(), "Hello\nWorld & browser");
    }

    #[test]
    fn handles_void_elements_without_corrupting_parentage() {
        let document = parse("<body><p>Hello<br>World<img src=\"a.png\"></p><div>Next</div></body>")
            .unwrap();

        assert_eq!(document.visible_text(), "Hello\nWorld\nNext");
        let div = document.find_first_element("div").unwrap();
        let body = document.find_first_element("body").unwrap();
        assert_eq!(document.node(div).unwrap().parent(), Some(body));
    }

    #[test]
    fn understands_numeric_entities() {
        let document = parse("<body><p>&#72;&#x69; &lt;browser&gt;</p></body>").unwrap();
        assert_eq!(document.visible_text(), "Hi <browser>");
    }

    #[test]
    fn tolerates_mismatched_closing_tags() {
        let document = parse("<body><div><p>Hello</div><p>World</p></body>").unwrap();
        assert_eq!(document.visible_text(), "Hello\nWorld");
    }
}
