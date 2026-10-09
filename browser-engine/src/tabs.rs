//! Tabs retain URL/history/scroll metadata only. There is one resident paint packet.
use crate::history::History;

pub const MAX_TABS: usize = 16;
pub const HOME: &str = "browser:home";

#[derive(Debug)]
pub struct Tab {
    pub id: u64,
    pub url: String,
    pub history: History,
    pub scroll: u32,
}

pub struct Tabs {
    pub entries: Vec<Tab>,
    pub active: usize,
    next_id: u64,
}

impl Tabs {
    pub fn new() -> Self {
        let mut tabs = Self {
            entries: Vec::new(),
            active: 0,
            next_id: 1,
        };
        tabs.open(HOME.to_string());
        tabs
    }
    pub fn current(&self) -> &Tab {
        &self.entries[self.active]
    }
    pub fn current_mut(&mut self) -> &mut Tab {
        &mut self.entries[self.active]
    }
    pub fn open(&mut self, url: String) -> bool {
        if self.entries.len() >= MAX_TABS {
            return false;
        }
        let mut history = History::new();
        history.push(url.clone());
        self.entries.push(Tab {
            id: self.next_id,
            url,
            history,
            scroll: 0,
        });
        self.next_id += 1;
        self.active = self.entries.len() - 1;
        true
    }
    pub fn select(&mut self, index: usize) -> bool {
        if index >= self.entries.len() || index == self.active {
            return false;
        }
        self.active = index;
        true
    }
    pub fn close(&mut self) {
        self.entries.remove(self.active);
        if self.entries.is_empty() {
            self.open(HOME.to_string());
        }
        self.active = self.active.min(self.entries.len() - 1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_tabs_and_unique_identity() {
        let mut tabs = Tabs::new();
        for _ in 1..MAX_TABS {
            assert!(tabs.open(HOME.into()));
        }
        assert!(!tabs.open(HOME.into()));
        let id = tabs.current().id;
        tabs.close();
        assert!(tabs.open(HOME.into()));
        assert_ne!(id, tabs.current().id);
    }
    #[test]
    fn closing_last_tab_leaves_home() {
        let mut tabs = Tabs::new();
        tabs.close();
        assert_eq!(tabs.entries.len(), 1);
        assert_eq!(tabs.current().url, HOME);
    }
    #[test]
    fn history_is_per_tab() {
        let mut tabs = Tabs::new();
        tabs.current_mut().history.push("https://a.test/".into());
        tabs.open("https://b.test/".into());
        assert!(!tabs.current().history.can_back());
        tabs.select(0);
        assert!(tabs.current().history.can_back());
    }
}
