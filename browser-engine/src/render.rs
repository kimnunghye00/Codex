use crate::ipc::{RenderPacket, WireRect};
use font8x8::{UnicodeFonts, BASIC_FONTS};
use minifb::{Window, WindowOptions};
use std::error::Error;

pub const WIDTH: usize = 900;
pub const HEIGHT: usize = 640;
const FOREGROUND: u32 = 0x181818;
const LINK: u32 = 0x0000CC;
const ERROR_TEXT: u32 = 0x9A1A1A;
pub const LEFT: usize = 24;

pub const PAGE_TOP: usize = 96;
pub const PAGE_WIDTH: u32 = (WIDTH - LEFT * 2) as u32;
pub const PAGE_VIEW_HEIGHT: u32 = (HEIGHT - PAGE_TOP) as u32;

const BACK_RECT: WireRect = WireRect {
    x: 24,
    y: 46,
    width: 28,
    height: 26,
};
const FORWARD_RECT: WireRect = WireRect {
    x: 58,
    y: 46,
    width: 28,
    height: 26,
};
pub const ADDRESS_RECT: WireRect = WireRect {
    x: 166,
    y: 44,
    width: 650,
    height: 30,
};

pub fn create_window() -> Result<Window, Box<dyn Error>> {
    let mut window = Window::new(
        "browser-core 0.10 — independent engine",
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
    packet: &RenderPacket,
    can_back: bool,
    can_forward: bool,
) -> Vec<u32> {
    let mut buffer = vec![0; WIDTH * HEIGHT];
    paint_into(
        &mut buffer,
        page_url,
        address_text,
        address_focused,
        status,
        scroll_y,
        packet,
        can_back,
        can_forward,
    );
    buffer
}

#[allow(clippy::too_many_arguments)]
pub fn paint_into(
    buffer: &mut [u32],
    page_url: &str,
    address_text: &str,
    address_focused: bool,
    status: Option<&str>,
    scroll_y: u32,
    packet: &RenderPacket,
    can_back: bool,
    can_forward: bool,
) {
    buffer.fill(packet.page_background);

    fill_rect(
        buffer,
        WireRect {
            x: 0,
            y: 0,
            width: WIDTH as u32,
            height: PAGE_TOP as u32,
        },
        0xFFFFFF,
    );

    draw_nav_button(buffer, BACK_RECT, "<", can_back);
    draw_nav_button(buffer, FORWARD_RECT, ">", can_forward);
    draw_nav_button(buffer, RELOAD_RECT, "R", true);
    draw_nav_button(buffer, HOME_RECT, "H", true);
    draw_address_bar(
        buffer,
        if address_focused {
            address_text
        } else {
            page_url
        },
        address_focused,
    );

    if let Some(message) = status {
        draw_text_line(buffer, 100, 78, &visible_tail(message, 94), ERROR_TEXT, 1);
    }

    for item in &packet.rects {
        if let Some(rect) = page_rect_to_screen(item.rect, scroll_y) {
            fill_rect(buffer, rect, item.color);
        }
    }

    for image in &packet.images {
        draw_image_fragment(buffer, image, scroll_y);
    }

    for text in &packet.texts {
        let top = PAGE_TOP as i64 + text.rect.y as i64 - scroll_y as i64;
        let bottom = top.saturating_add(text.rect.height as i64);

        if bottom <= PAGE_TOP as i64 || top >= HEIGHT as i64 {
            continue;
        }

        let screen_x = LEFT.saturating_add(text.rect.x as usize);

        let scale = font_scale(text.font_size);
        let color = if text.link_href.is_some() {
            LINK
        } else {
            text.color
        };

        draw_page_text_line(buffer, screen_x, top, &text.text, color, scale);

        if text.link_href.is_some() {
            let underline_y = (PAGE_TOP as i64 + text.rect.y as i64 - scroll_y as i64
                + text.rect.height as i64)
                .clamp(PAGE_TOP as i64, HEIGHT.saturating_sub(1) as i64)
                as usize;

            draw_horizontal_line(
                buffer,
                screen_x,
                underline_y,
                text.rect.width as usize,
                color,
            );
        }
    }
}

pub fn hit_test_navigation(x: u32, y: u32, scroll_y: u32, packet: &RenderPacket) -> NavigationHit {
    if (24..792).contains(&x) && (8..34).contains(&y) {
        return NavigationHit::Tab(((x - 24) / 48) as usize);
    }
    if NEW_TAB_RECT.contains(x, y) {
        return NavigationHit::NewTab;
    }
    if CLOSE_TAB_RECT.contains(x, y) {
        return NavigationHit::CloseTab;
    }
    if BOOKMARK_RECT.contains(x, y) {
        return NavigationHit::Bookmark;
    }
    if RELOAD_RECT.contains(x, y) {
        return NavigationHit::Reload;
    }
    if HOME_RECT.contains(x, y) {
        return NavigationHit::Home;
    }
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
    let page_y = y.saturating_sub(PAGE_TOP as u32).saturating_add(scroll_y);

    if let Some(href) = packet
        .images
        .iter()
        .rev()
        .find(|item| item.link_href.is_some() && item.rect.contains(page_x, page_y))
        .and_then(|item| item.link_href.clone())
    {
        return NavigationHit::Link(href);
    }

    if let Some(href) = packet
        .texts
        .iter()
        .rev()
        .find(|item| item.link_href.is_some() && item.rect.contains(page_x, page_y))
        .and_then(|item| item.link_href.clone())
    {
        return NavigationHit::Link(href);
    }

    NavigationHit::None
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NavigationHit {
    None,
    Back,
    Forward,
    AddressBar,
    Reload,
    Home,
    Bookmark,
    NewTab,
    CloseTab,
    Tab(usize),
    Link(String),
}

fn draw_image_fragment(buffer: &mut [u32], image: &crate::ipc::PaintImage, scroll_y: u32) {
    if image.source_width == 0
        || image.source_height == 0
        || image.rect.width == 0
        || image.rect.height == 0
    {
        return;
    }

    let screen_left = LEFT as i64 + image.rect.x as i64;
    let screen_top = PAGE_TOP as i64 + image.rect.y as i64 - scroll_y as i64;
    let screen_right = screen_left.saturating_add(image.rect.width as i64);
    let screen_bottom = screen_top.saturating_add(image.rect.height as i64);

    let left = screen_left.max(0) as usize;
    let top = screen_top.max(PAGE_TOP as i64) as usize;
    let right = screen_right.min(WIDTH as i64).max(0) as usize;
    let bottom = screen_bottom.min(HEIGHT as i64).max(0) as usize;

    if left >= right || top >= bottom {
        return;
    }

    for y in top..bottom {
        let relative_y = (y as i64 - screen_top).max(0) as u64;
        let src_y = ((relative_y * image.source_height as u64) / image.rect.height as u64)
            .min(image.source_height.saturating_sub(1) as u64) as u32;

        for x in left..right {
            let relative_x = (x as i64 - screen_left).max(0) as u64;
            let src_x = ((relative_x * image.source_width as u64) / image.rect.width as u64)
                .min(image.source_width.saturating_sub(1) as u64) as u32;

            let source_index = src_y as usize * image.source_width as usize + src_x as usize;
            let Some(&source) = image.pixels.get(source_index) else {
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

fn page_rect_to_screen(rect: WireRect, scroll_y: u32) -> Option<WireRect> {
    let top = PAGE_TOP as i64 + rect.y as i64 - scroll_y as i64;
    let bottom = top.saturating_add(rect.height as i64);

    if bottom <= PAGE_TOP as i64 || top >= HEIGHT as i64 {
        return None;
    }

    let clipped_top = top.max(PAGE_TOP as i64);
    let clipped_bottom = bottom.min(HEIGHT as i64);

    Some(WireRect {
        x: rect.x.saturating_add(LEFT as u32),
        y: clipped_top as u32,
        width: rect.width,
        height: clipped_bottom.saturating_sub(clipped_top) as u32,
    })
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
    let visible = visible_tail(text, max_chars);

    draw_text_line(
        buffer,
        ADDRESS_RECT.x as usize + 8,
        ADDRESS_RECT.y as usize + 10,
        &visible,
        FOREGROUND,
        1,
    );

    if focused {
        let cursor_x =
            (ADDRESS_RECT.x as usize + 8 + crate::text_metrics::width(&visible) as usize * 8)
                .min((ADDRESS_RECT.right() as usize).saturating_sub(5));
        draw_vertical_line(buffer, cursor_x, ADDRESS_RECT.y as usize + 7, 16, 0x2458A6);
    }
}

fn draw_nav_button(buffer: &mut [u32], rect: WireRect, label: &str, enabled: bool) {
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

fn fill_rect(buffer: &mut [u32], rect: WireRect, color: u32) {
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

fn draw_rect_border(buffer: &mut [u32], rect: WireRect, color: u32) {
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

fn draw_vertical_line(buffer: &mut [u32], x: usize, y: usize, height: usize, color: u32) {
    if x >= WIDTH {
        return;
    }

    let end = y.saturating_add(height).min(HEIGHT);
    for py in y.min(HEIGHT)..end {
        buffer[py * WIDTH + x] = color;
    }
}

fn font_scale(font_size: u16) -> usize {
    (font_size as usize).div_ceil(8).clamp(1, 6)
}

fn draw_text_line(buffer: &mut [u32], x: usize, y: usize, text: &str, color: u32, scale: usize) {
    let mut cursor_x = x;

    for ch in text.chars() {
        draw_char(buffer, cursor_x, y, ch, color, scale);
        cursor_x += crate::text_metrics::columns(ch) as usize * 8 * scale;

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

fn draw_char(buffer: &mut [u32], x: usize, y: usize, ch: char, color: u32, scale: usize) {
    if !ch.is_ascii() && crate::font::draw(buffer, x, y as i64, ch, color, scale, 0, 8 * scale) {
        return;
    }
    let Some(glyph) = BASIC_FONTS.get(if ch.is_ascii() { ch } else { '?' }) else {
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

const RELOAD_RECT: WireRect = WireRect {
    x: 92,
    y: 46,
    width: 28,
    height: 26,
};
const HOME_RECT: WireRect = WireRect {
    x: 126,
    y: 46,
    width: 28,
    height: 26,
};
const BOOKMARK_RECT: WireRect = WireRect {
    x: 834,
    y: 46,
    width: 40,
    height: 26,
};
const NEW_TAB_RECT: WireRect = WireRect {
    x: 800,
    y: 8,
    width: 28,
    height: 26,
};
const CLOSE_TAB_RECT: WireRect = WireRect {
    x: 834,
    y: 8,
    width: 40,
    height: 26,
};

pub fn paint_tabs(
    buffer: &mut [u32],
    urls: &[&str],
    active: usize,
    bookmarked: bool,
    loading: bool,
) {
    for (n, _) in urls.iter().enumerate() {
        let rect = WireRect {
            x: 24 + n as u32 * 48,
            y: 8,
            width: 44,
            height: 26,
        };
        fill_rect(buffer, rect, if active == n { 0xDCEBFF } else { 0xF0F2F6 });
        draw_rect_border(buffer, rect, if active == n { 0x366CC2 } else { 0xCDD3DC });
        draw_text_line(
            buffer,
            rect.x as usize + 8,
            16,
            &format!("{}{}", n + 1, if active == n && loading { "*" } else { "" }),
            FOREGROUND,
            1,
        );
    }
    draw_nav_button(buffer, NEW_TAB_RECT, "+", true);
    draw_nav_button(buffer, CLOSE_TAB_RECT, "X", true);
    draw_nav_button(
        buffer,
        BOOKMARK_RECT,
        if bookmarked { "*" } else { "+" },
        true,
    );
}

fn draw_page_text_line(buffer: &mut [u32], x: usize, y: i64, text: &str, color: u32, scale: usize) {
    let mut cursor = x;
    for ch in text.chars() {
        let advance = 4 * scale * crate::text_metrics::columns(ch) as usize;
        if !crate::font::draw(buffer, cursor, y, ch, color, scale, PAGE_TOP, 4 * scale) {
            draw_compact_fallback(buffer, cursor, y, ch, color, scale);
        }
        cursor = cursor.saturating_add(advance);
        if cursor >= WIDTH {
            break;
        }
    }
}
fn draw_compact_fallback(buffer: &mut [u32], x: usize, y: i64, ch: char, color: u32, scale: usize) {
    let Some(glyph) = BASIC_FONTS.get(if ch.is_ascii() { ch } else { '?' }) else {
        return;
    };
    for (gy, bits) in glyph.iter().enumerate() {
        for gx in 0..8 {
            if bits & (1 << gx) == 0 {
                continue;
            }
            for sy in 0..scale {
                for sx in 0..scale {
                    let px = x + (gx * scale + sx) / 2;
                    let py = y + (gy * scale + sy) as i64;
                    if px < WIDTH && py >= PAGE_TOP as i64 && py < HEIGHT as i64 {
                        buffer[py as usize * WIDTH + px] = color;
                    }
                }
            }
        }
    }
}
