use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Widget},
};

use crate::theme;

/// Validation result for a form field
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationResult {
    Valid,
    Invalid(String),
}

impl ValidationResult {
    pub fn is_valid(&self) -> bool {
        matches!(self, ValidationResult::Valid)
    }

    pub fn error_message(&self) -> Option<&str> {
        match self {
            ValidationResult::Invalid(msg) => Some(msg),
            ValidationResult::Valid => None,
        }
    }
}

impl Default for ValidationResult {
    fn default() -> Self {
        ValidationResult::Valid
    }
}

/// A rendered form field with label, input area, and optional error
pub struct FormFieldWidget<'a> {
    pub label: &'a str,
    pub value: &'a str,
    pub cursor: usize,
    pub focused: bool,
    pub required: bool,
    pub error: Option<&'a str>,
    pub hint: Option<&'a str>,
    pub placeholder: Option<&'a str>,
}

impl<'a> FormFieldWidget<'a> {
    pub fn new(label: &'a str, value: &'a str) -> Self {
        Self {
            label,
            value,
            cursor: value.len(),
            focused: false,
            required: false,
            error: None,
            hint: None,
            placeholder: None,
        }
    }

    pub fn focused(mut self, focused: bool) -> Self {
        self.focused = focused;
        self
    }

    pub fn cursor(mut self, cursor: usize) -> Self {
        self.cursor = cursor;
        self
    }

    pub fn required(mut self, required: bool) -> Self {
        self.required = required;
        self
    }

    pub fn error(mut self, error: Option<&'a str>) -> Self {
        self.error = error;
        self
    }

    pub fn hint(mut self, hint: Option<&'a str>) -> Self {
        self.hint = hint;
        self
    }

    pub fn placeholder(mut self, placeholder: Option<&'a str>) -> Self {
        self.placeholder = placeholder;
        self
    }

    /// Calculate the height needed to render this field
    pub fn height(&self) -> u16 {
        let mut h = 3; // Label + input box
        if self.error.is_some() {
            h += 1;
        }
        if self.hint.is_some() && self.focused {
            h += 1;
        }
        h
    }
}

impl Widget for FormFieldWidget<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.height < 2 {
            return;
        }

        let mut y = area.y;

        // Render label
        let label_style = if self.focused {
            theme::highlight_style()
        } else {
            theme::normal_style()
        };

        let required_marker = if self.required { " *" } else { "" };
        let label_line = Line::from(vec![
            Span::styled(self.label, label_style),
            Span::styled(required_marker, Style::default().fg(Color::Red)),
        ]);
        buf.set_line(area.x, y, &label_line, area.width);
        y += 1;

        // Render input box
        let input_area = Rect::new(area.x, y, area.width, 1);
        let border_style = if self.focused {
            Style::default().fg(theme::ACCENT)
        } else if self.error.is_some() {
            Style::default().fg(Color::Red)
        } else {
            Style::default().fg(theme::BORDER)
        };

        let display_value = if self.value.is_empty() {
            self.placeholder.unwrap_or("")
        } else {
            self.value
        };

        let value_style = if self.value.is_empty() {
            Style::default().fg(theme::MUTED)
        } else {
            theme::normal_style()
        };

        // Simple input rendering (value with cursor indicator)
        let mut display = String::new();
        if self.focused && !self.value.is_empty() {
            // Show cursor position
            for (i, c) in self.value.chars().enumerate() {
                if i == self.cursor {
                    display.push('|');
                }
                display.push(c);
            }
            if self.cursor >= self.value.len() {
                display.push('|');
            }
        } else {
            display = display_value.to_string();
        }

        let input_span = Span::styled(display, value_style);
        let input_line = Line::from(vec![
            Span::styled("[", border_style),
            input_span,
            Span::styled("]", border_style),
        ]);
        buf.set_line(input_area.x, input_area.y, &input_line, input_area.width);
        y += 1;

        // Render error if present
        if let Some(err) = self.error {
            if y < area.y + area.height {
                let error_line = Line::from(Span::styled(
                    format!("  {}", err),
                    Style::default().fg(Color::Red),
                ));
                buf.set_line(area.x, y, &error_line, area.width);
                y += 1;
            }
        }

        // Render hint if focused and present
        if self.focused {
            if let Some(hint) = self.hint {
                if y < area.y + area.height {
                    let hint_line = Line::from(Span::styled(
                        format!("  {}", hint),
                        Style::default().fg(theme::MUTED),
                    ));
                    buf.set_line(area.x, y, &hint_line, area.width);
                }
            }
        }
    }
}

/// Render a selector field
pub struct SelectorFieldWidget<'a> {
    pub label: &'a str,
    pub options: &'a [String],
    pub selected: usize,
    pub focused: bool,
}

impl<'a> SelectorFieldWidget<'a> {
    pub fn new(label: &'a str, options: &'a [String], selected: usize) -> Self {
        Self {
            label,
            options,
            selected,
            focused: false,
        }
    }

    pub fn focused(mut self, focused: bool) -> Self {
        self.focused = focused;
        self
    }
}

impl Widget for SelectorFieldWidget<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.height < 2 {
            return;
        }

        let mut y = area.y;

        // Render label
        let label_style = if self.focused {
            theme::highlight_style()
        } else {
            theme::normal_style()
        };
        buf.set_line(area.x, y, &Line::from(Span::styled(self.label, label_style)), area.width);
        y += 1;

        // Render options inline
        let mut spans = vec![Span::raw("  ")];
        for (i, opt) in self.options.iter().enumerate() {
            let is_selected = i == self.selected;
            let style = if is_selected {
                Style::default()
                    .fg(theme::ACCENT)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(theme::MUTED)
            };
            let prefix = if is_selected { "● " } else { "○ " };
            spans.push(Span::styled(format!("{}{}", prefix, opt), style));
            if i < self.options.len() - 1 {
                spans.push(Span::raw("  "));
            }
        }
        buf.set_line(area.x, y, &Line::from(spans), area.width);
    }
}

/// Render a toggle field
pub struct ToggleFieldWidget<'a> {
    pub label: &'a str,
    pub value: bool,
    pub focused: bool,
}

impl<'a> ToggleFieldWidget<'a> {
    pub fn new(label: &'a str, value: bool) -> Self {
        Self {
            label,
            value,
            focused: false,
        }
    }

    pub fn focused(mut self, focused: bool) -> Self {
        self.focused = focused;
        self
    }
}

impl Widget for ToggleFieldWidget<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.height < 1 {
            return;
        }

        let checkbox = if self.value { "[x]" } else { "[ ]" };
        let style = if self.focused {
            theme::highlight_style()
        } else {
            theme::normal_style()
        };

        let checkbox_style = if self.value {
            Style::default().fg(theme::ACCENT)
        } else {
            Style::default().fg(theme::MUTED)
        };

        let line = Line::from(vec![
            Span::styled(checkbox, checkbox_style),
            Span::raw(" "),
            Span::styled(self.label, style),
        ]);
        buf.set_line(area.x, area.y, &line, area.width);
    }
}
