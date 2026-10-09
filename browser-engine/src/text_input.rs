use minifb::{InputCallback, Key};
use std::{cell::RefCell, rc::Rc};
#[derive(Default)]
pub struct Input {
    pub chars: Vec<char>,
    surrogate: Option<u16>,
    down: Vec<Key>,
    pub shortcuts: Vec<Shortcut>,
}
#[derive(Clone, Copy)]
pub struct Shortcut {
    pub key: Key,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}
impl Input {
    fn key(&mut self, key: Key, state: bool) {
        if !state {
            self.down.retain(|k| *k != key);
            return;
        }
        if self.down.contains(&key) {
            return;
        }
        self.down.push(key);
        let ctrl = self.down.contains(&Key::LeftCtrl) || self.down.contains(&Key::RightCtrl);
        let alt = self.down.contains(&Key::LeftAlt) || self.down.contains(&Key::RightAlt);
        let shift = self.down.contains(&Key::LeftShift) || self.down.contains(&Key::RightShift);
        if self.shortcuts.len() < 256 {
            self.shortcuts.push(Shortcut {
                key,
                ctrl,
                alt,
                shift,
            });
        }
    }

    fn push(&mut self, code: u32) {
        // Windows WM_CHAR delivers UTF-16 units; X11 delivers Unicode scalars.
        if (0xD800..=0xDBFF).contains(&code) {
            self.surrogate = Some(code as u16);
            return;
        }
        let scalar = if (0xDC00..=0xDFFF).contains(&code) {
            match self.surrogate.take() {
                Some(high) => 0x10000 + ((high as u32 - 0xD800) << 10) + (code - 0xDC00),
                None => return,
            }
        } else {
            self.surrogate = None;
            code
        };
        if let Some(ch) = char::from_u32(scalar) {
            if !ch.is_control() && self.chars.len() < 8192 {
                self.chars.push(ch);
            }
        }
    }
}
pub struct Callback(pub Rc<RefCell<Input>>);
impl InputCallback for Callback {
    fn set_key_state(&mut self, key: Key, state: bool) {
        self.0.borrow_mut().key(key, state);
    }
    fn add_char(&mut self, code: u32) {
        self.0.borrow_mut().push(code);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commits_korean_and_utf16_emoji_once() {
        let mut input = Input::default();
        input.push('한' as u32);
        input.push(0xD83D);
        input.push(0xDE00);
        input.push(13);
        assert_eq!(input.chars, vec!['한', '😀']);
    }
    #[test]
    fn bounds_burst_input() {
        let mut input = Input::default();
        for _ in 0..9000 {
            input.push(65);
        }
        assert_eq!(input.chars.len(), 8192);
    }
    #[test]
    fn retains_shortcuts_released_between_frames() {
        let mut input = Input::default();
        input.key(Key::LeftCtrl, true);
        input.key(Key::T, true);
        input.key(Key::T, false);
        input.key(Key::LeftCtrl, false);
        assert!(input.shortcuts.iter().any(|s| s.ctrl && s.key == Key::T));
        assert!(input.down.is_empty());
    }
}
