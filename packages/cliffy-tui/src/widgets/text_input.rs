use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

/// Simple text input widget
pub struct TextInput {
    pub value: String,
    pub cursor: usize,
    pub placeholder: String,
}

impl TextInput {
    pub fn new() -> Self {
        Self {
            value: String::new(),
            cursor: 0,
            placeholder: String::new(),
        }
    }

    pub fn with_placeholder(mut self, placeholder: &str) -> Self {
        self.placeholder = placeholder.to_string();
        self
    }

    pub fn with_value(mut self, value: &str) -> Self {
        self.value = value.to_string();
        self.cursor = self.value.len();
        self
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> bool {
        match key.code {
            KeyCode::Char(c) => {
                if key.modifiers.contains(KeyModifiers::CONTROL) {
                    match c {
                        'a' => self.cursor = 0,
                        'e' => self.cursor = self.value.len(),
                        'u' => {
                            self.value.drain(..self.cursor);
                            self.cursor = 0;
                        }
                        'k' => {
                            self.value.truncate(self.cursor);
                        }
                        'w' => {
                            // Delete word backward
                            let start = self.value[..self.cursor]
                                .rfind(|c: char| c.is_whitespace())
                                .map(|i| i + 1)
                                .unwrap_or(0);
                            self.value.drain(start..self.cursor);
                            self.cursor = start;
                        }
                        _ => return false,
                    }
                } else {
                    self.value.insert(self.cursor, c);
                    self.cursor += 1;
                }
                true
            }
            KeyCode::Backspace => {
                if self.cursor > 0 {
                    self.cursor -= 1;
                    self.value.remove(self.cursor);
                }
                true
            }
            KeyCode::Delete => {
                if self.cursor < self.value.len() {
                    self.value.remove(self.cursor);
                }
                true
            }
            KeyCode::Left => {
                if self.cursor > 0 {
                    self.cursor -= 1;
                }
                true
            }
            KeyCode::Right => {
                if self.cursor < self.value.len() {
                    self.cursor += 1;
                }
                true
            }
            KeyCode::Home => {
                self.cursor = 0;
                true
            }
            KeyCode::End => {
                self.cursor = self.value.len();
                true
            }
            _ => false,
        }
    }

    pub fn clear(&mut self) {
        self.value.clear();
        self.cursor = 0;
    }

    pub fn is_empty(&self) -> bool {
        self.value.is_empty()
    }
}

impl Default for TextInput {
    fn default() -> Self {
        Self::new()
    }
}
