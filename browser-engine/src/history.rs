const MAX_HISTORY_ENTRIES: usize = 256;

#[derive(Debug, Default)]
pub struct History {
    entries: Vec<Entry>,
    index: Option<usize>,
}

#[derive(Debug)]
struct Entry {
    url: String,
    post: bool,
}

impl History {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, url: String) {
        self.push_method(url, false);
    }

    pub fn push_method(&mut self, url: String, post: bool) {
        if let Some(index) = self.index {
            self.entries.truncate(index + 1);
        }

        if self
            .entries
            .last()
            .is_some_and(|e| e.url == url && e.post == post)
        {
            self.index = self.entries.len().checked_sub(1);
            return;
        }

        self.entries.push(Entry { url, post });

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
            .and_then(|target| self.entries.get(target).map(|e| e.url.as_str()))
    }

    pub fn forward_target(&self) -> Option<&str> {
        let index = self.index?;
        self.entries.get(index + 1).map(|e| e.url.as_str())
    }

    pub fn current_requires_submission(&self) -> bool {
        self.index
            .and_then(|i| self.entries.get(i))
            .is_some_and(|e| e.post)
    }
    pub fn back_requires_submission(&self) -> bool {
        self.index
            .and_then(|i| i.checked_sub(1))
            .and_then(|i| self.entries.get(i))
            .is_some_and(|e| e.post)
    }
    pub fn forward_requires_submission(&self) -> bool {
        self.index
            .and_then(|i| self.entries.get(i + 1))
            .is_some_and(|e| e.post)
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
    fn post_entries_preserve_method_without_retaining_submission_data() {
        let mut history = History::new();
        history.push("https://example.com/form".into());
        history.push_method("https://example.com/result".into(), true);
        assert!(history.current_requires_submission());
        history.push("https://example.com/next".into());
        assert!(history.back_requires_submission());
        history.commit_back();
        assert!(history.current_requires_submission());
        history.commit_back();
        assert!(history.forward_requires_submission());
        assert!(!history.current_requires_submission());
    }

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
        assert_eq!(history.entries[0].url, "https://example.com/");
    }
}
