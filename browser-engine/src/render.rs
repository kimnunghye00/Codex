use crate::dom::Document;
use crate::layout::{LayoutTree, Rect};
use crate::resources::ResourceSet;
use crate::style::ComputedStyle;
use font8x8::{UnicodeFonts, BASIC_FONTS};
use minifb::{Window, WindowOptions};
use std::error::Error;

pub const WIDTH: usize = 900;
pub const HEIGHT: usize = 640;
const DEFAULT_BACKGROUND: u32 = 0xF7F7F7;
const FOREGROUND: u32 = 0x181818;
const LINK: u32 = 0x0000CC;
const ERROR_TEXT: u32 = 0x9A1A1A;
pub const LEFT: usize = 24;
const TOP: usize = 14;
pub const PAGE_TOP: usize = 96;
pub const PAGE_WIDTH: u32 = (WIDTH - LEFT * 2) as u32;
pub const PAGE_VIEW_HEIGHT: u32 = (HEIGHT - PAGE_TOP) as u32;

const BACK_RECT: Rect = Rect {
    x: 24,
    y: 46,
    width: 28,
    height: 26,
};
const FORWARD_RECT: Rect = Rect {
    x: 58,
    y: 46,
    width: 28,
    height: 26,
};
pub const ADDRESS_RECT: Rect = Rect {
    x: 98,
    y: 44,
    width: 778,
    height: 30,
};

pub fn create_window() -> Result<Window, Box<dyn Error>> {
    let mut window = Window::new(
        "browser-core 0.6 — address bar, resources, scrolling",
        WIDTH,
        HEIGHT,
        WindowOptions::default(),
    )?;
    window.set_target_fps(30);
    Ok(window)
}

#[allow(clippy::too_many_arguments)]
pub fn paint(
    page_url: &str,
    address_text: &str,
    address_focused: bool,
    status: Option<&str>,
    scroll_y: u32,
    document: &Document,
    styles: &[ComputedStyle],
    layout: &LayoutTree,
    resources: &ResourceSet,
    can_back: bool,
    can_forward: bool,
) -> Vec<u32> {
    let body = document.find_first_element("body");
    let page_background = body
        .and_then(|id| styles.get(id as usize))
        .and_then(|style| style.background_color)
        .unwrap_or(DEFAULT_BACKGROUND);

    let mut buffer = vec![page_background; WIDTH * HEIGHT];

    fill_rect(
        &mut buffer,
        Rect {
            x: 0,
            y: 0,
            width: WIDTH as u32,
            height: PAGE_TOP as u32,
        },
        0xFFFFFF,
    );

    draw_text_line(
        &mut buffer,
        LEFT,
        TOP,
        "browser-core 0.6",
        FOREGROUND,
        2,
    );

    draw_nav_button(&mut buffer, BACK_RECT, "<", can_back);
    draw_nav_button(&mut buffer, FORWARD_RECT, ">", can_forward);
    draw_address_bar(
        &mut buffer,
        if address_focused {
            address_text
        } else {
            page_url
        },
        address_focused,
    );

    if let Some(message) = status {
        draw_text_line(
            &mut buffer,
            100,
            78,
            &visible_tail(&ascii_safe(message), 94),
            ERROR_TEXT,
            1,
        );
    }

    for layout_box in layout.boxes.iter().flatten() {
        let Some(style) = styles.get(layout_box.node as usize) else {
            continue;
        };
        let Some(color) = style.background_color else {
            continue;
        };

        if let Some(rect) = page_rect_to_screen(layout_box.rect, scroll_y) {
            fill_rect(&mut buffer, rect, color);
        }
    }

    for image_fragment in &layout.images {
        let Some(image) = resources.image(image_fragment.node) else {
            continue;
        };
        let Some(rect) = page_rect_to_screen(image_fragment.rect, scroll_y) else {
            continue;
        };

        draw_image(
            &mut buffer,
            rect,
            image.width,
            image.height,
            &image.pixels,
        );
    }

    for fragment in &layout.fragments {
        let style = styles
            .get(fragment.node as usize)
            .copied()
            .unwrap_or_default();
        let scale = font_scale(style.font_size);
        let top = PAGE_TOP as i64 + fragment.rect.y as i64 - scroll_y as i64;
        let bottom = top.saturating_add(fragment.rect.height as i64);

        if bottom <= PAGE_TOP as i64 || top >= HEIGHT as i64 {
            continue;
        }

        let screen_x = LEFT.saturating_add(fragment.rect.x as usize);
        let screen_y = top.max(PAGE_TOP as i64) as usize;
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
            let underline_y = (PAGE_TOP as i64
                + fragment.rect.y as i64
                - scroll_y as i64
                + fragment.rect.height as i64)
                .clamp(PAGE_TOP as i64, HEIGHT.saturating_sub(1) as i64)
                as usize;
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

pub fn hit_test_navigation(
    x: u32,
    y: u32,
    scroll_y: u32,
    layout: &LayoutTree,
) -> NavigationHit {
    if BACK_RECT.contains(x, y) {
        return NavigationHit::Back;
    }
    if FORWARD_RECT.contains(x, y) {
        return NavigationHit::Forward;
    }
    if ADDRESS_RECT.contains(x, y) {
        return NavigationHit::AddressBar;
    }
    if y < PAGE_TOP as u32 || x < LEFT as u32 {
        return NavigationHit::None;
    }

    let page_x = x.saturating_sub(LEFT as u32);
    let page_y = y
        .saturating_sub(PAGE_TOP as u32)
        .saturating_add(scroll_y);

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
    AddressBar,
    Link(crate::dom::NodeId),
}

fn draw_address_bar(buffer: &mut [u32], text: &str, focused: bool) {
    fill_rect(
        buffer,
        ADDRESS_RECT,
        if focused { 0xF9FCFF } else { 0xF3F3F3 },
    );
    draw_rect_border(
        buffer,
        ADDRESS_RECT,
        if focused { 0x4A78C2 } else { 0xCCCCCC },
    );

    let max_chars = ((ADDRESS_RECT.width as usize).saturating_sub(16)) / 8;
    let visible = visible_tail(&ascii_safe(text), max_chars);

    draw_text_line(
        buffer,
        ADDRESS_RECT.x as usize + 8,
        ADDRESS_RECT.y as usize + 10,
        &visible,
        FOREGROUND,
        1,
    );

    if focused {
        let cursor_x = (ADDRESS_RECT.x as usize + 8 + visible.chars().count() * 8)
            .min((ADDRESS_RECT.right() as usize).saturating_sub(5));
        draw_vertical_line(
            buffer,
            cursor_x,
            ADDRESS_RECT.y as usize + 7,
            16,
            0x2458A6,
        );
    }
}

fn page_rect_to_screen(rect: Rect, scroll_y: u32) -> Option<Rect> {
    let top = PAGE_TOP as i64 + rect.y as i64 - scroll_y as i64;
    let bottom = top.saturating_add(rect.height as i64);

    if bottom <= PAGE_TOP as i64 || top >= HEIGHT as i64 {
        return None;
    }

    let clipped_top = top.max(PAGE_TOP as i64);
    let clipped_bottom = bottom.min(HEIGHT as i64);

    Some(Rect {
        x: rect.x.saturating_add(LEFT as u32),
        y: clipped_top as u32,
        width: rect.width,
        height: clipped_bottom.saturating_sub(clipped_top) as u32,
    })
}

fn draw_image(
    buffer: &mut [u32],
    rect: Rect,
    source_width: u32,
    source_height: u32,
    pixels: &[u32],
) {
    if source_width == 0 || source_height == 0 || rect.width == 0 || rect.height == 0 {
        return;
    }

    let left = rect.x as usize;
    let top = rect.y as usize;
    let right = rect.right().min(WIDTH as u32) as usize;
    let bottom = rect.bottom().min(HEIGHT as u32) as usize;

    for y in top..bottom {
        let relative_y = (y as u32).saturating_sub(rect.y);
        let src_y = ((relative_y as u64 * source_height as u64) / rect.height as u64)
            .min(source_height.saturating_sub(1) as u64) as u32;

        for x in left..right {
            let relative_x = (x as u32).saturating_sub(rect.x);
            let src_x = ((relative_x as u64 * source_width as u64) / rect.width as u64)
                .min(source_width.saturating_sub(1) as u64) as u32;
            let index = src_y as usize * source_width as usize + src_x as usize;
            let Some(&source) = pixels.get(index) else {
                continue;
            };

            let alpha = (source >> 24) & 0xFF;
            let rgb = source & 0x00FF_FFFF;
            let dest_index = y * WIDTH + x;

            if alpha >= 255 {
                buffer[dest_index] = rgb;
            } else if alpha > 0 {
                buffer[dest_index] = blend(buffer[dest_index], rgb, alpha);
            }
        }
    }
}

fn blend(background: u32, foreground: u32, alpha: u32) -> u32 {
    let inv = 255 - alpha;

    let br = (background >> 16) & 0xFF;
    let bg = (background >> 8) & 0xFF;
    let bb = background & 0xFF;

    let fr = (foreground >> 16) & 0xFF;
    let fg = (foreground >> 8) & 0xFF;
    let fb = foreground & 0xFF;

    let r = (fr * alpha + br * inv) / 255;
    let g = (fg * alpha + bg * inv) / 255;
    let b = (fb * alpha + bb * inv) / 255;

    (r << 16) | (g << 8) | b
}

fn draw_nav_button(buffer: &mut [u32], rect: Rect, label: &str, enabled: bool) {
    let fill = if enabled { 0xE5E5E5 } else { 0xF2F2F2 };
    let text = if enabled { FOREGROUND } else { 0xAAAAAA };

    fill_rect(buffer, rect, fill);
    draw_rect_border(buffer, rect, 0xCCCCCC);
    draw_text_line(
        buffer,
        rect.x as usize + 10,
        rect.y as usize + 8,
        label,
        text,
        1,
    );
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

fn draw_rect_border(buffer: &mut [u32], rect: Rect, color: u32) {
    draw_horizontal_line(
        buffer,
        rect.x as usize,
        rect.y as usize,
        rect.width as usize,
        color,
    );
    draw_horizontal_line(
        buffer,
        rect.x as usize,
        rect.bottom().saturating_sub(1) as usize,
        rect.width as usize,
        color,
    );
    draw_vertical_line(
        buffer,
        rect.x as usize,
        rect.y as usize,
        rect.height as usize,
        color,
    );
    draw_vertical_line(
        buffer,
        rect.right().saturating_sub(1) as usize,
        rect.y as usize,
        rect.height as usize,
        color,
    );
}

fn draw_horizontal_line(
    buffer: &mut [u32],
    x: usize,
    y: usize,
    width: usize,
    color: u32,
) {
    if y >= HEIGHT {
        return;
    }

    let end = x.saturating_add(width).min(WIDTH);
    let row = y * WIDTH;
    for px in x.min(WIDTH)..end {
        buffer[row + px] = color;
    }
}

fn draw_vertical_line(
    buffer: &mut [u32],
    x: usize,
    y: usize,
    height: usize,
    color: u32,
) {
    if x >= WIDTH {
        return;
    }

    let end = y.saturating_add(height).min(HEIGHT);
    for py in y.min(HEIGHT)..end {
        buffer[py * WIDTH + x] = color;
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

fn visible_tail(input: &str, max_chars: usize) -> String {
    let count = input.chars().count();
    if count <= max_chars {
        return input.to_string();
    }

    input.chars().skip(count - max_chars).collect()
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
