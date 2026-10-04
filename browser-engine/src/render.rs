use crate::dom::Document;
use crate::layout::{LayoutTree, Rect};
use crate::style::ComputedStyle;
use font8x8::{UnicodeFonts, BASIC_FONTS};
use minifb::{Window, WindowOptions};
use std::error::Error;

pub const WIDTH: usize = 900;
pub const HEIGHT: usize = 640;
const DEFAULT_BACKGROUND: u32 = 0xF7F7F7;
const FOREGROUND: u32 = 0x181818;
const MUTED: u32 = 0x555555;
const LINK: u32 = 0x0000CC;
pub const LEFT: usize = 24;
const TOP: usize = 18;
pub const PAGE_TOP: usize = 86;
pub const PAGE_WIDTH: u32 = (WIDTH - LEFT * 2) as u32;

const BACK_RECT: Rect = Rect {
    x: 24,
    y: 48,
    width: 28,
    height: 24,
};
const FORWARD_RECT: Rect = Rect {
    x: 58,
    y: 48,
    width: 28,
    height: 24,
};

pub fn create_window() -> Result<Window, Box<dyn Error>> {
    let mut window = Window::new(
        "browser-core 0.5 — navigation",
        WIDTH,
        HEIGHT,
        WindowOptions::default(),
    )?;
    window.set_target_fps(30);
    Ok(window)
}

pub fn paint(
    url: &str,
    document: &Document,
    styles: &[ComputedStyle],
    layout: &LayoutTree,
    can_back: bool,
    can_forward: bool,
) -> Vec<u32> {
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
        "browser-core 0.5",
        FOREGROUND,
        2,
    );

    draw_nav_button(&mut buffer, BACK_RECT, "<", can_back);
    draw_nav_button(&mut buffer, FORWARD_RECT, ">", can_forward);

    draw_text_line(
        &mut buffer,
        98,
        54,
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
        let color = if fragment.link.is_some() {
            LINK
        } else {
            style.color
        };

        draw_text_line(
            &mut buffer,
            screen_x,
            screen_y,
            &ascii_safe(&fragment.text),
            color,
            scale,
        );

        if fragment.link.is_some() {
            let underline_y = screen_y
                .saturating_add(fragment.rect.height as usize)
                .min(HEIGHT.saturating_sub(1));
            draw_horizontal_line(
                &mut buffer,
                screen_x,
                underline_y,
                fragment.rect.width as usize,
                color,
            );
        }
    }

    buffer
}

pub fn hit_test_navigation(x: u32, y: u32, layout: &LayoutTree) -> NavigationHit {
    if BACK_RECT.contains(x, y) {
        return NavigationHit::Back;
    }
    if FORWARD_RECT.contains(x, y) {
        return NavigationHit::Forward;
    }

    let page_x = x.saturating_sub(LEFT as u32);
    let page_y = y.saturating_sub(PAGE_TOP as u32);
    layout
        .hit_test_link(page_x, page_y)
        .map(NavigationHit::Link)
        .unwrap_or(NavigationHit::None)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationHit {
    None,
    Back,
    Forward,
    Link(crate::dom::NodeId),
}

fn draw_nav_button(buffer: &mut [u32], rect: Rect, label: &str, enabled: bool) {
    let fill = if enabled { 0xE5E5E5 } else { 0xF2F2F2 };
    let text = if enabled { FOREGROUND } else { 0xAAAAAA };
    fill_rect(buffer, rect, fill);
    draw_text_line(
        buffer,
        rect.x as usize + 10,
        rect.y as usize + 7,
        label,
        text,
        1,
    );
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

fn draw_horizontal_line(buffer: &mut [u32], x: usize, y: usize, width: usize, color: u32) {
    if y >= HEIGHT {
        return;
    }

    let end = x.saturating_add(width).min(WIDTH);
    let row = y * WIDTH;
    for px in x.min(WIDTH)..end {
        buffer[row + px] = color;
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
