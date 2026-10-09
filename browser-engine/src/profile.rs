//! Explicit bookmarks only: no cookies, passwords, browsing history or session URLs.
use crate::net;
use std::{
    fs, io,
    io::Read,
    path::{Path, PathBuf},
};
const MAX_BOOKMARKS: usize = 128;
const MAX_PROFILE_BYTES: u64 = 1024 * 1024;

#[derive(Default)]
pub struct Profile {
    pub bookmarks: Vec<String>,
}

impl Profile {
    pub fn path() -> Option<PathBuf> {
        #[cfg(windows)]
        let root = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        #[cfg(not(windows))]
        let root = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".local/share")));
        root.map(|p| p.join("browser-core").join("bookmarks.txt"))
    }
    pub fn load(path: &Path) -> io::Result<Self> {
        let mut bytes = Vec::new();
        fs::File::open(path)?
            .take(MAX_PROFILE_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_PROFILE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "bookmark file too large",
            ));
        }
        let mut profile = Self::default();
        for line in String::from_utf8_lossy(&bytes).lines() {
            if let Ok(url) = net::resolve_https_url("https://example.com/", line) {
                if line.starts_with("https://")
                    && !profile.bookmarks.contains(&url)
                    && profile.bookmarks.len() < MAX_BOOKMARKS
                {
                    profile.bookmarks.push(url);
                }
            }
        }
        Ok(profile)
    }
    pub fn toggle(&mut self, url: &str) -> Result<(), String> {
        if let Some(index) = self.bookmarks.iter().position(|p| p == url) {
            self.bookmarks.remove(index);
            return Ok(());
        }
        net::resolve_https_url(url, url).map_err(|e| e.to_string())?;
        if self.bookmarks.len() >= MAX_BOOKMARKS {
            return Err("Bookmark limit reached (128)".into());
        }
        self.bookmarks.push(url.into());
        Ok(())
    }
    pub fn save(&self, path: &Path) -> io::Result<()> {
        let parent = path
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid profile path"))?;
        fs::create_dir_all(parent)?;
        // Same-directory replace; a failed save does not destroy the previous file.
        let temporary = parent.join(format!("bookmarks-{}.tmp", std::process::id()));
        let result = (|| {
            use io::Write;
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(self.bookmarks.join("\n").as_bytes())?;
            file.sync_all()?;
            drop(file);
            #[cfg(not(windows))]
            fs::rename(&temporary, path)?;
            #[cfg(windows)]
            {
                use std::os::windows::ffi::OsStrExt;
                use windows_sys::Win32::Storage::FileSystem::{
                    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
                };
                let from: Vec<_> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
                let to: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
                if unsafe {
                    MoveFileExW(
                        from.as_ptr(),
                        to.as_ptr(),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                    )
                } == 0
                {
                    return Err(io::Error::last_os_error());
                }
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_and_bounds_bookmarks() {
        let mut p = Profile::default();
        assert!(p.toggle("javascript:alert(1)").is_err());
        for n in 0..MAX_BOOKMARKS {
            p.toggle(&format!("https://example.com/{n}")).unwrap();
        }
        assert!(p.toggle("https://example.com/extra").is_err());
        p.toggle("https://example.com/0").unwrap();
        assert_eq!(p.bookmarks.len(), MAX_BOOKMARKS - 1);
    }
    #[test]
    fn save_replace_and_read_round_trip() {
        let dir = std::env::temp_dir().join(format!("browser-profile-test-{}", std::process::id()));
        let path = dir.join("bookmarks.txt");
        let mut p = Profile::default();
        p.toggle("https://example.com/").unwrap();
        p.save(&path).unwrap();
        p.toggle("https://example.com/next").unwrap();
        p.save(&path).unwrap();
        assert_eq!(Profile::load(&path).unwrap().bookmarks, p.bookmarks);
        fs::remove_dir_all(dir).unwrap();
    }
}
