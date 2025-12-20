use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph},
    Frame,
};

use crate::app::{App, FormMode, InitStep, InputMode, OAuthStatus, ProviderOption, Section, View};
use crate::theme;
use crate::widgets::{FormFieldWidget, ToggleFieldWidget};

/// Main draw function
pub fn draw(f: &mut Frame, app: &mut App) {
    // Check if we're in wizard mode - takes over entire UI
    if app.init_wizard.is_some() {
        draw_wizard(f, app);
        return;
    }

    // Check if we're in a form view - take over the whole screen
    if app.view == View::Edit || app.view == View::Create {
        match app.section {
            Section::Models => draw_model_form(f, app, f.area()),
            Section::Stacks => draw_stack_form(f, app, f.area()),
            Section::Tools => draw_tool_form(f, app, f.area()),
            _ => draw_stacked_page(f, app),
        }
    } else {
        draw_stacked_page(f, app);
    }

    // Draw confirm dialog overlay if active
    if app.confirm_dialog.is_some() {
        draw_confirm_dialog(f, app);
    }
}

/// Draw the main stacked page layout
fn draw_stacked_page(f: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1), // Title bar
            Constraint::Min(0),    // Content
            Constraint::Length(2), // Status bar
        ])
        .split(f.area());

    draw_title_bar(f, app, chunks[0]);
    draw_content(f, app, chunks[1]);
    draw_status_bar(f, app, chunks[2]);
}

/// Draw title bar
fn draw_title_bar(f: &mut Frame, _app: &App, area: Rect) {
    let title = Paragraph::new(Line::from(vec![
        Span::styled(" cliffy ", theme::title_style()),
        Span::styled("config", theme::dim_style()),
    ]));
    f.render_widget(title, area);
}

/// Draw main content - all sections stacked
fn draw_content(f: &mut Frame, app: &mut App, area: Rect) {
    // Calculate heights for each section
    // Settings gets fixed height, others split remaining space
    let settings_height = 12u16;
    let remaining = area.height.saturating_sub(settings_height);
    let section_height = remaining / 5; // 5 list sections

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(settings_height),  // Settings
            Constraint::Length(section_height),   // Models
            Constraint::Length(section_height),   // Stacks
            Constraint::Length(section_height),   // Skills
            Constraint::Length(section_height),   // Tools
            Constraint::Min(section_height),      // Hooks (takes remaining)
        ])
        .split(area);

    draw_settings_section(f, app, chunks[0]);
    draw_models_section(f, app, chunks[1]);
    draw_stacks_section(f, app, chunks[2]);
    draw_skills_section(f, app, chunks[3]);
    draw_tools_section(f, app, chunks[4]);
    draw_hooks_section(f, app, chunks[5]);
}

/// Draw settings section
fn draw_settings_section(f: &mut Frame, app: &App, area: Rect) {
    use crate::cli::CliStatus;

    let is_focused = app.section == Section::Settings;
    let mut lines: Vec<Line> = vec![];

    // Providers info
    match &app.cli_status {
        CliStatus::Loading => {
            lines.push(Line::from(Span::styled("  Loading...", theme::dim_style())));
        }
        CliStatus::NotAvailable => {
            lines.push(Line::from(Span::styled("  CLI not found", theme::dim_style())));
        }
        CliStatus::Error(e) => {
            lines.push(Line::from(Span::styled(format!("  Error: {}", e), theme::dim_style())));
        }
        CliStatus::Loaded(info) => {
            // Show auth status for all providers
            for (name, auth) in &info.auth {
                let (icon, status) = if auth.authenticated {
                    if auth.method == "oauth" {
                        ("✓", "logged in")
                    } else {
                        ("✓", "API key set")
                    }
                } else {
                    if auth.method == "none" && info.providers.get(name).map(|p| p.provider_type.as_str()) == Some("anthropic") {
                        ("○", "not logged in [L]")
                    } else {
                        ("○", "no key")
                    }
                };
                lines.push(Line::from(vec![
                    Span::styled(format!("  {} ", icon), if auth.authenticated {
                        Style::default().fg(Color::Green)
                    } else {
                        theme::dim_style()
                    }),
                    Span::styled(format!("{}: ", name), theme::normal_style()),
                    Span::styled(status, theme::dim_style()),
                ]));
            }

            lines.push(Line::from(""));

            // Config info
            lines.push(Line::from(vec![
                Span::styled("  Default model: ", theme::dim_style()),
                Span::styled(&app.config.default_model, theme::normal_style()),
            ]));

            // Summary line
            lines.push(Line::from(vec![
                Span::styled(format!(
                    "  {} models  {} stacks  {} skills  {} hooks",
                    info.counts.models,
                    info.counts.stacks,
                    info.counts.skills,
                    info.counts.hooks,
                ), theme::dim_style()),
            ]));
        }
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(is_focused))
        .title(section_title("1 Settings", is_focused));

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}

/// Draw models section
fn draw_models_section(f: &mut Frame, app: &mut App, area: Rect) {
    let is_focused = app.section == Section::Models;
    let default_model = app.config.default_model.clone();

    // Collect data first to avoid borrow issues
    let model_data: Vec<_> = app
        .models
        .filtered_items()
        .map(|model| (model.alias.clone(), model.config.provider.clone()))
        .collect();
    let count = app.models.len();

    let items: Vec<ListItem> = model_data
        .iter()
        .map(|(alias, provider)| {
            let is_default = *alias == default_model;
            let marker = if is_default { "◍" } else { " " };
            ListItem::new(Line::from(vec![
                Span::styled(marker, theme::success_style()),
                Span::raw(" "),
                Span::styled(alias.as_str(), theme::normal_style()),
                Span::styled(format!("  {}", provider), theme::dim_style()),
            ]))
        })
        .collect();

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(is_focused))
        .title(section_title(&format!("2 Models ({})", count), is_focused));

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::selected_style())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut app.models.list_state);

    if app.input_mode == InputMode::Search && app.section == Section::Models {
        draw_search_input(f, &app.model_search.value, area);
    }
}

/// Draw stacks section
fn draw_stacks_section(f: &mut Frame, app: &mut App, area: Rect) {
    let is_focused = app.section == Section::Stacks;

    // Collect data first to avoid borrow issues
    let stack_data: Vec<_> = app
        .stacks
        .filtered_items()
        .map(|stack| (stack.name.clone(), stack.source.clone()))
        .collect();
    let count = app.stacks.len();

    let items: Vec<ListItem> = stack_data
        .iter()
        .map(|(name, source)| {
            let source_hint = if source == "inline" { " [i]" } else { "" };
            ListItem::new(Line::from(vec![
                Span::styled(name.as_str(), theme::normal_style()),
                Span::styled(source_hint, theme::dim_style()),
            ]))
        })
        .collect();

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(is_focused))
        .title(section_title(&format!("3 Stacks ({})", count), is_focused));

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::selected_style())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut app.stacks.list_state);

    if app.input_mode == InputMode::Search && app.section == Section::Stacks {
        draw_search_input(f, &app.stack_search.value, area);
    }
}

/// Draw skills section
fn draw_skills_section(f: &mut Frame, app: &mut App, area: Rect) {
    let is_focused = app.section == Section::Skills;

    // Collect data first to avoid borrow issues
    let skill_names: Vec<_> = app
        .skills
        .filtered_items()
        .map(|skill| skill.name.clone())
        .collect();
    let count = app.skills.len();

    let items: Vec<ListItem> = skill_names
        .iter()
        .map(|name| {
            ListItem::new(Line::from(vec![
                Span::styled(name.as_str(), theme::normal_style()),
            ]))
        })
        .collect();

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(is_focused))
        .title(section_title(&format!("4 Skills ({})", count), is_focused));

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::selected_style())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut app.skills.list_state);

    if app.input_mode == InputMode::Search && app.section == Section::Skills {
        draw_search_input(f, &app.skill_search.value, area);
    }
}

/// Draw tools section
fn draw_tools_section(f: &mut Frame, app: &mut App, area: Rect) {
    let is_focused = app.section == Section::Tools;

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
            let status_style = if *enabled { theme::success_style() } else { theme::dim_style() };
            let type_hint = if *is_builtin { "" } else { " (custom)" };
            ListItem::new(Line::from(vec![
                Span::styled(format!("[{}] ", status), status_style),
                Span::styled(name.as_str(), theme::normal_style()),
                Span::styled(type_hint, theme::dim_style()),
            ]))
        })
        .collect();

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(is_focused))
        .title(section_title(&format!("5 Tools ({})", count), is_focused));

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::selected_style())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut app.tools.list_state);
}

/// Draw hooks section
fn draw_hooks_section(f: &mut Frame, app: &mut App, area: Rect) {
    let is_focused = app.section == Section::Hooks;

    // Collect data first to avoid borrow issues
    let hook_data: Vec<_> = app
        .hooks
        .filtered_items()
        .map(|hook| (hook.name.clone(), hook.hook_type.clone()))
        .collect();
    let count = app.hooks.len();

    let items: Vec<ListItem> = hook_data
        .iter()
        .map(|(name, hook_type)| {
            ListItem::new(Line::from(vec![
                Span::styled(name.as_str(), theme::normal_style()),
                Span::styled(format!("  [{}]", hook_type), theme::dim_style()),
            ]))
        })
        .collect();

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(is_focused))
        .title(section_title(&format!("6 Hooks ({})", count), is_focused));

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::selected_style())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut app.hooks.list_state);

    if app.input_mode == InputMode::Search && app.section == Section::Hooks {
        draw_search_input(f, &app.hook_search.value, area);
    }
}

/// Create a section title with focus indicator
fn section_title(name: &str, focused: bool) -> Span<'static> {
    let style = if focused {
        theme::title_style()
    } else {
        theme::dim_style()
    };
    Span::styled(format!(" {} ", name), style)
}

/// Draw model create/edit form
fn draw_model_form(f: &mut Frame, app: &App, area: Rect) {
    let form = match &app.model_form {
        Some(f) => f,
        None => return,
    };

    let title = match form.mode {
        FormMode::Create => " New Model ",
        FormMode::Edit => " Edit Model ",
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(true))
        .title(title);

    let inner = block.inner(area);
    f.render_widget(block, area);

    // Layout fields vertically
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(3), // Alias
            Constraint::Length(3), // Provider
            Constraint::Length(3), // Model
            Constraint::Length(2), // Set as default toggle
            Constraint::Min(0),    // Spacer
            Constraint::Length(1), // Help line
        ])
        .split(inner);

    // Alias field
    let alias_widget = FormFieldWidget::new("Alias", &form.alias.value)
        .focused(form.focused_field == 0)
        .cursor(form.alias.cursor)
        .required(true)
        .placeholder(Some(&form.alias.placeholder));
    f.render_widget(alias_widget, chunks[0]);

    // Provider field (selector)
    let provider_focused = form.focused_field == 1;
    let provider_value = form.provider.selected_value().unwrap_or("(none)");
    let provider_display = if form.provider.len() > 1 {
        format!("◀ {} ▶", provider_value)
    } else {
        provider_value.to_string()
    };

    let provider_block = Block::default()
        .borders(Borders::ALL)
        .border_style(if provider_focused {
            theme::highlight_style()
        } else {
            theme::border_style(false)
        })
        .title(Span::styled(
            "Provider *",
            if provider_focused { theme::highlight_style() } else { theme::dim_style() }
        ));

    let provider_text = Paragraph::new(Line::from(vec![
        Span::styled(
            provider_display,
            if provider_focused { theme::highlight_style() } else { theme::normal_style() }
        ),
    ]))
    .block(provider_block);
    f.render_widget(provider_text, chunks[1]);

    // Model field (selector)
    let model_focused = form.focused_field == 2;
    let model_value = form.model.selected_value().unwrap_or("(none)");
    let model_display = if form.model.len() > 1 {
        format!("◀ {} ▶", model_value)
    } else {
        model_value.to_string()
    };

    let model_block = Block::default()
        .borders(Borders::ALL)
        .border_style(if model_focused {
            theme::highlight_style()
        } else {
            theme::border_style(false)
        })
        .title(Span::styled(
            "Model *",
            if model_focused { theme::highlight_style() } else { theme::dim_style() }
        ));

    let model_text = Paragraph::new(Line::from(vec![
        Span::styled(
            model_display,
            if model_focused { theme::highlight_style() } else { theme::normal_style() }
        ),
    ]))
    .block(model_block);
    f.render_widget(model_text, chunks[2]);

    // Set as default toggle
    let toggle_widget = ToggleFieldWidget::new("Set as default model", form.set_as_default.value)
        .focused(form.focused_field == 3);
    f.render_widget(toggle_widget, chunks[3]);

    // Help line
    let help = Line::from(vec![
        Span::styled("Tab", theme::highlight_style()),
        Span::raw(":next  "),
        Span::styled("Shift+Tab", theme::highlight_style()),
        Span::raw(":prev  "),
        Span::styled("Ctrl+S", theme::highlight_style()),
        Span::raw(":save  "),
        Span::styled("Esc", theme::highlight_style()),
        Span::raw(":cancel"),
    ]);
    f.render_widget(Paragraph::new(help).alignment(Alignment::Center), chunks[5]);
}

/// Draw stack create/edit form
fn draw_stack_form(f: &mut Frame, app: &App, area: Rect) {
    let form = match &app.stack_form {
        Some(f) => f,
        None => return,
    };

    let title = match form.mode {
        FormMode::Create => " New Stack ",
        FormMode::Edit => " Edit Stack ",
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(true))
        .title(title);

    let inner = block.inner(area);
    f.render_widget(block, area);

    // Layout: left column for simple fields, right column for context TextArea
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .margin(1)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(inner);

    // Left column: simple fields
    let left_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2), // Name
            Constraint::Length(2), // Extends
            Constraint::Length(2), // Model
            Constraint::Length(2), // Temperature
            Constraint::Length(2), // Timeout
            Constraint::Length(2), // Max tokens
            Constraint::Length(2), // Skill
            Constraint::Length(2), // Context file
            Constraint::Length(2), // Unrestricted
            Constraint::Min(0),    // Spacer
        ])
        .split(main_chunks[0]);

    // Name field
    let name_widget = FormFieldWidget::new("Name *", &form.name.value)
        .focused(form.focused_field == 0)
        .cursor(form.name.cursor)
        .placeholder(Some(&form.name.placeholder));
    f.render_widget(name_widget, left_chunks[0]);

    // Extends field
    let extends_widget = FormFieldWidget::new("Extends", &form.extends.value)
        .focused(form.focused_field == 1)
        .cursor(form.extends.cursor)
        .placeholder(Some(&form.extends.placeholder));
    f.render_widget(extends_widget, left_chunks[1]);

    // Model field
    let model_widget = FormFieldWidget::new("Model", &form.model.value)
        .focused(form.focused_field == 2)
        .cursor(form.model.cursor)
        .placeholder(Some(&form.model.placeholder));
    f.render_widget(model_widget, left_chunks[2]);

    // Temperature field
    let temp_widget = FormFieldWidget::new("Temperature", &form.temperature.value)
        .focused(form.focused_field == 3)
        .cursor(form.temperature.cursor)
        .placeholder(Some(&form.temperature.placeholder));
    f.render_widget(temp_widget, left_chunks[3]);

    // Timeout field
    let timeout_widget = FormFieldWidget::new("Timeout (ms)", &form.timeout.value)
        .focused(form.focused_field == 4)
        .cursor(form.timeout.cursor)
        .placeholder(Some(&form.timeout.placeholder));
    f.render_widget(timeout_widget, left_chunks[4]);

    // Max tokens field
    let max_tokens_widget = FormFieldWidget::new("Max Tokens", &form.max_tokens.value)
        .focused(form.focused_field == 5)
        .cursor(form.max_tokens.cursor)
        .placeholder(Some(&form.max_tokens.placeholder));
    f.render_widget(max_tokens_widget, left_chunks[5]);

    // Skill field
    let skill_widget = FormFieldWidget::new("Skill", &form.skill.value)
        .focused(form.focused_field == 6)
        .cursor(form.skill.cursor)
        .placeholder(Some(&form.skill.placeholder));
    f.render_widget(skill_widget, left_chunks[6]);

    // Context file field
    let context_file_widget = FormFieldWidget::new("Context File", &form.context_file.value)
        .focused(form.focused_field == 8)
        .cursor(form.context_file.cursor)
        .placeholder(Some(&form.context_file.placeholder));
    f.render_widget(context_file_widget, left_chunks[7]);

    // Unrestricted toggle
    let unrestricted_widget = ToggleFieldWidget::new("Unrestricted mode", form.unrestricted.value)
        .focused(form.focused_field == 9);
    f.render_widget(unrestricted_widget, left_chunks[8]);

    // Right column: Context TextArea
    let right_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1), // Label
            Constraint::Min(5),    // TextArea
            Constraint::Length(2), // Help
        ])
        .split(main_chunks[1]);

    // Context label
    let context_label_style = if form.focused_field == 7 {
        theme::highlight_style()
    } else {
        theme::normal_style()
    };
    f.render_widget(
        Paragraph::new(Span::styled("Context (multi-line)", context_label_style)),
        right_chunks[0],
    );

    // Context TextArea - render with border
    let textarea_block = Block::default()
        .borders(Borders::ALL)
        .border_style(if form.focused_field == 7 {
            Style::default().fg(theme::ACCENT)
        } else {
            Style::default().fg(theme::BORDER)
        });

    let textarea_inner = textarea_block.inner(right_chunks[1]);
    f.render_widget(textarea_block, right_chunks[1]);

    // Render the TextArea widget directly
    f.render_widget(&form.context, textarea_inner);

    // Help line
    let help = Line::from(vec![
        Span::styled("Tab", theme::highlight_style()),
        Span::raw(":next  "),
        Span::styled("Ctrl+S", theme::highlight_style()),
        Span::raw(":save  "),
        Span::styled("Esc", theme::highlight_style()),
        Span::raw(":cancel"),
    ]);
    f.render_widget(Paragraph::new(help).alignment(Alignment::Center), right_chunks[2]);
}

/// Draw add custom tool form
fn draw_tool_form(f: &mut Frame, app: &App, area: Rect) {
    let form = match &app.tool_form {
        Some(f) => f,
        None => return,
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme::border_style(true))
        .title(" Add Custom Tool ");

    let inner = block.inner(area);
    f.render_widget(block, area);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(3), // Path
            Constraint::Min(0),    // Spacer
            Constraint::Length(1), // Help line
        ])
        .split(inner);

    // Path field
    let path_widget = FormFieldWidget::new("Tool Path", &form.path.value)
        .focused(true)
        .cursor(form.path.cursor)
        .required(true)
        .placeholder(Some(&form.path.placeholder));
    f.render_widget(path_widget, chunks[0]);

    // Help line
    let help = Line::from(vec![
        Span::styled("Ctrl+S", theme::highlight_style()),
        Span::raw(":save  "),
        Span::styled("Esc", theme::highlight_style()),
        Span::raw(":cancel"),
    ]);
    f.render_widget(Paragraph::new(help).alignment(Alignment::Center), chunks[2]);
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
        View::List => "Tab:section  j/k:nav  n:new  e:edit  d:del  q:quit",
        View::Detail => "h/Esc:back  e:edit  q:quit",
        _ => "Esc:cancel  Ctrl+S:save",
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

/// Draw the init wizard
fn draw_wizard(f: &mut Frame, app: &App) {
    let wizard = match &app.init_wizard {
        Some(w) => w,
        None => return,
    };

    let area = f.area();

    // Main layout
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Title
            Constraint::Min(0),    // Content
            Constraint::Length(2), // Footer/help
        ])
        .split(area);

    // Title
    let step_name = match wizard.step {
        InitStep::Welcome => "Welcome",
        InitStep::SelectProvider => "Select Provider",
        InitStep::AuthenticateOAuth => "Login",
        InitStep::AuthenticateApiKey => "API Key",
        InitStep::CreateModel => "Create Model",
        InitStep::Confirm => "Confirm",
    };

    let title_block = Block::default()
        .borders(Borders::BOTTOM)
        .border_style(Style::default().fg(theme::BORDER));

    let title = Paragraph::new(Line::from(vec![
        Span::styled(" cliffy ", theme::title_style()),
        Span::styled("setup", theme::dim_style()),
        Span::raw("  "),
        Span::styled(format!("Step: {}", step_name), theme::normal_style()),
    ]))
    .block(title_block);
    f.render_widget(title, chunks[0]);

    // Content based on step
    let content_area = chunks[1];
    match wizard.step {
        InitStep::Welcome => draw_wizard_welcome(f, content_area),
        InitStep::SelectProvider => draw_wizard_provider(f, wizard, content_area),
        InitStep::AuthenticateOAuth => draw_wizard_oauth(f, wizard, content_area),
        InitStep::AuthenticateApiKey => draw_wizard_api_key(f, wizard, content_area),
        InitStep::CreateModel => draw_wizard_model(f, wizard, content_area),
        InitStep::Confirm => draw_wizard_confirm(f, wizard, content_area),
    }

    // Footer with help
    let help = match wizard.step {
        InitStep::Welcome => "Press Enter to continue  |  Esc to cancel",
        InitStep::SelectProvider => "j/k:navigate  Enter:select  |  Esc to cancel",
        InitStep::AuthenticateOAuth => "Enter:login  S:skip  Backspace:back  |  Esc to cancel",
        InitStep::AuthenticateApiKey => "Enter:continue  Backspace:back  |  Esc to cancel",
        InitStep::CreateModel => "Tab:switch field  j/k:select model  Enter:continue  |  Esc to cancel",
        InitStep::Confirm => "Enter/Y:confirm  N:back  |  Esc to cancel",
    };

    let footer = Paragraph::new(help)
        .style(theme::dim_style())
        .alignment(Alignment::Center);
    f.render_widget(footer, chunks[2]);
}

fn draw_wizard_welcome(f: &mut Frame, area: Rect) {
    let center = centered_rect(80, 60, area);

    let lines = vec![
        Line::from(""),
        Line::from(Span::styled("Welcome to Cliffy!", Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from("This wizard will help you set up your first provider and model."),
        Line::from(""),
        Line::from("Cliffy supports multiple AI providers:"),
        Line::from(vec![
            Span::raw("  • "),
            Span::styled("Claude Pro/Max", theme::highlight_style()),
            Span::raw(" - Use your Claude subscription (OAuth)"),
        ]),
        Line::from(vec![
            Span::raw("  • "),
            Span::styled("Anthropic API", theme::highlight_style()),
            Span::raw(" - Direct API access with API key"),
        ]),
        Line::from(vec![
            Span::raw("  • "),
            Span::styled("OpenRouter", theme::highlight_style()),
            Span::raw(" - Access multiple models with one key"),
        ]),
        Line::from(""),
        Line::from("Press Enter to get started."),
    ];

    let paragraph = Paragraph::new(lines)
        .alignment(Alignment::Center)
        .block(Block::default().borders(Borders::ALL).border_style(theme::border_style(true)));

    f.render_widget(paragraph, center);
}

fn draw_wizard_provider(f: &mut Frame, wizard: &crate::app::InitWizard, area: Rect) {
    let center = centered_rect(70, 50, area);

    let providers = ProviderOption::all();

    let mut lines = vec![
        Line::from(""),
        Line::from("Select a provider:"),
        Line::from(""),
    ];

    for (i, provider) in providers.iter().enumerate() {
        let is_selected = i == wizard.provider_index;
        let marker = if is_selected { "▶ " } else { "  " };
        let style = if is_selected {
            theme::selected_style()
        } else {
            theme::normal_style()
        };

        let auth_hint = if provider.auth_type == "oauth" {
            " (OAuth)"
        } else {
            " (API Key)"
        };

        lines.push(Line::from(vec![
            Span::styled(marker, style),
            Span::styled(provider.name, style),
            Span::styled(auth_hint, theme::dim_style()),
        ]));
    }

    lines.push(Line::from(""));

    // Provider description
    let selected = &providers[wizard.provider_index];
    let description = match selected.key {
        "claude-pro-max" => "Use your existing Claude Pro or Max subscription.\nNo API costs - uses your subscription quota.",
        "anthropic" => "Direct access to Anthropic's API.\nRequires an Anthropic API key (usage billed separately).",
        "openrouter" => "Access Claude and other models through OpenRouter.\nRequires an OpenRouter API key.",
        _ => "",
    };

    lines.push(Line::from(""));
    for line in description.lines() {
        lines.push(Line::from(Span::styled(line, theme::dim_style())));
    }

    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).border_style(theme::border_style(true)).title(" Select Provider "));

    f.render_widget(paragraph, center);
}

fn draw_wizard_oauth(f: &mut Frame, wizard: &crate::app::InitWizard, area: Rect) {
    let center = centered_rect(70, 50, area);

    let mut lines = vec![
        Line::from(""),
        Line::from(Span::styled("Claude Pro/Max Authentication", theme::highlight_style())),
        Line::from(""),
    ];

    match &wizard.oauth_status {
        OAuthStatus::NotStarted => {
            lines.push(Line::from("Press Enter to open your browser and log in to Claude."));
            lines.push(Line::from(""));
            lines.push(Line::from("You'll be asked to authorize Cliffy to use your account."));
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled("Press S to skip and set up later.", theme::dim_style())));
        }
        OAuthStatus::InProgress => {
            lines.push(Line::from(Span::styled("Waiting for login...", Style::default().fg(Color::Yellow))));
            lines.push(Line::from(""));
            lines.push(Line::from("Complete the login in your browser, then return here."));
        }
        OAuthStatus::Success => {
            lines.push(Line::from(Span::styled("✓ Login successful!", Style::default().fg(Color::Green))));
            lines.push(Line::from(""));
            lines.push(Line::from("Press Enter to continue."));
        }
        OAuthStatus::Failed(err) => {
            lines.push(Line::from(Span::styled(format!("✗ Login failed: {}", err), Style::default().fg(Color::Red))));
            lines.push(Line::from(""));
            lines.push(Line::from("Press Enter to try again, or Backspace to go back."));
        }
    }

    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).border_style(theme::border_style(true)).title(" Login "));

    f.render_widget(paragraph, center);
}

fn draw_wizard_api_key(f: &mut Frame, wizard: &crate::app::InitWizard, area: Rect) {
    let center = centered_rect(70, 50, area);
    let provider = wizard.selected_provider();

    let key_name = match provider.key {
        "anthropic" => "ANTHROPIC_API_KEY",
        "openrouter" => "OPENROUTER_API_KEY",
        _ => "API_KEY",
    };

    let mut lines = vec![
        Line::from(""),
        Line::from(Span::styled(format!("{} API Key", provider.name), theme::highlight_style())),
        Line::from(""),
        Line::from(format!("Enter your {} below:", key_name)),
        Line::from(""),
    ];

    // Input field display
    let input_display = if wizard.api_key.value.is_empty() {
        Span::styled("(enter key here)", theme::dim_style())
    } else {
        // Mask the key for security
        let masked = "*".repeat(wizard.api_key.value.len().min(40));
        Span::styled(masked, theme::normal_style())
    };

    lines.push(Line::from(vec![
        Span::raw("  > "),
        input_display,
    ]));

    lines.push(Line::from(""));

    // Error message if any
    if let Some(ref err) = wizard.error_message {
        lines.push(Line::from(Span::styled(err.as_str(), Style::default().fg(Color::Red))));
        lines.push(Line::from(""));
    }

    // Hint
    let hint = match provider.key {
        "anthropic" => "Get your key at: https://console.anthropic.com/settings/keys",
        "openrouter" => "Get your key at: https://openrouter.ai/keys",
        _ => "",
    };
    lines.push(Line::from(Span::styled(hint, theme::dim_style())));

    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).border_style(theme::border_style(true)).title(" API Key "));

    f.render_widget(paragraph, center);
}

fn draw_wizard_model(f: &mut Frame, wizard: &crate::app::InitWizard, area: Rect) {
    let center = centered_rect(70, 60, area);
    let provider = wizard.selected_provider();
    let alias_focused = wizard.model_focused_field == 0;
    let model_focused = wizard.model_focused_field == 1;

    let mut lines = vec![
        Line::from(""),
        Line::from(Span::styled("Create Default Model", theme::highlight_style())),
        Line::from(""),
        Line::from(format!("Provider: {}", provider.name)),
        Line::from(""),
    ];

    // Model alias label with focus indicator
    let alias_label_style = if alias_focused {
        theme::highlight_style()
    } else {
        theme::normal_style()
    };
    lines.push(Line::from(Span::styled(
        if alias_focused { "▶ Model alias:" } else { "  Model alias:" },
        alias_label_style
    )));

    // Model alias field
    let alias_display = if wizard.model_alias.value.is_empty() {
        Span::styled("(type alias here)", theme::dim_style())
    } else {
        let style = if alias_focused { theme::highlight_style() } else { theme::normal_style() };
        Span::styled(wizard.model_alias.value.as_str(), style)
    };

    lines.push(Line::from(vec![
        Span::raw("    "),
        alias_display,
        if alias_focused { Span::styled("_", theme::highlight_style()) } else { Span::raw("") },
    ]));

    lines.push(Line::from(""));

    // Model selector label with focus indicator
    let model_label_style = if model_focused {
        theme::highlight_style()
    } else {
        theme::normal_style()
    };
    lines.push(Line::from(Span::styled(
        if model_focused { "▶ Select model:" } else { "  Select model:" },
        model_label_style
    )));
    lines.push(Line::from(""));

    // Model selector
    for (_, model_id) in provider.default_models.iter() {
        let is_selected = wizard.model_selector.selected_value() == Some(*model_id);
        let marker = if is_selected && model_focused { "  ▶ " } else if is_selected { "  • " } else { "    " };
        let style = if is_selected && model_focused {
            theme::selected_style()
        } else if is_selected {
            theme::normal_style()
        } else {
            theme::dim_style()
        };

        lines.push(Line::from(vec![
            Span::styled(marker, style),
            Span::styled(*model_id, style),
        ]));
    }

    // Error message if any
    if let Some(ref err) = wizard.error_message {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(err.as_str(), Style::default().fg(Color::Red))));
    }

    // Help hint
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("Tab: switch field", theme::dim_style())));

    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).border_style(theme::border_style(true)).title(" Create Model "));

    f.render_widget(paragraph, center);
}

fn draw_wizard_confirm(f: &mut Frame, wizard: &crate::app::InitWizard, area: Rect) {
    let center = centered_rect(70, 60, area);
    let provider = wizard.selected_provider();
    let model_id = wizard.selected_model().unwrap_or(provider.default_models[0].1);

    let lines = vec![
        Line::from(""),
        Line::from(Span::styled("Confirm Setup", theme::highlight_style())),
        Line::from(""),
        Line::from("The following will be saved to your config:"),
        Line::from(""),
        Line::from(vec![
            Span::styled("  Provider: ", theme::dim_style()),
            Span::styled(provider.name, theme::normal_style()),
        ]),
        Line::from(vec![
            Span::styled("  Auth: ", theme::dim_style()),
            Span::styled(
                if provider.auth_type == "oauth" { "OAuth (logged in)" } else { "API Key" },
                theme::normal_style()
            ),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("  Model alias: ", theme::dim_style()),
            Span::styled(wizard.model_alias.value.as_str(), theme::normal_style()),
        ]),
        Line::from(vec![
            Span::styled("  Model ID: ", theme::dim_style()),
            Span::styled(model_id, theme::normal_style()),
        ]),
        Line::from(""),
        Line::from(Span::styled("Config will be saved to ~/.config/cliffy/cliffy.json", theme::dim_style())),
        Line::from(""),
        Line::from("Press Enter or Y to confirm."),
    ];

    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).border_style(theme::border_style(true)).title(" Confirm "));

    f.render_widget(paragraph, center);
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
