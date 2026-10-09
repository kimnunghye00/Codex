const MAX_HISTORY_ENTRIES: usize = 256;

#[derive(Debug, Default)]
pub struct History {
    entries: Vec<String>,
    index: Option<usize>,
}

impl History {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, url: String) {
        if let Some(index) = self.index {
            self.entries.truncate(index + 1);
        }

        if self.entries.last().map(String::as_str) == Some(url.as_str()) {
            self.index = self.entries.len().checked_sub(1);
            return;
        }

        self.entries.push(url);

        if self.entries.len() > MAX_HISTORY_ENTRIES {
            let overflow = self.entries.len() - MAX_HISTORY_ENTRIES;
            self.entries.drain(0..overflow);
        }

        self.index = self.entries.len().checked_sub(1);
    }

    pub fn can_back(&self) -> bool {
        matches!(self.index, Some(index) if index > 0)
    }

    pub fn can_forward(&self) -> bool {
        matches!(self.index, Some(index) if index + 1 < self.entries.len())
    }

    pub fn back_target(&self) -> Option<&str> {
        let index = self.index?;
        index
            .checked_sub(1)
            .and_then(|target| self.entries.get(target).map(String::as_str))
    }

    pub fn forward_target(&self) -> Option<&str> {
        let index = self.index?;
        self.entries.get(index + 1).map(String::as_str)
    }

    pub fn commit_back(&mut self) {
        if self.can_back() {
            self.index = self.index.map(|index| index - 1);
        }
    }

    pub fn commit_forward(&mut self) {
        if self.can_forward() {
            self.index = self.index.map(|index| index + 1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_forward_history_after_new_navigation() {
        let mut history = History::new();
        history.push("https://a.test/".into());
        history.push("https://b.test/".into());
        history.push("https://c.test/".into());

        assert_eq!(history.back_target(), Some("https://b.test/"));
        history.commit_back();
        history.push("https://d.test/".into());

        assert!(!history.can_forward());
        assert_eq!(history.back_target(), Some("https://b.test/"));
    }

    #[test]
    fn stores_urls_not_page_objects() {
        let mut history = History::new();
        history.push("https://example.com/".into());
        assert_eq!(history.entries.len(), 1);
        assert_eq!(history.entries[0], "https://example.com/");
    }
}
