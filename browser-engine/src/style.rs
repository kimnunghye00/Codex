use crate::css::{self, Declaration, Display, Length, Property, Stylesheet, Value};
use crate::dom::{Document, NodeId, NodeKind};

const ROOT_FONT_SIZE: f32 = 16.0;
const INLINE_SPECIFICITY: u32 = 1_000_000;

#[derive(Debug, Clone, Copy)]
pub struct ComputedStyle {
    pub display: Display,
    pub color: u32,
    pub background_color: Option<u32>,
    pub font_size: u16,
    pub margin_top: u16,
    pub margin_bottom: u16,
    pub padding_top: u16,
    pub padding_bottom: u16,
}

impl Default for ComputedStyle {
    fn default() -> Self {
        Self {
            display: Display::Inline,
            color: 0x181818,
            background_color: None,
            font_size: 16,
            margin_top: 0,
            margin_bottom: 0,
            padding_top: 0,
            padding_bottom: 0,
        }
    }
}

#[derive(Clone, Copy)]
struct Winner {
    rank: u64,
    value: Option<Value>,
}

impl Winner {
    const fn empty() -> Self {
        Self {
            rank: 0,
            value: None,
        }
    }

    fn consider(&mut self, specificity: u32, order: u32, value: Value) {
        let rank = ((specificity as u64) << 32) | (order as u64 + 1);
        if rank >= self.rank {
            self.rank = rank;
            self.value = Some(value);
        }
    }
}

#[derive(Clone, Copy)]
struct Cascaded {
    display: Winner,
    color: Winner,
    background: Winner,
    font_size: Winner,
    margin_top: Winner,
    margin_bottom: Winner,
    padding_top: Winner,
    padding_bottom: Winner,
}

impl Cascaded {
    const fn new() -> Self {
        Self {
            display: Winner::empty(),
            color: Winner::empty(),
            background: Winner::empty(),
            font_size: Winner::empty(),
            margin_top: Winner::empty(),
            margin_bottom: Winner::empty(),
            padding_top: Winner::empty(),
            padding_bottom: Winner::empty(),
        }
    }

    fn apply(&mut self, declaration: Declaration, specificity: u32, order: u32) {
        let target = match declaration.property {
            Property::Display => &mut self.display,
            Property::Color => &mut self.color,
            Property::BackgroundColor => &mut self.background,
            Property::FontSize => &mut self.font_size,
            Property::MarginTop => &mut self.margin_top,
            Property::MarginBottom => &mut self.margin_bottom,
            Property::PaddingTop => &mut self.padding_top,
            Property::PaddingBottom => &mut self.padding_bottom,
        };

        target.consider(specificity, order, declaration.value);
    }
}

pub fn compute(document: &Document, stylesheet: &Stylesheet) -> Vec<ComputedStyle> {
    let mut styles = Vec::with_capacity(document.len());

    for index in 0..document.len() {
        let id = index as NodeId;
        let parent_style = document
            .node(id)
            .and_then(|node| node.parent())
            .and_then(|parent| styles.get(parent as usize))
            .copied()
            .unwrap_or_default();

        let Some(node) = document.node(id) else {
            styles.push(parent_style);
            continue;
        };

        let NodeKind::Element(element) = node.kind() else {
            styles.push(ComputedStyle {
                display: Display::Inline,
                color: parent_style.color,
                font_size: parent_style.font_size,
                ..ComputedStyle::default()
            });
            continue;
        };

        let mut cascaded = Cascaded::new();

        for rule in &stylesheet.rules {
            let specificity = rule
                .selectors
                .iter()
                .filter(|selector| selector.matches(element))
                .map(|selector| selector.specificity())
                .max();

            if let Some(specificity) = specificity {
                for declaration in &rule.declarations {
                    cascaded.apply(*declaration, specificity, rule.source_order);
                }
            }
        }

        if let Some(inline) = element.attribute("style") {
            if let Ok(declarations) = css::parse_inline_style(inline) {
                for (offset, declaration) in declarations.into_iter().enumerate() {
                    cascaded.apply(
                        declaration,
                        INLINE_SPECIFICITY,
                        u32::MAX.saturating_sub(1024).saturating_add(offset as u32),
                    );
                }
            }
        }

        let mut style = ua_style(element.tag_name(), parent_style);

        if let Some(Value::Display(value)) = cascaded.display.value {
            style.display = value;
        }
        if let Some(Value::Color(value)) = cascaded.color.value {
            style.color = value;
        }
        if let Some(Value::Color(value)) = cascaded.background.value {
            style.background_color = Some(value);
        }
        if let Some(Value::Length(value)) = cascaded.font_size.value {
            style.font_size = resolve_length(value, parent_style.font_size as f32)
                .round()
                .clamp(6.0, 96.0) as u16;
        }

        let font_size = style.font_size as f32;
        style.margin_top = resolve_winner_length(cascaded.margin_top, font_size);
        style.margin_bottom = resolve_winner_length(cascaded.margin_bottom, font_size);
        style.padding_top = resolve_winner_length(cascaded.padding_top, font_size);
        style.padding_bottom = resolve_winner_length(cascaded.padding_bottom, font_size);

        styles.push(style);
    }

    styles
}

fn ua_style(tag: &str, parent: ComputedStyle) -> ComputedStyle {
    let mut style = ComputedStyle {
        display: default_display(tag),
        color: parent.color,
        font_size: parent.font_size,
        ..ComputedStyle::default()
    };

    match tag {
        "body" => {
            style.font_size = 16;
            style.background_color = Some(0xF7F7F7);
        }
        "h1" => {
            style.font_size = 32;
            style.margin_top = 20;
            style.margin_bottom = 12;
        }
        "h2" => {
            style.font_size = 24;
            style.margin_top = 18;
            style.margin_bottom = 10;
        }
        "h3" => {
            style.font_size = 20;
            style.margin_top = 16;
            style.margin_bottom = 8;
        }
        "p" => {
            style.margin_top = 8;
            style.margin_bottom = 8;
        }
        _ => {}
    }

    style
}

fn default_display(tag: &str) -> Display {
    if matches!(tag, "head" | "script" | "style" | "template") {
        return Display::None;
    }

    if matches!(
        tag,
        "html"
            | "body"
            | "main"
            | "section"
            | "article"
            | "header"
            | "footer"
            | "nav"
            | "div"
            | "p"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "ul"
            | "ol"
            | "li"
            | "table"
            | "tr"
            | "blockquote"
            | "pre"
    ) {
        Display::Block
    } else {
        Display::Inline
    }
}

fn resolve_winner_length(winner: Winner, em_base: f32) -> u16 {
    match winner.value {
        Some(Value::Length(length)) => resolve_length(length, em_base).round().clamp(0.0, 512.0) as u16,
        _ => 0,
    }
}

fn resolve_length(length: Length, em_base: f32) -> f32 {
    match length {
        Length::Px(value) => value,
        Length::Em(value) => value * em_base,
        Length::Rem(value) => value * ROOT_FONT_SIZE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::css::parse_stylesheet;
    use crate::html;

    #[test]
    fn applies_selector_specificity_and_inheritance() {
        let document = html::parse(
            r#"<body><style>p { color: red } .note { color: blue } #hero { font-size: 24px }</style><p id="hero" class="note"><span>Hello</span></p></body>"#,
        )
        .unwrap();
        let sheet = Stylesheet::from_document(&document).unwrap();
        let styles = compute(&document, &sheet);

        let p = document.find_first_element("p").unwrap();
        let span = document.find_first_element("span").unwrap();

        assert_eq!(styles[p as usize].color, 0x0000FF);
        assert_eq!(styles[p as usize].font_size, 24);
        assert_eq!(styles[span as usize].color, 0x0000FF);
        assert_eq!(styles[span as usize].font_size, 24);
    }

    #[test]
    fn inline_style_wins_over_stylesheet() {
        let document = html::parse(
            r#"<body><style>p { color: red; }</style><p style="color: #00ff00">Hello</p></body>"#,
        )
        .unwrap();
        let sheet = parse_stylesheet("p { color: red; }").unwrap();
        let styles = compute(&document, &sheet);
        let p = document.find_first_element("p").unwrap();

        assert_eq!(styles[p as usize].color, 0x00FF00);
    }

    #[test]
    fn display_none_is_computed() {
        let document = html::parse(
            r#"<body><style>.secret { display: none; }</style><p class="secret">hidden</p></body>"#,
        )
        .unwrap();
        let sheet = Stylesheet::from_document(&document).unwrap();
        let styles = compute(&document, &sheet);
        let p = document.find_first_element("p").unwrap();

        assert_eq!(styles[p as usize].display, Display::None);
    }
}
