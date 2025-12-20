use crossterm::event::{KeyCode, KeyEvent};

/// Selector widget for choosing from a list of options
#[derive(Debug, Clone)]
pub struct Selector {
    pub options: Vec<String>,
    pub selected: usize,
}

impl Selector {
    pub fn new(options: Vec<String>) -> Self {
        Self {
            options,
            selected: 0,
        }
    }

    pub fn select_by_value(&mut self, value: &str) {
        if let Some(idx) = self.options.iter().position(|o| o == value) {
            self.selected = idx;
        }
    }

    pub fn next(&mut self) {
        if !self.options.is_empty() {
            self.selected = (self.selected + 1) % self.options.len();
        }
    }

    pub fn previous(&mut self) {
        if !self.options.is_empty() {
            self.selected = self.selected.checked_sub(1).unwrap_or(self.options.len() - 1);
        }
    }

    pub fn selected_value(&self) -> Option<&str> {
        self.options.get(self.selected).map(|s| s.as_str())
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> bool {
        match key.code {
            KeyCode::Left | KeyCode::Char('h') => {
                self.previous();
                true
            }
            KeyCode::Right | KeyCode::Char('l') | KeyCode::Enter | KeyCode::Char(' ') => {
                self.next();
                true
            }
            _ => false,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.options.is_empty()
    }

    pub fn len(&self) -> usize {
        self.options.len()
    }
}

impl Default for Selector {
    fn default() -> Self {
        Self::new(vec![])
    }
}
