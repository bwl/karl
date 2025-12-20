use ratatui::style::{Color, Modifier, Style};

// Primary colors
pub const PRIMARY: Color = Color::Cyan;
pub const SECONDARY: Color = Color::DarkGray;
pub const ACCENT: Color = Color::Yellow;
pub const MUTED: Color = Color::DarkGray;
pub const BORDER: Color = Color::DarkGray;

// Status colors
pub const SUCCESS: Color = Color::Green;
pub const WARNING: Color = Color::Yellow;

// List colors
pub const LIST_SELECTED_BG: Color = Color::DarkGray;
pub const LIST_HIGHLIGHT: Color = Color::Cyan;

// Styles
pub fn title_style() -> Style {
    Style::default().fg(PRIMARY).add_modifier(Modifier::BOLD)
}

pub fn selected_style() -> Style {
    Style::default()
        .bg(LIST_SELECTED_BG)
        .fg(LIST_HIGHLIGHT)
        .add_modifier(Modifier::BOLD)
}

pub fn normal_style() -> Style {
    Style::default().fg(Color::White)
}

pub fn dim_style() -> Style {
    Style::default().fg(Color::DarkGray)
}

pub fn highlight_style() -> Style {
    Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)
}

pub fn success_style() -> Style {
    Style::default().fg(SUCCESS)
}

pub fn warning_style() -> Style {
    Style::default().fg(WARNING)
}

pub fn border_style(focused: bool) -> Style {
    if focused {
        Style::default().fg(PRIMARY)
    } else {
        Style::default().fg(SECONDARY)
    }
}
