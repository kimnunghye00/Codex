//! Lazily outline glyphs from broker-only trusted local fonts. Web fonts never enter this privileged parser.
use ab_glyph::{point, Font, FontArc};
use std::{cell::RefCell, collections::HashMap, fs, io::Read, path::PathBuf};
struct Glyph {
    width: usize,
    height: usize,
    bitmap: Vec<u8>,
    ymin: i32,
}
struct Fonts {
    font: Option<FontArc>,
    glyphs: HashMap<(char, usize), Glyph>,
}
thread_local! { static FONTS: RefCell<Fonts> = RefCell::new(Fonts { font: load(),glyphs: HashMap::new() }); }
fn load() -> Option<FontArc> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("BROWSER_CORE_FONT") {
        candidates.push(PathBuf::from(path));
    }
    #[cfg(windows)]
    if let Some(root) = std::env::var_os("WINDIR") {
        candidates.push(PathBuf::from(root).join("Fonts/malgun.ttf"));
    }
    #[cfg(not(windows))]
    candidates.extend(
        [
            "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
        .into_iter()
        .map(PathBuf::from),
    );
    for path in candidates {
        let Ok(file) = fs::File::open(path) else {
            continue;
        };
        let mut bytes = Vec::new();
        if file
            .take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .is_err()
            || bytes.len() > 32 * 1024 * 1024
        {
            continue;
        }
        if let Ok(font) = FontArc::try_from_vec(bytes) {
            return Some(font);
        }
    }
    None
}
#[allow(clippy::too_many_arguments)] // Explicit bounded framebuffer and glyph geometry.
pub fn draw(
    buffer: &mut [u32],
    x: usize,
    y: i64,
    ch: char,
    color: u32,
    scale: usize,
    clip_top: usize,
    cell_advance: usize,
) -> bool {
    FONTS.with(|fonts| {
        let mut fonts = fonts.borrow_mut();
        let key = (ch, scale);
        if !fonts.glyphs.contains_key(&key) {
            let Some(font) = fonts.font.as_ref() else {
                return false;
            };
            if font.glyph_id(ch).0 == 0 {
                return false;
            }
            let px = (8 * scale) as f32;
            let glyph = font
                .glyph_id(ch)
                .with_scale_and_position(px, point(0.0, 0.0));
            let bitmap = if let Some(outline) = font.outline_glyph(glyph) {
                let bounds = outline.px_bounds();
                let width = bounds.width() as usize;
                let height = bounds.height() as usize;
                if width > 128 || height > 128 {
                    return false;
                }
                let mut bitmap = vec![0u8; width * height];
                outline.draw(|x, y, coverage| {
                    bitmap[y as usize * width + x as usize] =
                        (coverage.clamp(0.0, 1.0) * 255.0) as u8;
                });
                Glyph {
                    width,
                    height,
                    ymin: -(bounds.max.y as i32),
                    bitmap,
                }
            } else {
                Glyph {
                    width: 0,
                    height: 0,
                    ymin: 0,
                    bitmap: Vec::new(),
                }
            };
            if fonts.glyphs.len() >= 256 {
                fonts.glyphs.clear();
            }
            fonts.glyphs.insert(key, bitmap);
        }
        let glyph = &fonts.glyphs[&key];
        let cell_width = crate::text_metrics::columns(ch) as usize * cell_advance;
        let cell_height = 8 * scale;
        let left = x + cell_width.saturating_sub(glyph.width) / 2;
        let top = y + (cell_height as i64 * 4 / 5) - glyph.ymin as i64 - glyph.height as i64;
        for gy in 0..glyph.height.min(cell_height) {
            let py = top + gy as i64;
            if py < clip_top as i64 || py >= crate::render::HEIGHT as i64 {
                continue;
            }
            for gx in 0..glyph.width.min(cell_width) {
                let px = left + gx;
                if px >= crate::render::WIDTH {
                    continue;
                }
                let alpha = glyph.bitmap[gy * glyph.width + gx] as u32;
                let index = py as usize * crate::render::WIDTH + px;
                let background = buffer[index];
                let mut output = 0;
                for shift in [0, 8, 16] {
                    let channel = (((color >> shift) & 255) * alpha
                        + ((background >> shift) & 255) * (255 - alpha))
                        / 255;
                    output |= channel << shift;
                }
                buffer[index] = output;
            }
        }
        true
    })
}
