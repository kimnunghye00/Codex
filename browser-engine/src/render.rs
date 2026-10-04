use font8x8::{UnicodeFonts, BASIC_FONTS};
use minifb::{Key, Window, WindowOptions};
use std::error::Error;

const WIDTH: usize = 900;
const HEIGHT: usize = 640;
const BACKGROUND: u32 = 0x00F7F7F7;
const FOREGROUND: u32 = 0x00181818;
const MUTED: u32 = 0x00555555;
const SCALE: usize = 2;
const GLYPH_WIDTH: usize = 8 * SCALE;
const GLYPH_HEIGHT: usize = 8 * SCALE;
const LINE_HEIGHT: usize = GLYPH_HEIGHT + 6;
const LEFT: usize = 24;
const TOP: usize = 22;

pub fn show(url: &str, body: &str) -> Result<(), Box<dyn Error>> {
    let mut window = Window::new(
        "browser-core 0.1 — own engine prototype",
        WIDTH,
        HEIGHT,
        WindowOptions::default(),
    )?;

    let mut buffer = vec![BACKGROUND; WIDTH * HEIGHT];

    draw_text(
        &mut buffer,
        LEFT,
        TOP,
        "browser-core 0.1",
        FOREGROUND,
        42,
    );
    draw_text(
        &mut buffer,
        LEFT,
        TOP + LINE_HEIGHT + 4,
        &ascii_safe(url),
        MUTED,
        48,
    );

    let content_top = TOP + (LINE_HEIGHT * 3);
    draw_text(
        &mut buffer,
        LEFT,
        content_top,
        &ascii_safe(body),
        FOREGROUND,
        52,
    );

    while window.is_open() && !window.is_key_down(Key::Escape) {
        window.update_with_buffer(&buffer, WIDTH, HEIGHT)?;
    }

    Ok(())
}

fn ascii_safe(input: &str) -> String {
    input
        .chars()
        .map(|ch| if ch.is_ascii() { ch } else { '?' })
        .collect()
}

fn draw_text(
    buffer: &mut [u32],
    start_x: usize,
    start_y: usize,
    text: &str,
    color: u32,
    max_columns: usize,
) {
    let mut column = 0;
    let mut row = 0;

    for ch in text.chars() {
        if ch == '\n' || column >= max_columns {
            row += 1;
            column = 0;
            if ch == '\n' {
                continue;
            }
        }

        let x = start_x + column * GLYPH_WIDTH;
        let y = start_y + row * LINE_HEIGHT;

        if y + GLYPH_HEIGHT >= HEIGHT {
            break;
        }

        draw_char(buffer, x, y, ch, color);
        column += 1;
    }
}

fn draw_char(buffer: &mut [u32], x: usize, y: usize, ch: char, color: u32) {
    let Some(glyph) = BASIC_FONTS.get(ch) else {
        return;
    };

    for (glyph_y, bits) in glyph.iter().enumerate() {
        for glyph_x in 0..8 {
            if bits & (1 << glyph_x) == 0 {
                continue;
            }

            for scale_y in 0..SCALE {
                for scale_x in 0..SCALE {
                    let px = x + glyph_x * SCALE + scale_x;
                    let py = y + glyph_y * SCALE + scale_y;
                    if px < WIDTH && py < HEIGHT {
                        buffer[py * WIDTH + px] = color;
                    }
                }
            }
        }
    }
}
