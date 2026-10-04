use crate::dom::{Document, ElementData, NodeKind};
use std::error::Error;
use std::fmt;

const MAX_STYLESHEET_BYTES: usize = 256 * 1024;
const MAX_RULES: usize = 4_096;
const MAX_SELECTORS_PER_RULE: usize = 64;
const MAX_DECLARATIONS_PER_RULE: usize = 128;
const MAX_INLINE_STYLE_BYTES: usize = 4_096;

#[derive(Debug, Default)]
pub struct Stylesheet {
    pub rules: Vec<Rule>,
}

#[derive(Debug)]
pub struct Rule {
    pub selectors: Vec<Selector>,
    pub declarations: Vec<Declaration>,
    pub source_order: u32,
}

#[derive(Debug)]
pub struct Selector {
    tag: Option<Box<str>>,
    id: Option<Box<str>>,
    classes: Vec<Box<str>>,
    specificity: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum Property {
    Display,
    Color,
    BackgroundColor,
    FontSize,
    MarginTop,
    MarginRight,
    MarginBottom,
    MarginLeft,
    PaddingTop,
    PaddingRight,
    PaddingBottom,
    PaddingLeft,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Value {
    Display(Display),
    Color(u32),
    Length(Length),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum Display {
    None,
    Inline,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Length {
    Px(f32),
    Em(f32),
    Rem(f32),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Declaration {
    pub property: Property,
    pub value: Value,
}

#[derive(Debug)]
pub struct CssError {
    message: String,
}

impl CssError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for CssError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for CssError {}

impl Stylesheet {
    pub fn append(&mut self, mut other: Stylesheet) -> Result<(), CssError> {
        if self.rules.len().saturating_add(other.rules.len()) > MAX_RULES {
            return Err(CssError::new("CSS exceeded the combined rule safety limit"));
        }

        let base_order = self.rules.len() as u32;
        for (offset, rule) in other.rules.iter_mut().enumerate() {
            rule.source_order = base_order.saturating_add(offset as u32);
        }
        self.rules.extend(other.rules);
        Ok(())
    }

    pub fn from_document(document: &Document) -> Result<Self, CssError> {
        let mut combined = String::new();

        for index in 0..document.len() {
            let id = index as u32;
            let Some(node) = document.node(id) else {
                continue;
            };
            let NodeKind::Element(element) = node.kind() else {
                continue;
            };

            if element.tag_name() != "style" {
                continue;
            }

            let css = document.text_content(id);
            if combined.len().saturating_add(css.len()) > MAX_STYLESHEET_BYTES {
                return Err(CssError::new(
                    "embedded CSS exceeded the stylesheet safety limit",
                ));
            }

            combined.push_str(&css);
            combined.push('\n');
        }

        parse_stylesheet(&combined)
    }
}

impl Selector {
    pub fn matches(&self, element: &ElementData) -> bool {
        if let Some(tag) = &self.tag {
            if !element.tag_name().eq_ignore_ascii_case(tag) {
                return false;
            }
        }

        if let Some(id) = &self.id {
            if element.attribute("id") != Some(id.as_ref()) {
                return false;
            }
        }

        self.classes
            .iter()
            .all(|class_name| element.has_class(class_name))
    }

    pub fn specificity(&self) -> u32 {
        self.specificity
    }
}

pub fn parse_stylesheet(input: &str) -> Result<Stylesheet, CssError> {
    if input.len() > MAX_STYLESHEET_BYTES {
        return Err(CssError::new("CSS exceeded the stylesheet safety limit"));
    }

    let source = strip_comments(input);
    let mut rules = Vec::new();
    let mut cursor = 0;

    while cursor < source.len() {
        skip_ascii_whitespace(source.as_bytes(), &mut cursor);
        if cursor >= source.len() {
            break;
        }

        let Some(open_rel) = source[cursor..].find('{') else {
            break;
        };
        let open = cursor + open_rel;
        let selector_source = source[cursor..open].trim();

        let Some(close_rel) = source[open + 1..].find('}') else {
            return Err(CssError::new("unterminated CSS rule"));
        };
        let close = open + 1 + close_rel;

        if rules.len() >= MAX_RULES {
            return Err(CssError::new("CSS exceeded the rule safety limit"));
        }

        let mut selectors = Vec::new();
        for raw_selector in selector_source.split(',') {
            if selectors.len() >= MAX_SELECTORS_PER_RULE {
                return Err(CssError::new(
                    "CSS rule exceeded the selector safety limit",
                ));
            }

            if let Some(selector) = parse_selector(raw_selector.trim()) {
                selectors.push(selector);
            }
        }

        let declarations = parse_declarations(&source[open + 1..close])?;
        if !selectors.is_empty() && !declarations.is_empty() {
            rules.push(Rule {
                selectors,
                declarations,
                source_order: rules.len() as u32,
            });
        }

        cursor = close + 1;
    }

    Ok(Stylesheet { rules })
}

pub fn parse_inline_style(input: &str) -> Result<Vec<Declaration>, CssError> {
    if input.len() > MAX_INLINE_STYLE_BYTES {
        return Err(CssError::new("inline CSS exceeded the safety limit"));
    }
    parse_declarations(input)
}

fn parse_selector(input: &str) -> Option<Selector> {
    if input.is_empty()
        || input.bytes().any(|byte| {
            byte.is_ascii_whitespace()
                || matches!(byte, b'>' | b'+' | b'~' | b'[' | b']' | b':' | b'(' | b')')
        })
    {
        return None;
    }

    let bytes = input.as_bytes();
    let mut cursor = 0;
    let mut tag: Option<Box<str>> = None;
    let mut id: Option<Box<str>> = None;
    let mut classes: Vec<Box<str>> = Vec::new();

    if bytes.first() == Some(&b'*') {
        cursor += 1;
    } else if bytes
        .first()
        .map(|byte| byte.is_ascii_alphabetic())
        .unwrap_or(false)
    {
        let start = cursor;
        while cursor < bytes.len() && is_css_ident_byte(bytes[cursor]) {
            cursor += 1;
        }
        tag = Some(input[start..cursor].to_ascii_lowercase().into_boxed_str());
    }

    while cursor < bytes.len() {
        let marker = bytes[cursor];
        if marker != b'#' && marker != b'.' {
            return None;
        }
        cursor += 1;
        let start = cursor;
        while cursor < bytes.len() && is_css_ident_byte(bytes[cursor]) {
            cursor += 1;
        }

        if start == cursor {
            return None;
        }

        let value: Box<str> = input[start..cursor].to_string().into_boxed_str();
        if marker == b'#' {
            id = Some(value);
        } else {
            classes.push(value);
        }
    }

    let specificity =
        (id.is_some() as u32) * 100 + (classes.len() as u32) * 10 + (tag.is_some() as u32);

    Some(Selector {
        tag,
        id,
        classes,
        specificity,
    })
}

fn parse_declarations(input: &str) -> Result<Vec<Declaration>, CssError> {
    let mut declarations = Vec::new();

    for raw in input.split(';') {
        let Some((name, value)) = raw.split_once(':') else {
            continue;
        };

        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();

        let expanded = match name.as_str() {
            "margin" => parse_box_shorthand(value, true),
            "padding" => parse_box_shorthand(value, false),
            _ => parse_declaration(&name, value)
                .map(|declaration| vec![declaration])
                .unwrap_or_default(),
        };

        if declarations.len().saturating_add(expanded.len()) > MAX_DECLARATIONS_PER_RULE {
            return Err(CssError::new(
                "CSS rule exceeded the declaration safety limit",
            ));
        }

        declarations.extend(expanded);
    }

    Ok(declarations)
}

fn parse_box_shorthand(input: &str, margin: bool) -> Vec<Declaration> {
    let tokens: Vec<&str> = input.split_ascii_whitespace().collect();
    if tokens.is_empty() || tokens.len() > 4 {
        return Vec::new();
    }

    let mut values = Vec::with_capacity(tokens.len());
    for token in tokens {
        let Some(length) = parse_length(token) else {
            return Vec::new();
        };
        values.push(length);
    }

    let (top, right, bottom, left) = match values.as_slice() {
        [all] => (*all, *all, *all, *all),
        [vertical, horizontal] => (*vertical, *horizontal, *vertical, *horizontal),
        [top, horizontal, bottom] => (*top, *horizontal, *bottom, *horizontal),
        [top, right, bottom, left] => (*top, *right, *bottom, *left),
        _ => return Vec::new(),
    };

    let properties = if margin {
        [
            Property::MarginTop,
            Property::MarginRight,
            Property::MarginBottom,
            Property::MarginLeft,
        ]
    } else {
        [
            Property::PaddingTop,
            Property::PaddingRight,
            Property::PaddingBottom,
            Property::PaddingLeft,
        ]
    };

    [top, right, bottom, left]
        .into_iter()
        .zip(properties)
        .map(|(length, property)| Declaration {
            property,
            value: Value::Length(length),
        })
        .collect()
}

fn parse_declaration(name: &str, value: &str) -> Option<Declaration> {
    match name {
        "display" => parse_display(value).map(|display| Declaration {
            property: Property::Display,
            value: Value::Display(display),
        }),
        "color" => parse_color(value).map(|color| Declaration {
            property: Property::Color,
            value: Value::Color(color),
        }),
        "background" | "background-color" => parse_color(value).map(|color| Declaration {
            property: Property::BackgroundColor,
            value: Value::Color(color),
        }),
        "font-size" => parse_length(value).map(|length| Declaration {
            property: Property::FontSize,
            value: Value::Length(length),
        }),
        "margin-top" => length_declaration(Property::MarginTop, value),
        "margin-right" => length_declaration(Property::MarginRight, value),
        "margin-bottom" => length_declaration(Property::MarginBottom, value),
        "margin-left" => length_declaration(Property::MarginLeft, value),
        "padding-top" => length_declaration(Property::PaddingTop, value),
        "padding-right" => length_declaration(Property::PaddingRight, value),
        "padding-bottom" => length_declaration(Property::PaddingBottom, value),
        "padding-left" => length_declaration(Property::PaddingLeft, value),
        _ => None,
    }
}

fn length_declaration(property: Property, value: &str) -> Option<Declaration> {
    parse_length(value).map(|length| Declaration {
        property,
        value: Value::Length(length),
    })
}

fn parse_display(input: &str) -> Option<Display> {
    match input.trim().to_ascii_lowercase().as_str() {
        "none" => Some(Display::None),
        "inline" => Some(Display::Inline),
        "block" => Some(Display::Block),
        _ => None,
    }
}

fn parse_length(input: &str) -> Option<Length> {
    let value = input.trim().to_ascii_lowercase();

    if let Some(number) = value.strip_suffix("px") {
        return parse_bounded_float(number).map(Length::Px);
    }
    if let Some(number) = value.strip_suffix("rem") {
        return parse_bounded_float(number).map(Length::Rem);
    }
    if let Some(number) = value.strip_suffix("em") {
        return parse_bounded_float(number).map(Length::Em);
    }
    if value == "0" {
        return Some(Length::Px(0.0));
    }

    None
}

fn parse_bounded_float(input: &str) -> Option<f32> {
    let value = input.trim().parse::<f32>().ok()?;
    value.is_finite().then_some(value.clamp(0.0, 512.0))
}

fn parse_color(input: &str) -> Option<u32> {
    let value = input.trim().to_ascii_lowercase();

    if let Some(hex) = value.strip_prefix('#') {
        return match hex.len() {
            3 => {
                let r = u32::from_str_radix(&hex[0..1], 16).ok()?;
                let g = u32::from_str_radix(&hex[1..2], 16).ok()?;
                let b = u32::from_str_radix(&hex[2..3], 16).ok()?;
                Some((r * 17) << 16 | (g * 17) << 8 | (b * 17))
            }
            6 => u32::from_str_radix(hex, 16).ok(),
            _ => None,
        };
    }

    match value.as_str() {
        "black" => Some(0x000000),
        "white" => Some(0xFFFFFF),
        "red" => Some(0xFF0000),
        "green" => Some(0x008000),
        "blue" => Some(0x0000FF),
        "gray" | "grey" => Some(0x808080),
        "yellow" => Some(0xFFFF00),
        "navy" => Some(0x000080),
        "teal" => Some(0x008080),
        "purple" => Some(0x800080),
        "orange" => Some(0xFFA500),
        _ => None,
    }
}

fn strip_comments(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;

    while cursor < input.len() {
        if input[cursor..].starts_with("/*") {
            if let Some(end_rel) = input[cursor + 2..].find("*/") {
                cursor += 2 + end_rel + 2;
                continue;
            }
            break;
        }

        let ch = input[cursor..].chars().next().unwrap();
        output.push(ch);
        cursor += ch.len_utf8();
    }

    output
}

fn skip_ascii_whitespace(bytes: &[u8], cursor: &mut usize) {
    while *cursor < bytes.len() && bytes[*cursor].is_ascii_whitespace() {
        *cursor += 1;
    }
}

fn is_css_ident_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_selectors_and_declarations() {
        let sheet = parse_stylesheet(
            "h1, .title { color: #348; font-size: 24px; } #hero { display: none; }",
        )
        .unwrap();

        assert_eq!(sheet.rules.len(), 2);
        assert_eq!(sheet.rules[0].selectors.len(), 2);
        assert_eq!(sheet.rules[0].declarations.len(), 2);
    }

    #[test]
    fn parses_supported_lengths_and_colors() {
        assert_eq!(parse_length("1.5em"), Some(Length::Em(1.5)));
        assert_eq!(parse_length("18px"), Some(Length::Px(18.0)));
        assert_eq!(parse_color("#abc"), Some(0xAABBCC));
        assert_eq!(parse_color("red"), Some(0xFF0000));
    }

    #[test]
    fn expands_box_shorthand() {
        let declarations = parse_inline_style("margin: 10px 20px 30px 40px").unwrap();
        assert_eq!(declarations.len(), 4);
        assert_eq!(declarations[0].property, Property::MarginTop);
        assert_eq!(declarations[1].property, Property::MarginRight);
        assert_eq!(declarations[2].property, Property::MarginBottom);
        assert_eq!(declarations[3].property, Property::MarginLeft);
    }

    #[test]
    fn ignores_complex_selectors_for_now() {
        let sheet = parse_stylesheet("main p { color: red; } p.note { color: blue; }").unwrap();
        assert_eq!(sheet.rules.len(), 1);
    }
}
