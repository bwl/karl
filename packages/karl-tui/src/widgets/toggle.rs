use crossterm::event::{KeyCode, KeyEvent};

/// Toggle widget for boolean values
#[derive(Debug, Clone)]
pub struct Toggle {
    pub value: bool,
}

impl Toggle {
    pub fn new() -> Self {
        Self { value: false }
    }

    pub fn with_value(mut self, value: bool) -> Self {
        self.value = value;
        self
    }

    pub fn toggle(&mut self) {
        self.value = !self.value;
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> bool {
        match key.code {
            KeyCode::Char(' ') | KeyCode::Enter => {
                self.toggle();
                true
            }
            _ => false,
        }
    }
}

impl Default for Toggle {
    fn default() -> Self {
        Self::new()
    }
}
