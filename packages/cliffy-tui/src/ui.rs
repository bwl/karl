use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Tabs},
    Frame,
};

use crate::app::{App, InputMode, Tab, View};
use crate::theme;

/// Main draw function
pub fn draw(f: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Tab bar
            Constraint::Min(0),    // Content
            Constraint::Length(2), // Status bar
        ])
        .split(f.area());

    draw_tabs(f, app, chunks[0]);
    draw_content(f, app, chunks[1]);
    draw_status_bar(f, app, chunks[2]);

    // Draw confirm dialog overlay if active
    if app.confirm_dialog.is_some() {
        draw_confirm_dialog(f, app);
    }
}

/// Draw tab bar
fn draw_tabs(f: &mut Frame, app: &App, area: Rect) {
    let titles: Vec<Line> = Tab::all()
        .iter()
        .enumerate()
        .map(|(i, tab)| {
            let style = theme::tab_style(*tab == app.tab);
            Line::from(vec![
                Span::styled(format!("{}", i + 1), theme::dim_style()),
                Span::raw(" "),
                Span::styled(tab.name(), style),
            ])
        })
        .collect();

    let tabs = Tabs::new(titles)
        .block(
            Block::default()
                .borders(Borders::BOTTOM)
                .border_style(theme::border_style(false))
                .title(" cliffy config "),
        )
        .select(Tab::all().iter().position(|&t| t == app.tab).unwrap_or(0))
        .style(theme::normal_style())
        .highlight_style(theme::title_style())
        .divider(" │ ");

    f.render_widget(tabs, area);
}

/// Draw main content area
fn draw_content(f: &mut Frame, app: &mut App, area: Rect) {
    match app.tab {
        Tab::Models => draw_models(f, app, area),
        Tab::Stacks => draw_stacks(f, app, area),
        Tab::Skills => draw_skills(f, app, area),
        Tab::Tools => draw_tools(f, app, area),
        Tab::Hooks => draw_hooks(f, app, area),
        Tab::Settings => draw_settings(f, app, area),
    }
}

/// Draw models tab
fn draw_models(f: &mut Frame, app: &mut App, area: Rect) {
    match app.view {
        View::List => {
            let chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
                .split(area);

            draw_models_list(f, app, chunks[0]);
            draw_model_detail(f, app, chunks[1]);
        }
        View::Detail => draw_model_detail_full(f, app, area),
        _ => {}
    }
}

fn draw_models_list(f: &mut Frame, app: &mut App, area: Rect) {
    // Collect data first to avoid borrow issues
    let default_model = app.config.default_model.clone();
    let model_data: Vec<_> = app
        .models
        .filtered_items()
        .map(|model| (model.alias.clone(), model.config.provider.clone()))
        .collect();
    let count = app.models.len();
    let total = app.models.total_len();

    let items: Vec<ListItem> = model_data
        .iter()
        .map(|(alias, provider)| {
            let is_default = *alias == default_model;
            let marker = if is_default { "◍ " } else { "  " };
            ListItem::new(Line::from(vec![
                Span::styled(marker, theme::success_style()),
                Span::styled(alias.as_str(), theme::normal_style()),
                Span::styled(format!("  {}", provider), theme::dim_style()),
            ]))
        })
        .collect();

    let title = format!(" Models ({}/{}) ", count, total);

    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(theme::border_style(true))
                .title(title),
        )
        .highlight_style(theme::selected_style())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut app.models.list_state);

    // Draw search input if searching
    if app.input_mode == InputMode::Search && app.tab == Tab::Models {
        draw_search_input(f, &app.model_search.value, area);
    }
}

fn draw_model_detail(f: &mut Frame, app: &App, area: Rect) {
    let content = if let Some(model) = app.models.selected() {
        vec![
            Line::from(vec![
                Span::styled("Alias: ", theme::dim_style()),
                Span::styled(&model.alias, theme::normal_style()),
            ]),
            Line::from(vec![
                Span::styled("Provider: ", theme::dim_style()),
                Span::styled(&model.config.provider, theme::normal_style()),
            ]),
            Line::from(vec![
                Span::styled("Model: ", theme::dim_style()),
                Span::styled(&model.config.model, theme::normal_style()),
            ]),
            Line::from(""),
            Line::from(vec![Span::styled(
                if model.alias == app.config.default_model {
                    "✓ Default model"
                } else {
                    ""
                },
                theme::success_style(),
            )]),
        ]
    } else {
        vec![Line::from(Span::styled(
            "No model selected",
            theme::dim_style(),
        ))]
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(false))
        .title(" Details ");

    let paragraph = Paragraph::new(content).block(block);
    f.render_widget(paragraph, area);
}

fn draw_model_detail_full(f: &mut Frame, app: &App, area: Rect) {
    draw_model_detail(f, app, area);
}

/// Draw stacks tab
fn draw_stacks(f: &mut Frame, app: &mut App, area: Rect) {
    match app.view {
        View::List => {
            let chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
                .split(area);

            draw_stacks_list(f, app, chunks[0]);
            draw_stack_detail(f, app, chunks[1]);
        }
        View::Detail => draw_stack_detail_full(f, app, area),
        _ => {}
    }
}

fn draw_stacks_list(f: &mut Frame, app: &mut App, area: Rect) {
    // Collect data first to avoid borrow issues
    let stack_data: Vec<_> = app
        .stacks
        .filtered_items()
        .map(|stack| (stack.name.clone(), stack.source.clone()))
        .collect();
    let count = app.stacks.len();
    let total = app.stacks.total_len();

    let items: Vec<ListItem> = stack_data
        .iter()
        .map(|(name, source)| {
            let source_hint = if source == "inline" { " [inline]" } else { "" };
            ListItem::new(Line::from(vec![
                Span::styled(name.as_str(), theme::normal_style()),
                Span::styled(source_hint, theme::dim_style()),
            ]))
        })
        .collect();

    let title = format!(" Stacks ({}/{}) ", count, total);

    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(theme::border_style(true))
                .title(title),
        )
        .highlight_style(theme::selected_style())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut app.stacks.list_state);

    if app.input_mode == InputMode::Search && app.tab == Tab::Stacks {
        draw_search_input(f, &app.stack_search.value, area);
    }
}

fn draw_stack_detail(f: &mut Frame, app: &App, area: Rect) {
    let content = if let Some(stack) = app.stacks.selected() {
        let mut lines = vec![
            Line::from(vec![
                Span::styled("Name: ", theme::dim_style()),
                Span::styled(&stack.name, theme::normal_style()),
            ]),
        ];

        if let Some(ref extends) = stack.config.extends {
            lines.push(Line::from(vec![
                Span::styled("Extends: ", theme::dim_style()),
                Span::styled(extends, theme::info_style()),
            ]));
        }

        if let Some(ref model) = stack.config.model {
            lines.push(Line::from(vec![
                Span::styled("Model: ", theme::dim_style()),
                Span::styled(model, theme::normal_style()),
            ]));
        }

        if let Some(ref skill) = stack.config.skill {
            lines.push(Line::from(vec![
                Span::styled("Skill: ", theme::dim_style()),
                Span::styled(skill, theme::normal_style()),
            ]));
        }

        if let Some(temp) = stack.config.temperature {
            lines.push(Line::from(vec![
                Span::styled("Temperature: ", theme::dim_style()),
                Span::styled(format!("{:.1}", temp), theme::normal_style()),
            ]));
        }

        if let Some(timeout) = stack.config.timeout {
            lines.push(Line::from(vec![
                Span::styled("Timeout: ", theme::dim_style()),
                Span::styled(format!("{}ms", timeout), theme::normal_style()),
            ]));
        }

        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("Source: ", theme::dim_style()),
            Span::styled(&stack.source, theme::dim_style()),
        ]));

        lines
    } else {
        vec![Line::from(Span::styled(
            "No stack selected",
            theme::dim_style(),
        ))]
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(false))
        .title(" Details ");

    let paragraph = Paragraph::new(content).block(block);
    f.render_widget(paragraph, area);
}

fn draw_stack_detail_full(f: &mut Frame, app: &App, area: Rect) {
    draw_stack_detail(f, app, area);
}

/// Draw skills tab
fn draw_skills(f: &mut Frame, app: &mut App, area: Rect) {
    match app.view {
        View::List => {
            let chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
                .split(area);

            draw_skills_list(f, app, chunks[0]);
            draw_skill_detail(f, app, chunks[1]);
        }
        View::Detail => draw_skill_detail_full(f, app, area),
        _ => {}
    }
}

fn draw_skills_list(f: &mut Frame, app: &mut App, area: Rect) {
    // Collect data first to avoid borrow issues
    let skill_names: Vec<_> = app
        .skills
        .filtered_items()
        .map(|skill| skill.name.clone())
        .collect();
    let count = app.skills.len();
    let total = app.skills.total_len();

    let items: Vec<ListItem> = skill_names
        .iter()
        .map(|name| ListItem::new(Line::from(vec![Span::styled(name.as_str(), theme::normal_style())])))
        .collect();

    let title = format!(" Skills ({}/{}) ", count, total);

    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(theme::border_style(true))
                .title(title),
        )
        .highlight_style(theme::selected_style())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut app.skills.list_state);

    if app.input_mode == InputMode::Search && app.tab == Tab::Skills {
        draw_search_input(f, &app.skill_search.value, area);
    }
}

fn draw_skill_detail(f: &mut Frame, app: &App, area: Rect) {
    let content = if let Some(skill) = app.skills.selected() {
        let mut lines = vec![
            Line::from(vec![
                Span::styled("Name: ", theme::dim_style()),
                Span::styled(&skill.name, theme::normal_style()),
            ]),
            Line::from(""),
        ];

        if !skill.description.is_empty() {
            lines.push(Line::from(vec![Span::styled(
                &skill.description,
                theme::normal_style(),
            )]));
            lines.push(Line::from(""));
        }

        if let Some(ref license) = skill.license {
            lines.push(Line::from(vec![
                Span::styled("License: ", theme::dim_style()),
                Span::styled(license, theme::normal_style()),
            ]));
        }

        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("Path: ", theme::dim_style()),
            Span::styled(skill.path.to_string_lossy(), theme::dim_style()),
        ]));

        lines
    } else {
        vec![Line::from(Span::styled(
            "No skill selected",
            theme::dim_style(),
        ))]
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(false))
        .title(" Details ");

    let paragraph = Paragraph::new(content).block(block);
    f.render_widget(paragraph, area);
}

fn draw_skill_detail_full(f: &mut Frame, app: &App, area: Rect) {
    draw_skill_detail(f, app, area);
}

/// Draw tools tab
fn draw_tools(f: &mut Frame, app: &mut App, area: Rect) {
    // Collect data first to avoid borrow issues
    let tool_data: Vec<_> = app
        .tools
        .filtered_items()
        .map(|tool| (tool.name.clone(), tool.enabled, tool.is_builtin))
        .collect();
    let count = app.tools.len();

    let items: Vec<ListItem> = tool_data
        .iter()
        .map(|(name, enabled, is_builtin)| {
            let status = if *enabled { "✓" } else { " " };
            let status_style = if *enabled {
                theme::success_style()
            } else {
                theme::dim_style()
            };
            let type_hint = if *is_builtin { "" } else { " (custom)" };

            ListItem::new(Line::from(vec![
                Span::styled(format!("[{}] ", status), status_style),
                Span::styled(name.as_str(), theme::normal_style()),
                Span::styled(type_hint, theme::dim_style()),
            ]))
        })
        .collect();

    let title = format!(" Tools ({}) ", count);

    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(theme::border_style(true))
                .title(title),
        )
        .highlight_style(theme::selected_style())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut app.tools.list_state);
}

/// Draw hooks tab
fn draw_hooks(f: &mut Frame, app: &mut App, area: Rect) {
    match app.view {
        View::List => {
            let chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
                .split(area);

            draw_hooks_list(f, app, chunks[0]);
            draw_hook_detail(f, app, chunks[1]);
        }
        View::Detail => draw_hook_detail_full(f, app, area),
        _ => {}
    }
}

fn draw_hooks_list(f: &mut Frame, app: &mut App, area: Rect) {
    // Collect data first to avoid borrow issues
    let hook_data: Vec<_> = app
        .hooks
        .filtered_items()
        .map(|hook| (hook.name.clone(), hook.hook_type.clone()))
        .collect();
    let count = app.hooks.len();
    let total = app.hooks.total_len();

    let items: Vec<ListItem> = hook_data
        .iter()
        .map(|(name, hook_type)| {
            ListItem::new(Line::from(vec![
                Span::styled(name.as_str(), theme::normal_style()),
                Span::styled(format!("  [{}]", hook_type), theme::dim_style()),
            ]))
        })
        .collect();

    let title = format!(" Hooks ({}/{}) ", count, total);

    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(theme::border_style(true))
                .title(title),
        )
        .highlight_style(theme::selected_style())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut app.hooks.list_state);

    if app.input_mode == InputMode::Search && app.tab == Tab::Hooks {
        draw_search_input(f, &app.hook_search.value, area);
    }
}

fn draw_hook_detail(f: &mut Frame, app: &App, area: Rect) {
    let content = if let Some(hook) = app.hooks.selected() {
        vec![
            Line::from(vec![
                Span::styled("Name: ", theme::dim_style()),
                Span::styled(&hook.name, theme::normal_style()),
            ]),
            Line::from(vec![
                Span::styled("Type: ", theme::dim_style()),
                Span::styled(&hook.hook_type, theme::normal_style()),
            ]),
            Line::from(""),
            Line::from(vec![
                Span::styled("Path: ", theme::dim_style()),
                Span::styled(hook.path.to_string_lossy(), theme::dim_style()),
            ]),
        ]
    } else {
        vec![Line::from(Span::styled(
            "No hook selected",
            theme::dim_style(),
        ))]
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(false))
        .title(" Details ");

    let paragraph = Paragraph::new(content).block(block);
    f.render_widget(paragraph, area);
}

fn draw_hook_detail_full(f: &mut Frame, app: &App, area: Rect) {
    draw_hook_detail(f, app, area);
}

/// Draw settings tab
fn draw_settings(f: &mut Frame, app: &App, area: Rect) {
    let content = vec![
        Line::from(vec![Span::styled(
            "Volley Settings",
            theme::title_style(),
        )]),
        Line::from(""),
        Line::from(vec![
            Span::styled("Max Concurrent: ", theme::dim_style()),
            Span::styled(
                format!("{}", app.config.volley.max_concurrent),
                theme::normal_style(),
            ),
        ]),
        Line::from(vec![
            Span::styled("Retry Attempts: ", theme::dim_style()),
            Span::styled(
                format!("{}", app.config.volley.retry_attempts),
                theme::normal_style(),
            ),
        ]),
        Line::from(vec![
            Span::styled("Retry Backoff: ", theme::dim_style()),
            Span::styled(&app.config.volley.retry_backoff, theme::normal_style()),
        ]),
        Line::from(""),
        Line::from(vec![Span::styled("General", theme::title_style())]),
        Line::from(""),
        Line::from(vec![
            Span::styled("Default Model: ", theme::dim_style()),
            Span::styled(&app.config.default_model, theme::normal_style()),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("Config Path: ", theme::dim_style()),
            Span::styled(
                app.config_path.to_string_lossy(),
                theme::dim_style(),
            ),
        ]),
    ];

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(true))
        .title(" Settings ");

    let paragraph = Paragraph::new(content).block(block);
    f.render_widget(paragraph, area);
}

/// Draw status bar
fn draw_status_bar(f: &mut Frame, app: &App, area: Rect) {
    let mode_text = match app.input_mode {
        InputMode::Normal => "NORMAL",
        InputMode::Search => "SEARCH",
        InputMode::Editing => "EDIT",
    };

    let dirty_indicator = if app.dirty { " [modified]" } else { "" };

    let status = if let Some(ref msg) = app.status_message {
        msg.clone()
    } else {
        String::new()
    };

    let hints = match app.view {
        View::List => "j/k:navigate  /:search  Enter:select  d:delete  q:quit",
        View::Detail => "h/Esc:back  e:edit  q:quit",
        _ => "Esc:cancel  Enter:confirm",
    };

    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(10),
            Constraint::Length(12),
            Constraint::Min(0),
            Constraint::Length(50),
        ])
        .split(area);

    // Mode indicator
    let mode = Paragraph::new(mode_text)
        .style(
            Style::default()
                .fg(theme::PRIMARY)
                .add_modifier(Modifier::BOLD),
        )
        .alignment(Alignment::Center);
    f.render_widget(mode, chunks[0]);

    // Dirty indicator
    let dirty = Paragraph::new(dirty_indicator).style(theme::warning_style());
    f.render_widget(dirty, chunks[1]);

    // Status message
    let status_widget = Paragraph::new(status).style(theme::normal_style());
    f.render_widget(status_widget, chunks[2]);

    // Key hints
    let hints_widget = Paragraph::new(hints)
        .style(theme::dim_style())
        .alignment(Alignment::Right);
    f.render_widget(hints_widget, chunks[3]);
}

/// Draw search input overlay
fn draw_search_input(f: &mut Frame, value: &str, area: Rect) {
    let search_area = Rect {
        x: area.x + 1,
        y: area.y + area.height.saturating_sub(2),
        width: area.width.saturating_sub(2),
        height: 1,
    };

    let text = format!("/{}", value);
    let search = Paragraph::new(text).style(
        Style::default()
            .fg(theme::ACCENT)
            .add_modifier(Modifier::BOLD),
    );
    f.render_widget(search, search_area);
}

/// Draw confirm dialog overlay
fn draw_confirm_dialog(f: &mut Frame, app: &App) {
    if let Some(ref dialog) = app.confirm_dialog {
        let area = centered_rect(50, 30, f.area());

        // Clear background
        f.render_widget(Clear, area);

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(theme::border_style(true))
            .title(format!(" {} ", dialog.title));

        let inner = block.inner(area);
        f.render_widget(block, area);

        // Message
        let msg = Paragraph::new(dialog.message.as_str())
            .style(theme::normal_style())
            .alignment(Alignment::Center);

        let msg_area = Rect {
            x: inner.x,
            y: inner.y + 1,
            width: inner.width,
            height: 2,
        };
        f.render_widget(msg, msg_area);

        // Buttons
        let button_area = Rect {
            x: inner.x,
            y: inner.y + inner.height - 2,
            width: inner.width,
            height: 1,
        };

        let cancel_style = if !dialog.selected {
            theme::selected_style()
        } else {
            theme::normal_style()
        };
        let confirm_style = if dialog.selected {
            theme::selected_style()
        } else {
            theme::normal_style()
        };

        let buttons = Line::from(vec![
            Span::raw("    "),
            Span::styled(format!(" {} ", dialog.cancel_label), cancel_style),
            Span::raw("    "),
            Span::styled(format!(" {} ", dialog.confirm_label), confirm_style),
            Span::raw("    "),
        ]);

        let buttons_widget = Paragraph::new(buttons).alignment(Alignment::Center);
        f.render_widget(buttons_widget, button_area);
    }
}

/// Create a centered rect
fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}
