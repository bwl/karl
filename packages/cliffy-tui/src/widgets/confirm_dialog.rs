/// Confirmation dialog state
pub struct ConfirmDialog {
    pub title: String,
    pub message: String,
    pub confirm_label: String,
    pub cancel_label: String,
    pub selected: bool, // true = confirm, false = cancel
}

impl ConfirmDialog {
    pub fn new(title: &str, message: &str) -> Self {
        Self {
            title: title.to_string(),
            message: message.to_string(),
            confirm_label: "Yes".to_string(),
            cancel_label: "No".to_string(),
            selected: false, // Default to cancel (safer)
        }
    }

    pub fn with_labels(mut self, confirm: &str, cancel: &str) -> Self {
        self.confirm_label = confirm.to_string();
        self.cancel_label = cancel.to_string();
        self
    }

    pub fn toggle(&mut self) {
        self.selected = !self.selected;
    }

    pub fn select_confirm(&mut self) {
        self.selected = true;
    }

    pub fn select_cancel(&mut self) {
        self.selected = false;
    }

    pub fn is_confirmed(&self) -> bool {
        self.selected
    }
}
