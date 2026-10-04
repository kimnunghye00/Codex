#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SkipTag {
    Script,
    Style,
}

pub fn html_to_text(html: &str) -> String {
    let bytes = html.as_bytes();
    let mut cursor = 0;
    let mut output = String::with_capacity(html.len().min(64 * 1024));
    let mut skip: Option<SkipTag> = None;

    while cursor < bytes.len() {
        if bytes[cursor] == b'<' {
            if html[cursor..].starts_with("<!--") {
                if let Some(end) = html[cursor + 4..].find("-->") {
                    cursor += 4 + end + 3;
                    continue;
                }
                break;
            }

            let Some(relative_end) = bytes[cursor..].iter().position(|byte| *byte == b'>') else {
                break;
            };
            let end = cursor + relative_end;
            let raw_tag = html[cursor + 1..end].trim();
            let closing = raw_tag.starts_with('/');
            let tag_source = raw_tag
                .trim_start_matches('/')
                .trim_start_matches('!')
                .trim_start_matches('?');
            let tag_name = tag_source
                .split(|ch: char| ch.is_ascii_whitespace() || ch == '/')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();

            match (skip, closing, tag_name.as_str()) {
                (Some(SkipTag::Script), true, "script")
                | (Some(SkipTag::Style), true, "style") => {
                    skip = None;
                }
                (None, false, "script") => skip = Some(SkipTag::Script),
                (None, false, "style") => skip = Some(SkipTag::Style),
                _ => {}
            }

            if skip.is_none() && is_block_tag(&tag_name) {
                push_newline(&mut output);
            }

            cursor = end + 1;
            continue;
        }

        let next_tag = bytes[cursor..]
            .iter()
            .position(|byte| *byte == b'<')
            .map(|offset| cursor + offset)
            .unwrap_or(bytes.len());

        if skip.is_none() {
            push_text(&mut output, &html[cursor..next_tag]);
        }

        cursor = next_tag;
    }

    normalize_lines(&output)
}

fn is_block_tag(tag: &str) -> bool {
    matches!(
        tag,
        "br"
            | "p"
            | "div"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "li"
            | "ul"
            | "ol"
            | "main"
            | "section"
            | "article"
            | "header"
            | "footer"
            | "nav"
            | "tr"
            | "table"
    )
}

fn push_newline(output: &mut String) {
    if !output.ends_with('\n') {
        output.push('\n');
    }
}

fn push_text(output: &mut String, text: &str) {
    let decoded = decode_entities(text);
    let mut previous_space = output
        .chars()
        .last()
        .map(|ch| ch.is_whitespace())
        .unwrap_or(false);

    for ch in decoded.chars() {
        if ch.is_whitespace() {
            if !previous_space {
                output.push(' ');
                previous_space = true;
            }
        } else {
            output.push(ch);
            previous_space = false;
        }
    }
}

fn decode_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn normalize_lines(input: &str) -> String {
    let mut result = String::new();

    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(trimmed);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_markup_and_hidden_style_script_text() {
        let html = r#"
            <html>
              <head>
                <style>body { color: red; }</style>
                <script>alert('no');</script>
              </head>
              <body><h1>Hello</h1><p>World &amp; browser</p></body>
            </html>
        "#;

        assert_eq!(html_to_text(html), "Hello\nWorld & browser");
    }

    #[test]
    fn collapses_whitespace() {
        assert_eq!(
            html_to_text("<p>hello      lightweight   browser</p>"),
            "hello lightweight browser"
        );
    }
}
