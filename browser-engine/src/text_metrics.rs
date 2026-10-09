//! Shared cell advances keep renderer layout and broker text painting consistent.
pub fn columns(ch: char) -> u32 {
    if matches!(ch as u32, 0x1100..=0x11FF | 0x2E80..=0xA4CF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF | 0xFE10..=0xFE6F | 0xFF01..=0xFF60 | 0x1F300..=0x1FAFF | 0x20000..=0x3FFFF)
    {
        2
    } else {
        1
    }
}
pub fn width(text: &str) -> u32 {
    text.chars()
        .fold(0u32, |sum, ch| sum.saturating_add(columns(ch)))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn korean_cells_are_full_width() {
        assert_eq!(width("abc 한글"), 8);
    }
}
