use crate::dom::Document;
use crate::layout::{LayoutTree, Rect};
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
const PAGE_TOP: usize = 80;

pub const PAGE_WIDTH: u32 = (WIDTH - LEFT * 2) as u32;

pub fn show(
    url: &str,
    document: &Document,
    styles: &[ComputedStyle],
    layout: &LayoutTree,
) -> Result<(), Box<dyn Error>> {
    let mut window = Window::new(
        "browser-core 0.4 — layout engine",
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
        "browser-core 0.4",
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

    for layout_box in layout.boxes.iter().flatten() {
        let Some(style) = styles.get(layout_box.node as usize) else {
            continue;
        };
        let Some(color) = style.background_color else {
            continue;
        };

        fill_rect(&mut buffer, offset_rect(layout_box.rect), color);
    }

    for fragment in &layout.fragments {
        let style = styles
            .get(fragment.node as usize)
            .copied()
            .unwrap_or_default();
        let scale = font_scale(style.font_size);
        let screen_x = LEFT.saturating_add(fragment.rect.x as usize);
        let screen_y = PAGE_TOP.saturating_add(fragment.rect.y as usize);

        draw_text_line(
            &mut buffer,
            screen_x,
            screen_y,
            &ascii_safe(&fragment.text),
            style.color,
            scale,
        );
    }

    while window.is_open() && !window.is_key_down(Key::Escape) {
        window.update_with_buffer(&buffer, WIDTH, HEIGHT)?;
    }

    Ok(())
}

fn offset_rect(rect: Rect) -> Rect {
    Rect {
        x: rect.x.saturating_add(LEFT as u32),
        y: rect.y.saturating_add(PAGE_TOP as u32),
        width: rect.width,
        height: rect.height,
    }
}

fn fill_rect(buffer: &mut [u32], rect: Rect, color: u32) {
    let left = (rect.x as usize).min(WIDTH);
    let top = (rect.y as usize).min(HEIGHT);
    let right = (rect.right() as usize).min(WIDTH);
    let bottom = (rect.bottom() as usize).min(HEIGHT);

    for y in top..bottom {
        let row = y * WIDTH;
        for x in left..right {
            buffer[row + x] = color;
        }
    }
}

fn font_scale(font_size: u16) -> usize {
    (((font_size as usize) + 7) / 8).clamp(1, 6)
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
