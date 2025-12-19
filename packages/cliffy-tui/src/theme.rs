use ratatui::style::{Color, Modifier, Style};

// Primary colors
pub const PRIMARY: Color = Color::Cyan;
pub const SECONDARY: Color = Color::DarkGray;
pub const ACCENT: Color = Color::Yellow;

// Status colors
pub const SUCCESS: Color = Color::Green;
pub const WARNING: Color = Color::Yellow;
pub const ERROR: Color = Color::Red;
pub const INFO: Color = Color::Blue;

// Tab colors
pub const TAB_ACTIVE: Color = Color::Cyan;
pub const TAB_INACTIVE: Color = Color::DarkGray;

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

pub fn success_style() -> Style {
    Style::default().fg(SUCCESS)
}

pub fn error_style() -> Style {
    Style::default().fg(ERROR)
}

pub fn warning_style() -> Style {
    Style::default().fg(WARNING)
}

pub fn info_style() -> Style {
    Style::default().fg(INFO)
}

pub fn tab_style(active: bool) -> Style {
    if active {
        Style::default()
            .fg(TAB_ACTIVE)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(TAB_INACTIVE)
    }
}

pub fn key_hint_style() -> Style {
    Style::default().fg(Color::DarkGray)
}

pub fn key_style() -> Style {
    Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)
}

pub fn border_style(focused: bool) -> Style {
    if focused {
        Style::default().fg(PRIMARY)
    } else {
        Style::default().fg(SECONDARY)
    }
}
