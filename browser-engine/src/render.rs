use crate::css::Display;
use crate::dom::{Document, NodeId, NodeKind};
use crate::style::ComputedStyle;
use font8x8::{UnicodeFonts, BASIC_FONTS};
use minifb::{Key, Window, WindowOptions};
use std::error::Error;

const WIDTH: usize = 900;
const HEIGHT: usize = 640;
const DEFAULT_BACKGROUND: u32 = 0xF7F7F7;
const FOREGROUND: u32 = 0x181818;
const MUTED: u32 = 0x555555;
const LEFT: usize = 24;
const TOP: usize = 22;
const CONTENT_WIDTH: usize = WIDTH - LEFT * 2;

pub fn show(
    url: &str,
    document: &Document,
    styles: &[ComputedStyle],
) -> Result<(), Box<dyn Error>> {
    let mut window = Window::new(
        "browser-core 0.3 — CSS style engine",
        WIDTH,
        HEIGHT,
        WindowOptions::default(),
    )?;

    let body = document.find_first_element("body");
    let page_background = body
        .and_then(|id| styles.get(id as usize))
        .and_then(|style| style.background_color)
        .unwrap_or(DEFAULT_BACKGROUND);

    let mut buffer = vec![page_background; WIDTH * HEIGHT];

    draw_text_line(
        &mut buffer,
        LEFT,
        TOP,
        "browser-core 0.3",
        FOREGROUND,
        2,
    );
    draw_text_line(
        &mut buffer,
        LEFT,
        TOP + 24,
        &ascii_safe(url),
        MUTED,
        1,
    );

    let content_top = TOP + 58;
    render_document(
        &mut buffer,
        document,
        styles,
        body.unwrap_or(document.root()),
        content_top,
    );

    while window.is_open() && !window.is_key_down(Key::Escape) {
        window.update_with_buffer(&buffer, WIDTH, HEIGHT)?;
    }

    Ok(())
}

fn render_document(
    buffer: &mut [u32],
    document: &Document,
    styles: &[ComputedStyle],
    root: NodeId,
    start_y: usize,
) {
    let mut cursor = Cursor {
        x: LEFT,
        y: start_y,
        line_height: 20,
    };
    let mut stack: Vec<(NodeId, bool)> = Vec::with_capacity(64);

    let mut children = Vec::new();
    if let Some(child) = document.first_child(root) {
        collect_siblings(document, child, &mut children);
        for id in children.drain(..).rev() {
            stack.push((id, false));
        }
    }

    while let Some((id, leaving)) = stack.pop() {
        if cursor.y >= HEIGHT.saturating_sub(16) {
            break;
        }

        let Some(node) = document.node(id) else {
            continue;
        };
        let style = styles.get(id as usize).copied().unwrap_or_default();

        if style.display == Display::None {
            continue;
        }

        if leaving {
            if style.display == Display::Block {
                finish_line(&mut cursor);
                cursor.y = cursor
                    .y
                    .saturating_add(style.padding_bottom as usize)
                    .saturating_add(style.margin_bottom as usize);
            }
            continue;
        }

        match node.kind() {
            NodeKind::Document => {}
            NodeKind::Text(text) => {
                draw_flow_text(buffer, &mut cursor, &ascii_safe(text), style);
            }
            NodeKind::Element(_) => {
                if style.display == Display::Block {
                    finish_line(&mut cursor);
                    cursor.y = cursor
                        .y
                        .saturating_add(style.margin_top as usize)
                        .saturating_add(style.padding_top as usize);
                }

                stack.push((id, true));

                if let Some(child) = document.first_child(id) {
                    collect_siblings(document, child, &mut children);
                    for child_id in children.drain(..).rev() {
                        stack.push((child_id, false));
                    }
                }
            }
        }
    }
}

fn collect_siblings(document: &Document, first: NodeId, output: &mut Vec<NodeId>) {
    output.clear();
    let mut current = Some(first);

    while let Some(id) = current {
        output.push(id);
        current = document.next_sibling(id);
    }
}

#[derive(Debug)]
struct Cursor {
    x: usize,
    y: usize,
    line_height: usize,
}

fn draw_flow_text(
    buffer: &mut [u32],
    cursor: &mut Cursor,
    text: &str,
    style: ComputedStyle,
) {
    let scale = font_scale(style.font_size);
    let glyph_width = 8 * scale;
    let glyph_height = 8 * scale;
    cursor.line_height = cursor.line_height.max(glyph_height + 6);

    let mut previous_space = cursor.x == LEFT;

    for ch in text.chars() {
        if ch.is_whitespace() {
            previous_space = true;
            continue;
        }

        if previous_space && cursor.x > LEFT {
            if cursor.x + glyph_width > LEFT + CONTENT_WIDTH {
                finish_line(cursor);
            } else {
                cursor.x += glyph_width;
            }
        }

        if cursor.x + glyph_width > LEFT + CONTENT_WIDTH {
            finish_line(cursor);
        }

        if cursor.y + glyph_height >= HEIGHT {
            return;
        }

        draw_char(
            buffer,
            cursor.x,
            cursor.y,
            ch,
            style.color,
            scale,
        );
        cursor.x += glyph_width;
        previous_space = false;
    }
}

fn finish_line(cursor: &mut Cursor) {
    if cursor.x != LEFT {
        cursor.y = cursor.y.saturating_add(cursor.line_height);
    }
    cursor.x = LEFT;
    cursor.line_height = 20;
}

fn font_scale(font_size: u16) -> usize {
    ((font_size as usize + 7) / 8).clamp(1, 6)
}

fn draw_text_line(
    buffer: &mut [u32],
    x: usize,
    y: usize,
    text: &str,
    color: u32,
    scale: usize,
) {
    let mut cursor_x = x;
    for ch in text.chars() {
        draw_char(buffer, cursor_x, y, ch, color, scale);
        cursor_x += 8 * scale;
        if cursor_x >= WIDTH.saturating_sub(8 * scale) {
            break;
        }
    }
}

fn ascii_safe(input: &str) -> String {
    input
        .chars()
        .map(|ch| if ch.is_ascii() { ch } else { '?' })
        .collect()
}

fn draw_char(
    buffer: &mut [u32],
    x: usize,
    y: usize,
    ch: char,
    color: u32,
    scale: usize,
) {
    let Some(glyph) = BASIC_FONTS.get(ch) else {
        return;
    };

    for (glyph_y, bits) in glyph.iter().enumerate() {
        for glyph_x in 0..8 {
            if bits & (1 << glyph_x) == 0 {
                continue;
            }

            for scale_y in 0..scale {
                for scale_x in 0..scale {
                    let px = x + glyph_x * scale + scale_x;
                    let py = y + glyph_y * scale + scale_y;
                    if px < WIDTH && py < HEIGHT {
                        buffer[py * WIDTH + px] = color;
                    }
                }
            }
        }
    }
}
