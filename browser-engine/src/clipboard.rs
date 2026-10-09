//! Only an explicit Ctrl+V action reads the clipboard; renderer has no access.
#[cfg(windows)]
pub fn read_text() -> Result<String, String> {
    use windows_sys::Win32::System::{
        DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard},
        Memory::{GlobalLock, GlobalSize, GlobalUnlock},
    };
    struct Close;
    impl Drop for Close {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }
    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return Err("Clipboard is busy".into());
        }
        let _close = Close;
        let handle = GetClipboardData(13); // CF_UNICODETEXT
        if handle.is_null() {
            return Err("Clipboard does not contain text".into());
        }
        let size = GlobalSize(handle);
        if size < 2 || size > 64 * 1024 || size % 2 != 0 {
            return Err("Clipboard text is too large or malformed".into());
        }
        let pointer = GlobalLock(handle) as *const u16;
        if pointer.is_null() {
            return Err("Cannot read clipboard text".into());
        }
        let units = std::slice::from_raw_parts(pointer, size / 2);
        let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
        let text = String::from_utf16_lossy(&units[..end]);
        GlobalUnlock(handle);
        if text.len() > crate::net::MAX_URL_BYTES {
            return Err("Pasted address is too long".into());
        }
        Ok(text.chars().filter(|ch| !ch.is_control()).collect())
    }
}
#[cfg(not(windows))]
pub fn read_text() -> Result<String, String> {
    Err("Clipboard paste is currently supported on Windows only".into())
}
