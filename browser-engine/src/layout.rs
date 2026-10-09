use crate::css::Display;
use crate::dom::{Document, NodeId, NodeKind};
use crate::resources::ResourceSet;
use crate::style::ComputedStyle;
use std::error::Error;
use std::fmt;

const MAX_LAYOUT_DEPTH: usize = 256;
const MAX_TEXT_FRAGMENTS: usize = 200_000;
const MAX_IMAGE_FRAGMENTS: usize = 256;
const DEFAULT_LINE_HEIGHT: u32 = 20;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub fn right(self) -> u32 {
        self.x.saturating_add(self.width)
    }

    pub fn bottom(self) -> u32 {
        self.y.saturating_add(self.height)
    }

    pub fn contains(self, x: u32, y: u32) -> bool {
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }

    fn union(self, other: Rect) -> Rect {
        if self.width == 0 || self.height == 0 {
            return other;
        }
        if other.width == 0 || other.height == 0 {
            return self;
        }

        let left = self.x.min(other.x);
        let top = self.y.min(other.y);
        let right = self.right().max(other.right());
        let bottom = self.bottom().max(other.bottom());

        Rect {
            x: left,
            y: top,
            width: right.saturating_sub(left),
            height: bottom.saturating_sub(top),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LayoutBox {
    pub node: NodeId,
    pub rect: Rect,
    pub content_rect: Rect,
}

#[derive(Debug)]
pub struct TextFragment {
    pub node: NodeId,
    pub link: Option<NodeId>,
    pub rect: Rect,
    pub text: Box<str>,
}

#[derive(Debug, Clone, Copy)]
pub struct ImageFragment {
    pub node: NodeId,
    pub link: Option<NodeId>,
    pub rect: Rect,
}

#[derive(Debug)]
pub struct LayoutTree {
    pub boxes: Vec<Option<LayoutBox>>,
    pub fragments: Vec<TextFragment>,
    pub images: Vec<ImageFragment>,
    pub content_height: u32,
}

#[derive(Debug)]
pub struct LayoutError {
    message: String,
}

impl LayoutError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for LayoutError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for LayoutError {}

pub fn build(
    document: &Document,
    styles: &[ComputedStyle],
    resources: &ResourceSet,
    viewport_width: u32,
) -> Result<LayoutTree, LayoutError> {
    if viewport_width == 0 {
        return Err(LayoutError::new(
            "layout viewport width must be greater than zero",
        ));
    }

    let mut context = LayoutContext {
        document,
        styles,
        resources,
        tree: LayoutTree {
            boxes: vec![None; document.len()],
            fragments: Vec::new(),
            images: Vec::new(),
            content_height: 0,
        },
    };

    if let Some(body) = document.find_first_element("body") {
        context.tree.content_height = context.layout_block(body, 0, 0, viewport_width, 0)?;
    } else {
        let mut flow = FlowState::new(0, 0, viewport_width);
        context.layout_flow_children(document.root(), &mut flow, 0)?;
        flow.flush_line();
        context.tree.content_height = flow.y;
    }

    Ok(context.tree)
}

impl LayoutTree {
    pub fn hit_test_link(&self, x: u32, y: u32) -> Option<NodeId> {
        if let Some(link) = self
            .images
            .iter()
            .rev()
            .find(|fragment| fragment.link.is_some() && fragment.rect.contains(x, y))
            .and_then(|fragment| fragment.link)
        {
            return Some(link);
        }

        self.fragments
            .iter()
            .rev()
            .find(|fragment| fragment.link.is_some() && fragment.rect.contains(x, y))
            .and_then(|fragment| fragment.link)
    }
}

struct LayoutContext<'a> {
    document: &'a Document,
    styles: &'a [ComputedStyle],
    resources: &'a ResourceSet,
    tree: LayoutTree,
}

impl LayoutContext<'_> {
    fn style(&self, id: NodeId) -> ComputedStyle {
        self.styles.get(id as usize).copied().unwrap_or_default()
    }

    fn layout_block(
        &mut self,
        id: NodeId,
        containing_x: u32,
        outer_y: u32,
        available_width: u32,
        depth: usize,
    ) -> Result<u32, LayoutError> {
        self.check_depth(depth)?;

        let style = self.style(id);
        if style.display == Display::None {
            return Ok(outer_y);
        }

        let horizontal_margin =
            (style.margin_left as u32).saturating_add(style.margin_right as u32);
        let box_width = available_width.saturating_sub(horizontal_margin).max(1);
        let box_x = containing_x.saturating_add(style.margin_left as u32);
        let box_y = outer_y.saturating_add(style.margin_top as u32);

        let horizontal_padding =
            (style.padding_left as u32).saturating_add(style.padding_right as u32);
        let content_width = box_width.saturating_sub(horizontal_padding).max(1);
        let content_x = box_x.saturating_add(style.padding_left as u32);
        let content_y = box_y.saturating_add(style.padding_top as u32);

        let mut flow = FlowState::new(content_x, content_y, content_width);
        self.layout_flow_children(id, &mut flow, depth + 1)?;
        flow.flush_line();

        let content_height = flow.y.saturating_sub(content_y);
        let box_height = (style.padding_top as u32)
            .saturating_add(content_height)
            .saturating_add(style.padding_bottom as u32);

        let rect = Rect {
            x: box_x,
            y: box_y,
            width: box_width,
            height: box_height,
        };
        let content_rect = Rect {
            x: content_x,
            y: content_y,
            width: content_width,
            height: content_height,
        };

        self.tree.boxes[id as usize] = Some(LayoutBox {
            node: id,
            rect,
            content_rect,
        });

        Ok(rect.bottom().saturating_add(style.margin_bottom as u32))
    }

    fn layout_flow_children(
        &mut self,
        parent: NodeId,
        flow: &mut FlowState,
        depth: usize,
    ) -> Result<(), LayoutError> {
        self.check_depth(depth)?;

        let children: Vec<NodeId> = self.document.children(parent).collect();
        for child in children {
            let style = self.style(child);
            if style.display == Display::None {
                continue;
            }

            if self.layout_control(child, flow)? {
                continue;
            }
            match style.display {
                Display::None => {}
                Display::Block => {
                    flow.flush_line();
                    flow.y =
                        self.layout_block(child, flow.start_x, flow.y, flow.width, depth + 1)?;
                    flow.x = flow.start_x;
                    flow.line_height = 0;
                    flow.pending_space = false;
                }
                Display::Inline => self.layout_inline_node(child, flow, depth + 1)?,
            }
        }

        Ok(())
    }

    fn layout_inline_node(
        &mut self,
        id: NodeId,
        flow: &mut FlowState,
        depth: usize,
    ) -> Result<(), LayoutError> {
        self.check_depth(depth)?;

        let style = self.style(id);
        if style.display == Display::None {
            return Ok(());
        }

        if self.layout_control(id, flow)? {
            return Ok(());
        }
        let Some(node) = self.document.node(id) else {
            return Ok(());
        };

        match node.kind() {
            NodeKind::Document => self.layout_flow_children(id, flow, depth + 1)?,
            NodeKind::Text(text) => self.layout_text(id, text, flow, style)?,
            NodeKind::Element(element) => {
                if element.tag_name() == "br" {
                    flow.force_line_break();
                    return Ok(());
                }

                if element.tag_name() == "img" {
                    self.layout_image(id, flow)?;
                    return Ok(());
                }

                let mut bounds: Option<Rect> = None;
                let children: Vec<NodeId> = self.document.children(id).collect();

                for child in children {
                    let child_style = self.style(child);
                    if child_style.display == Display::None {
                        continue;
                    }

                    if child_style.display == Display::Block {
                        flow.flush_line();
                        flow.y =
                            self.layout_block(child, flow.start_x, flow.y, flow.width, depth + 1)?;
                        flow.x = flow.start_x;
                    } else {
                        self.layout_inline_node(child, flow, depth + 1)?;
                    }

                    if let Some(child_box) = self.tree.boxes[child as usize] {
                        bounds = Some(match bounds {
                            Some(current) => current.union(child_box.rect),
                            None => child_box.rect,
                        });
                    }
                }

                if let Some(rect) = bounds {
                    self.tree.boxes[id as usize] = Some(LayoutBox {
                        node: id,
                        rect,
                        content_rect: rect,
                    });
                }
            }
        }

        Ok(())
    }

    fn layout_control(&mut self, id: NodeId, flow: &mut FlowState) -> Result<bool, LayoutError> {
        let Some(NodeKind::Element(element)) = self.document.node(id).map(|n| n.kind()) else {
            return Ok(false);
        };
        if !matches!(
            element.tag_name(),
            "input" | "button" | "textarea" | "select"
        ) {
            return Ok(false);
        }
        let kind = element.attribute("type").unwrap_or("text");
        if element.tag_name() == "input" && kind.eq_ignore_ascii_case("hidden") {
            return Ok(true);
        }
        let width = if kind.eq_ignore_ascii_case("checkbox") {
            24
        } else if element.tag_name() == "button" || kind.eq_ignore_ascii_case("submit") {
            120
        } else {
            240
        };
        let width = width.min(flow.width.max(1));
        if flow.x > flow.start_x {
            flow.x = flow.x.saturating_add(8);
        }
        if flow.x.saturating_add(width) > flow.start_x.saturating_add(flow.width) {
            flow.force_line_break();
        }
        let rect = Rect {
            x: flow.x,
            y: flow.y,
            width,
            height: 30,
        };
        self.tree.boxes[id as usize] = Some(LayoutBox {
            node: id,
            rect,
            content_rect: rect,
        });
        flow.x = flow.x.saturating_add(width);
        flow.line_height = flow.line_height.max(38);
        flow.pending_space = true;
        Ok(true)
    }

    fn layout_image(&mut self, id: NodeId, flow: &mut FlowState) -> Result<(), LayoutError> {
        let Some((intrinsic_width, intrinsic_height)) = self.resources.image_dimensions(id) else {
            return Ok(());
        };

        if self.tree.images.len() >= MAX_IMAGE_FRAGMENTS {
            return Err(LayoutError::new(
                "layout exceeded the image fragment safety limit",
            ));
        }

        let max_width = flow.width.max(1);
        let (width, height) = if intrinsic_width > max_width {
            let height = ((intrinsic_height as u64 * max_width as u64) / intrinsic_width as u64)
                .max(1) as u32;
            (max_width, height)
        } else {
            (intrinsic_width, intrinsic_height)
        };

        let max_x = flow.start_x.saturating_add(flow.width);
        if flow.x != flow.start_x && flow.x.saturating_add(width) > max_x {
            flow.force_line_break();
        }

        let rect = Rect {
            x: flow.x,
            y: flow.y,
            width,
            height,
        };

        let link = self.nearest_link(id);
        self.tree.images.push(ImageFragment {
            node: id,
            link,
            rect,
        });
        self.tree.boxes[id as usize] = Some(LayoutBox {
            node: id,
            rect,
            content_rect: rect,
        });

        flow.x = flow.x.saturating_add(width);
        flow.line_height = flow.line_height.max(height.saturating_add(4));
        flow.pending_space = false;
        Ok(())
    }

    fn layout_text(
        &mut self,
        id: NodeId,
        text: &str,
        flow: &mut FlowState,
        style: ComputedStyle,
    ) -> Result<(), LayoutError> {
        let scale = font_scale(style.font_size);
        let glyph_width = 4_u32.saturating_mul(scale);
        let glyph_height = 8_u32.saturating_mul(scale);
        let line_height = glyph_height.saturating_add(6);
        let link = self.nearest_link(id);

        let mut word = String::new();
        let mut bounds: Option<Rect> = None;

        for ch in text.chars() {
            if ch.is_whitespace() {
                if !word.is_empty() {
                    self.place_word(
                        id,
                        link,
                        &word,
                        flow,
                        glyph_width,
                        glyph_height,
                        line_height,
                        &mut bounds,
                    )?;
                    word.clear();
                }
                flow.pending_space = true;
            } else {
                word.push(ch);
            }
        }

        if !word.is_empty() {
            self.place_word(
                id,
                link,
                &word,
                flow,
                glyph_width,
                glyph_height,
                line_height,
                &mut bounds,
            )?;
        }

        if let Some(rect) = bounds {
            self.tree.boxes[id as usize] = Some(LayoutBox {
                node: id,
                rect,
                content_rect: rect,
            });
        }

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn place_word(
        &mut self,
        id: NodeId,
        link: Option<NodeId>,
        word: &str,
        flow: &mut FlowState,
        glyph_width: u32,
        glyph_height: u32,
        line_height: u32,
        bounds: &mut Option<Rect>,
    ) -> Result<(), LayoutError> {
        if word.is_empty() {
            return Ok(());
        }

        let max_x = flow.start_x.saturating_add(flow.width);

        if flow.pending_space && flow.x > flow.start_x {
            if flow.x.saturating_add(glyph_width) > max_x {
                flow.force_line_break();
            } else {
                flow.x = flow.x.saturating_add(glyph_width);
            }
        }
        flow.pending_space = false;

        let char_count = crate::text_metrics::width(word);
        let word_width = char_count.saturating_mul(glyph_width);

        if (word_width <= flow.width && flow.x.saturating_add(word_width) > max_x)
            || (word_width > flow.width && flow.x != flow.start_x)
        {
            flow.force_line_break();
        }

        if word_width <= flow.width {
            let rect = Rect {
                x: flow.x,
                y: flow.y,
                width: word_width,
                height: glyph_height,
            };
            self.push_fragment(id, link, rect, word)?;
            *bounds = Some(match *bounds {
                Some(current) => current.union(rect),
                None => rect,
            });
            flow.x = flow.x.saturating_add(word_width);
            flow.line_height = flow.line_height.max(line_height);
            return Ok(());
        }

        let mut chunk = String::new();
        let mut chunk_start_x = flow.x;

        for ch in word.chars() {
            if flow
                .x
                .saturating_add(glyph_width.saturating_mul(crate::text_metrics::columns(ch)))
                > max_x
                && !chunk.is_empty()
            {
                let rect = Rect {
                    x: chunk_start_x,
                    y: flow.y,
                    width: crate::text_metrics::width(&chunk).saturating_mul(glyph_width),
                    height: glyph_height,
                };
                self.push_fragment(id, link, rect, &chunk)?;
                *bounds = Some(match *bounds {
                    Some(current) => current.union(rect),
                    None => rect,
                });
                chunk.clear();
                flow.force_line_break();
                chunk_start_x = flow.x;
            }

            if chunk.is_empty() {
                chunk_start_x = flow.x;
            }

            chunk.push(ch);
            flow.x = flow
                .x
                .saturating_add(glyph_width.saturating_mul(crate::text_metrics::columns(ch)));
            flow.line_height = flow.line_height.max(line_height);
        }

        if !chunk.is_empty() {
            let rect = Rect {
                x: chunk_start_x,
                y: flow.y,
                width: crate::text_metrics::width(&chunk).saturating_mul(glyph_width),
                height: glyph_height,
            };
            self.push_fragment(id, link, rect, &chunk)?;
            *bounds = Some(match *bounds {
                Some(current) => current.union(rect),
                None => rect,
            });
        }

        Ok(())
    }

    fn push_fragment(
        &mut self,
        node: NodeId,
        link: Option<NodeId>,
        rect: Rect,
        text: &str,
    ) -> Result<(), LayoutError> {
        if self.tree.fragments.len() >= MAX_TEXT_FRAGMENTS {
            return Err(LayoutError::new(
                "layout exceeded the text fragment safety limit",
            ));
        }

        self.tree.fragments.push(TextFragment {
            node,
            link,
            rect,
            text: text.to_string().into_boxed_str(),
        });
        Ok(())
    }

    fn nearest_link(&self, mut id: NodeId) -> Option<NodeId> {
        for _ in 0..MAX_LAYOUT_DEPTH {
            let node = self.document.node(id)?;
            if let NodeKind::Element(element) = node.kind() {
                if element.tag_name() == "a" && element.attribute("href").is_some() {
                    return Some(id);
                }
            }
            id = node.parent()?;
        }
        None
    }

    fn check_depth(&self, depth: usize) -> Result<(), LayoutError> {
        if depth > MAX_LAYOUT_DEPTH {
            Err(LayoutError::new("layout exceeded the nesting safety limit"))
        } else {
            Ok(())
        }
    }
}

#[derive(Debug)]
struct FlowState {
    start_x: u32,
    width: u32,
    x: u32,
    y: u32,
    line_height: u32,
    pending_space: bool,
}

impl FlowState {
    fn new(start_x: u32, start_y: u32, width: u32) -> Self {
        Self {
            start_x,
            width: width.max(1),
            x: start_x,
            y: start_y,
            line_height: 0,
            pending_space: false,
        }
    }

    fn flush_line(&mut self) {
        if self.x != self.start_x || self.line_height != 0 {
            self.y = self
                .y
                .saturating_add(self.line_height.max(DEFAULT_LINE_HEIGHT));
        }
        self.x = self.start_x;
        self.line_height = 0;
        self.pending_space = false;
    }

    fn force_line_break(&mut self) {
        self.y = self
            .y
            .saturating_add(self.line_height.max(DEFAULT_LINE_HEIGHT));
        self.x = self.start_x;
        self.line_height = 0;
        self.pending_space = false;
    }
}

fn font_scale(font_size: u16) -> u32 {
    (font_size as u32).div_ceil(8).clamp(1, 6)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::css::Stylesheet;
    use crate::{html, style};

    #[test]
    fn wraps_text_inside_viewport() {
        let document =
            html::parse("<body><p>one two three four five six seven eight nine ten</p></body>")
                .unwrap();
        let styles = style::compute(&document, &Stylesheet::default());
        let resources = ResourceSet::default();
        let layout = build(&document, &styles, &resources, 80).unwrap();

        assert!(layout.content_height > 20);
        assert!(layout
            .fragments
            .iter()
            .all(|fragment| fragment.rect.right() <= 80));
    }

    #[test]
    fn links_are_hit_testable() {
        let document =
            html::parse(r#"<body><p><a href="/next">Open next page</a></p></body>"#).unwrap();
        let styles = style::compute(&document, &Stylesheet::default());
        let resources = ResourceSet::default();
        let layout = build(&document, &styles, &resources, 300).unwrap();
        let fragment = layout
            .fragments
            .iter()
            .find(|item| item.link.is_some())
            .unwrap();

        assert_eq!(
            layout.hit_test_link(fragment.rect.x, fragment.rect.y),
            fragment.link
        );
    }
}
