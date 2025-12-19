use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::path::PathBuf;
use tui_textarea::TextArea;

use crate::data::{
    discover_hooks, discover_skills, discover_stacks, load_merged_config, save_config,
    CliffyConfig, HookInfo, ModelConfig, SkillInfo, StackConfig,
};
use crate::widgets::{ConfirmDialog, FilteredList, TextInput, Toggle};

/// Form mode for create vs edit
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormMode {
    Create,
    Edit,
}

/// Model edit/create form
#[derive(Debug, Clone)]
pub struct ModelForm {
    pub mode: FormMode,
    pub original_alias: Option<String>,
    pub focused_field: usize,
    pub alias: TextInput,
    pub provider: TextInput,
    pub model: TextInput,
    pub set_as_default: Toggle,
}

impl ModelForm {
    pub fn new_create() -> Self {
        Self {
            mode: FormMode::Create,
            original_alias: None,
            focused_field: 0,
            alias: TextInput::new().with_placeholder("e.g., fast, smart, claude"),
            provider: TextInput::new().with_placeholder("e.g., anthropic, openai"),
            model: TextInput::new().with_placeholder("e.g., claude-sonnet-4-20250514"),
            set_as_default: Toggle::new("Set as default model"),
        }
    }

    pub fn new_edit(alias: &str, config: &ModelConfig, is_default: bool) -> Self {
        Self {
            mode: FormMode::Edit,
            original_alias: Some(alias.to_string()),
            focused_field: 0,
            alias: TextInput::new().with_value(alias),
            provider: TextInput::new().with_value(&config.provider),
            model: TextInput::new().with_value(&config.model),
            set_as_default: Toggle::new("Set as default model").with_value(is_default),
        }
    }

    pub fn field_count() -> usize {
        4  // alias, provider, model, set_as_default
    }

    pub fn next_field(&mut self) {
        self.focused_field = (self.focused_field + 1) % Self::field_count();
    }

    pub fn prev_field(&mut self) {
        self.focused_field = self.focused_field.checked_sub(1).unwrap_or(Self::field_count() - 1);
    }

    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if self.alias.value.trim().is_empty() {
            errors.push("Alias is required".to_string());
        }
        if self.provider.value.trim().is_empty() {
            errors.push("Provider is required".to_string());
        }
        if self.model.value.trim().is_empty() {
            errors.push("Model is required".to_string());
        }
        errors
    }
}

/// Stack edit/create form
pub struct StackForm {
    pub mode: FormMode,
    pub original_name: Option<String>,
    pub focused_field: usize,
    pub name: TextInput,
    pub extends: TextInput,
    pub model: TextInput,
    pub temperature: TextInput,
    pub timeout: TextInput,
    pub max_tokens: TextInput,
    pub skill: TextInput,
    pub context: TextArea<'static>,
    pub context_file: TextInput,
    pub unrestricted: Toggle,
}

impl StackForm {
    pub fn new_create() -> Self {
        let mut context = TextArea::default();
        context.set_placeholder_text("Multi-line context (optional)");

        Self {
            mode: FormMode::Create,
            original_name: None,
            focused_field: 0,
            name: TextInput::new().with_placeholder("e.g., codex-architect"),
            extends: TextInput::new().with_placeholder("Base stack to extend (optional)"),
            model: TextInput::new().with_placeholder("Model alias (optional)"),
            temperature: TextInput::new().with_placeholder("0.0 - 2.0 (optional)"),
            timeout: TextInput::new().with_placeholder("Timeout in ms (optional)"),
            max_tokens: TextInput::new().with_placeholder("Max tokens (optional)"),
            skill: TextInput::new().with_placeholder("Skill name (optional)"),
            context,
            context_file: TextInput::new().with_placeholder("Path to context file (optional)"),
            unrestricted: Toggle::new("Unrestricted mode"),
        }
    }

    pub fn new_edit(name: &str, config: &StackConfig) -> Self {
        let mut context = TextArea::default();
        if let Some(ref ctx) = config.context {
            context = TextArea::new(ctx.lines().map(String::from).collect());
        }

        Self {
            mode: FormMode::Edit,
            original_name: Some(name.to_string()),
            focused_field: 0,
            name: TextInput::new().with_value(name),
            extends: TextInput::new().with_value(config.extends.as_deref().unwrap_or("")),
            model: TextInput::new().with_value(config.model.as_deref().unwrap_or("")),
            temperature: TextInput::new().with_value(
                &config.temperature.map(|t| t.to_string()).unwrap_or_default()
            ),
            timeout: TextInput::new().with_value(
                &config.timeout.map(|t| t.to_string()).unwrap_or_default()
            ),
            max_tokens: TextInput::new().with_value(
                &config.max_tokens.map(|t| t.to_string()).unwrap_or_default()
            ),
            skill: TextInput::new().with_value(config.skill.as_deref().unwrap_or("")),
            context,
            context_file: TextInput::new().with_value(config.context_file.as_deref().unwrap_or("")),
            unrestricted: Toggle::new("Unrestricted mode").with_value(config.unrestricted.unwrap_or(false)),
        }
    }

    pub fn field_count() -> usize {
        10  // name, extends, model, temperature, timeout, max_tokens, skill, context, context_file, unrestricted
    }

    pub fn next_field(&mut self) {
        self.focused_field = (self.focused_field + 1) % Self::field_count();
    }

    pub fn prev_field(&mut self) {
        self.focused_field = self.focused_field.checked_sub(1).unwrap_or(Self::field_count() - 1);
    }

    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if self.name.value.trim().is_empty() {
            errors.push("Name is required".to_string());
        }
        // Validate temperature if provided
        if !self.temperature.value.trim().is_empty() {
            if let Err(_) = self.temperature.value.trim().parse::<f64>() {
                errors.push("Temperature must be a number".to_string());
            }
        }
        // Validate timeout if provided
        if !self.timeout.value.trim().is_empty() {
            if let Err(_) = self.timeout.value.trim().parse::<u64>() {
                errors.push("Timeout must be a positive number".to_string());
            }
        }
        // Validate max_tokens if provided
        if !self.max_tokens.value.trim().is_empty() {
            if let Err(_) = self.max_tokens.value.trim().parse::<u32>() {
                errors.push("Max tokens must be a positive number".to_string());
            }
        }
        errors
    }
}

/// Tool add form (for custom tools)
#[derive(Debug, Clone)]
pub struct ToolForm {
    pub path: TextInput,
}

impl ToolForm {
    pub fn new() -> Self {
        Self {
            path: TextInput::new().with_placeholder("Path to custom tool executable"),
        }
    }

    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if self.path.value.trim().is_empty() {
            errors.push("Path is required".to_string());
        }
        errors
    }
}

/// Main tabs
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Models,
    Stacks,
    Skills,
    Tools,
    Hooks,
    Settings,
}

impl Tab {
    pub fn all() -> &'static [Tab] {
        &[
            Tab::Models,
            Tab::Stacks,
            Tab::Skills,
            Tab::Tools,
            Tab::Hooks,
            Tab::Settings,
        ]
    }

    pub fn name(&self) -> &'static str {
        match self {
            Tab::Models => "Models",
            Tab::Stacks => "Stacks",
            Tab::Skills => "Skills",
            Tab::Tools => "Tools",
            Tab::Hooks => "Hooks",
            Tab::Settings => "Settings",
        }
    }

    pub fn next(self) -> Self {
        match self {
            Tab::Models => Tab::Stacks,
            Tab::Stacks => Tab::Skills,
            Tab::Skills => Tab::Tools,
            Tab::Tools => Tab::Hooks,
            Tab::Hooks => Tab::Settings,
            Tab::Settings => Tab::Models,
        }
    }

    pub fn prev(self) -> Self {
        match self {
            Tab::Models => Tab::Settings,
            Tab::Stacks => Tab::Models,
            Tab::Skills => Tab::Stacks,
            Tab::Tools => Tab::Skills,
            Tab::Hooks => Tab::Tools,
            Tab::Settings => Tab::Hooks,
        }
    }

    pub fn from_number(n: u8) -> Option<Self> {
        match n {
            1 => Some(Tab::Models),
            2 => Some(Tab::Stacks),
            3 => Some(Tab::Skills),
            4 => Some(Tab::Tools),
            5 => Some(Tab::Hooks),
            6 => Some(Tab::Settings),
            _ => None,
        }
    }
}

/// View mode within a tab
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    List,
    Detail,
    Edit,
    Create,
    Confirm,
}

/// Input mode
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputMode {
    Normal,
    Search,
    Editing,
}

/// Model list item
#[derive(Debug, Clone)]
pub struct ModelItem {
    pub alias: String,
    pub config: ModelConfig,
}

/// Stack list item
#[derive(Debug, Clone)]
pub struct StackItem {
    pub name: String,
    pub config: StackConfig,
    pub source: String,
}

/// Tool list item
#[derive(Debug, Clone)]
pub struct ToolItem {
    pub name: String,
    pub enabled: bool,
    pub is_builtin: bool,
}

/// Application state
pub struct App {
    pub tab: Tab,
    pub view: View,
    pub input_mode: InputMode,
    pub should_quit: bool,
    pub status_message: Option<String>,

    // Config
    pub config: CliffyConfig,
    pub config_path: PathBuf,
    pub dirty: bool,

    // Models tab state
    pub models: FilteredList<ModelItem>,
    pub model_search: TextInput,

    // Stacks tab state
    pub stacks: FilteredList<StackItem>,
    pub stack_search: TextInput,

    // Skills tab state
    pub skills: FilteredList<SkillInfo>,
    pub skill_search: TextInput,

    // Tools tab state
    pub tools: FilteredList<ToolItem>,
    pub tool_search: TextInput,
    pub tool_form: Option<ToolForm>,

    // Hooks tab state
    pub hooks: FilteredList<HookInfo>,
    pub hook_search: TextInput,

    // Dialogs
    pub confirm_dialog: Option<ConfirmDialog>,
    pub pending_action: Option<PendingAction>,

    // Forms
    pub model_form: Option<ModelForm>,
    pub stack_form: Option<StackForm>,
}

/// Pending action that needs confirmation
#[derive(Debug, Clone)]
pub enum PendingAction {
    DeleteModel(String),
    DeleteStack(String),
    DeleteTool(String),
    Quit,
}

impl App {
    pub fn new() -> anyhow::Result<Self> {
        let (config, config_path) = load_merged_config()?;

        let mut app = Self {
            tab: Tab::Models,
            view: View::List,
            input_mode: InputMode::Normal,
            should_quit: false,
            status_message: None,
            config,
            config_path,
            dirty: false,
            models: FilteredList::new(vec![]),
            model_search: TextInput::new().with_placeholder("Search models..."),
            stacks: FilteredList::new(vec![]),
            stack_search: TextInput::new().with_placeholder("Search stacks..."),
            skills: FilteredList::new(vec![]),
            skill_search: TextInput::new().with_placeholder("Search skills..."),
            tools: FilteredList::new(vec![]),
            tool_search: TextInput::new().with_placeholder("Search tools..."),
            tool_form: None,
            hooks: FilteredList::new(vec![]),
            hook_search: TextInput::new().with_placeholder("Search hooks..."),
            confirm_dialog: None,
            pending_action: None,
            model_form: None,
            stack_form: None,
        };

        app.refresh_all();
        Ok(app)
    }

    /// Refresh all data from config and filesystem
    pub fn refresh_all(&mut self) {
        self.refresh_models();
        self.refresh_stacks();
        self.refresh_skills();
        self.refresh_tools();
        self.refresh_hooks();
    }

    fn refresh_models(&mut self) {
        let items: Vec<ModelItem> = self
            .config
            .models
            .iter()
            .map(|(alias, config)| ModelItem {
                alias: alias.clone(),
                config: config.clone(),
            })
            .collect();
        self.models = FilteredList::new(items);
    }

    fn refresh_stacks(&mut self) {
        let stack_data = discover_stacks(&self.config);
        let items: Vec<StackItem> = stack_data
            .into_iter()
            .map(|(name, config, source)| StackItem {
                name,
                config,
                source,
            })
            .collect();
        self.stacks = FilteredList::new(items);
    }

    fn refresh_skills(&mut self) {
        let items = discover_skills();
        self.skills = FilteredList::new(items);
    }

    fn refresh_tools(&mut self) {
        let builtins = ["bash", "read", "write", "edit"];
        let mut items: Vec<ToolItem> = builtins
            .iter()
            .map(|&name| ToolItem {
                name: name.to_string(),
                enabled: self.config.tools.enabled.contains(&name.to_string()),
                is_builtin: true,
            })
            .collect();

        // Add custom tools
        for path in &self.config.tools.custom {
            items.push(ToolItem {
                name: path.clone(),
                enabled: true,
                is_builtin: false,
            });
        }

        self.tools = FilteredList::new(items);
    }

    fn refresh_hooks(&mut self) {
        let items = discover_hooks();
        self.hooks = FilteredList::new(items);
    }

    /// Handle key events
    pub fn handle_key(&mut self, key: KeyEvent) {
        // Handle confirm dialog first
        if self.confirm_dialog.is_some() {
            self.handle_confirm_key(key);
            return;
        }

        // Handle form mode
        if self.model_form.is_some() {
            self.handle_model_form_key(key);
            return;
        }
        if self.stack_form.is_some() {
            self.handle_stack_form_key(key);
            return;
        }
        if self.tool_form.is_some() {
            self.handle_tool_form_key(key);
            return;
        }

        // Handle search mode
        if self.input_mode == InputMode::Search {
            self.handle_search_key(key);
            return;
        }

        // Global keys
        match key.code {
            KeyCode::Char('q') => {
                if self.dirty {
                    self.confirm_dialog = Some(ConfirmDialog::new(
                        "Unsaved Changes",
                        "You have unsaved changes. Quit anyway?",
                    ));
                    self.pending_action = Some(PendingAction::Quit);
                } else {
                    self.should_quit = true;
                }
                return;
            }
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.should_quit = true;
                return;
            }
            KeyCode::Char('s') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.save_config();
                return;
            }
            _ => {}
        }

        // Tab navigation
        match key.code {
            KeyCode::Tab => {
                self.tab = self.tab.next();
                self.view = View::List;
                return;
            }
            KeyCode::BackTab => {
                self.tab = self.tab.prev();
                self.view = View::List;
                return;
            }
            KeyCode::Char(c) if c.is_ascii_digit() => {
                if let Some(tab) = Tab::from_number(c as u8 - b'0') {
                    self.tab = tab;
                    self.view = View::List;
                }
                return;
            }
            _ => {}
        }

        // View-specific handling
        match self.view {
            View::List => self.handle_list_key(key),
            View::Detail => self.handle_detail_key(key),
            _ => {}
        }
    }

    fn handle_list_key(&mut self, key: KeyEvent) {
        match key.code {
            // Navigation
            KeyCode::Down | KeyCode::Char('j') => self.move_down(),
            KeyCode::Up | KeyCode::Char('k') => self.move_up(),
            KeyCode::Enter | KeyCode::Char('l') | KeyCode::Right => {
                self.view = View::Detail;
            }
            // Search
            KeyCode::Char('/') => {
                self.input_mode = InputMode::Search;
            }
            // Refresh
            KeyCode::Char('r') => {
                self.refresh_all();
                self.status_message = Some("Refreshed".to_string());
            }
            // Toggle (for tools)
            KeyCode::Char(' ') if self.tab == Tab::Tools => {
                self.toggle_selected_tool();
            }
            // Create new
            KeyCode::Char('n') => {
                self.start_create();
            }
            // Edit selected (shortcut from list)
            KeyCode::Char('e') => {
                self.start_edit();
            }
            // Delete
            KeyCode::Char('d') => {
                self.confirm_delete();
            }
            _ => {}
        }
    }

    fn handle_detail_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc | KeyCode::Char('h') | KeyCode::Left => {
                self.view = View::List;
            }
            KeyCode::Char('e') => {
                self.start_edit();
            }
            _ => {}
        }
    }

    fn handle_search_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc => {
                self.input_mode = InputMode::Normal;
                self.clear_search();
            }
            KeyCode::Enter => {
                self.input_mode = InputMode::Normal;
            }
            _ => {
                let search_input = match self.tab {
                    Tab::Models => &mut self.model_search,
                    Tab::Stacks => &mut self.stack_search,
                    Tab::Skills => &mut self.skill_search,
                    Tab::Tools => &mut self.tool_search,
                    Tab::Hooks => &mut self.hook_search,
                    _ => return,
                };
                if search_input.handle_key(key) {
                    self.apply_search();
                }
            }
        }
    }

    fn handle_confirm_key(&mut self, key: KeyEvent) {
        if let Some(ref mut dialog) = self.confirm_dialog {
            match key.code {
                KeyCode::Left | KeyCode::Char('h') => dialog.select_cancel(),
                KeyCode::Right | KeyCode::Char('l') => dialog.select_confirm(),
                KeyCode::Tab => dialog.toggle(),
                KeyCode::Enter => {
                    let confirmed = dialog.is_confirmed();
                    let action = self.pending_action.take();
                    self.confirm_dialog = None;

                    if confirmed {
                        if let Some(action) = action {
                            self.execute_action(action);
                        }
                    }
                }
                KeyCode::Esc => {
                    self.confirm_dialog = None;
                    self.pending_action = None;
                }
                _ => {}
            }
        }
    }

    fn move_down(&mut self) {
        match self.tab {
            Tab::Models => self.models.next(),
            Tab::Stacks => self.stacks.next(),
            Tab::Skills => self.skills.next(),
            Tab::Tools => self.tools.next(),
            Tab::Hooks => self.hooks.next(),
            Tab::Settings => {}
        }
    }

    fn move_up(&mut self) {
        match self.tab {
            Tab::Models => self.models.previous(),
            Tab::Stacks => self.stacks.previous(),
            Tab::Skills => self.skills.previous(),
            Tab::Tools => self.tools.previous(),
            Tab::Hooks => self.hooks.previous(),
            Tab::Settings => {}
        }
    }

    fn apply_search(&mut self) {
        match self.tab {
            Tab::Models => {
                let query = self.model_search.value.to_lowercase();
                self.models
                    .apply_filter(|item| item.alias.to_lowercase().contains(&query));
            }
            Tab::Stacks => {
                let query = self.stack_search.value.to_lowercase();
                self.stacks
                    .apply_filter(|item| item.name.to_lowercase().contains(&query));
            }
            Tab::Skills => {
                let query = self.skill_search.value.to_lowercase();
                self.skills.apply_filter(|item| {
                    item.name.to_lowercase().contains(&query)
                        || item.description.to_lowercase().contains(&query)
                });
            }
            Tab::Tools => {
                let query = self.tool_search.value.to_lowercase();
                self.tools
                    .apply_filter(|item| item.name.to_lowercase().contains(&query));
            }
            Tab::Hooks => {
                let query = self.hook_search.value.to_lowercase();
                self.hooks
                    .apply_filter(|item| item.name.to_lowercase().contains(&query));
            }
            _ => {}
        }
    }

    fn clear_search(&mut self) {
        match self.tab {
            Tab::Models => {
                self.model_search.clear();
                self.models.clear_filter();
            }
            Tab::Stacks => {
                self.stack_search.clear();
                self.stacks.clear_filter();
            }
            Tab::Skills => {
                self.skill_search.clear();
                self.skills.clear_filter();
            }
            Tab::Tools => {
                self.tool_search.clear();
                self.tools.clear_filter();
            }
            Tab::Hooks => {
                self.hook_search.clear();
                self.hooks.clear_filter();
            }
            _ => {}
        }
    }

    fn toggle_selected_tool(&mut self) {
        if let Some(idx) = self.tools.selected_index() {
            if let Some(tool) = self.tools.items.get_mut(idx) {
                if tool.is_builtin {
                    tool.enabled = !tool.enabled;

                    // Update config
                    if tool.enabled {
                        if !self.config.tools.enabled.contains(&tool.name) {
                            self.config.tools.enabled.push(tool.name.clone());
                        }
                    } else {
                        self.config.tools.enabled.retain(|t| t != &tool.name);
                    }
                    self.dirty = true;
                }
            }
        }
    }

    fn confirm_delete(&mut self) {
        match self.tab {
            Tab::Models => {
                if let Some(model) = self.models.selected() {
                    self.confirm_dialog = Some(ConfirmDialog::new(
                        "Delete Model",
                        &format!("Delete model '{}'?", model.alias),
                    ));
                    self.pending_action = Some(PendingAction::DeleteModel(model.alias.clone()));
                }
            }
            Tab::Stacks => {
                if let Some(stack) = self.stacks.selected() {
                    self.confirm_dialog = Some(ConfirmDialog::new(
                        "Delete Stack",
                        &format!("Delete stack '{}'?", stack.name),
                    ));
                    self.pending_action = Some(PendingAction::DeleteStack(stack.name.clone()));
                }
            }
            Tab::Tools => {
                if let Some(tool) = self.tools.selected() {
                    if !tool.is_builtin {
                        self.confirm_dialog = Some(ConfirmDialog::new(
                            "Remove Tool",
                            &format!("Remove custom tool '{}'?", tool.name),
                        ));
                        self.pending_action = Some(PendingAction::DeleteTool(tool.name.clone()));
                    }
                }
            }
            _ => {}
        }
    }

    fn execute_action(&mut self, action: PendingAction) {
        match action {
            PendingAction::DeleteModel(alias) => {
                self.config.models.remove(&alias);
                self.dirty = true;
                self.refresh_models();
                self.status_message = Some(format!("Deleted model '{}'", alias));
            }
            PendingAction::DeleteStack(name) => {
                self.config.stacks.remove(&name);
                self.dirty = true;
                self.refresh_stacks();
                self.status_message = Some(format!("Deleted stack '{}'", name));
            }
            PendingAction::DeleteTool(path) => {
                self.config.tools.custom.retain(|t| t != &path);
                self.dirty = true;
                self.refresh_tools();
                self.status_message = Some(format!("Removed tool '{}'", path));
            }
            PendingAction::Quit => {
                self.should_quit = true;
            }
        }
    }

    fn save_config(&mut self) {
        match save_config(&self.config, &self.config_path) {
            Ok(()) => {
                self.dirty = false;
                self.status_message = Some("Config saved".to_string());
            }
            Err(e) => {
                self.status_message = Some(format!("Save failed: {}", e));
            }
        }
    }

    // Form handling

    fn start_create(&mut self) {
        match self.tab {
            Tab::Models => {
                self.model_form = Some(ModelForm::new_create());
                self.view = View::Create;
                self.input_mode = InputMode::Editing;
            }
            Tab::Stacks => {
                self.stack_form = Some(StackForm::new_create());
                self.view = View::Create;
                self.input_mode = InputMode::Editing;
            }
            Tab::Tools => {
                self.tool_form = Some(ToolForm::new());
                self.view = View::Create;
                self.input_mode = InputMode::Editing;
            }
            // TODO: Add other tabs
            _ => {}
        }
    }

    fn start_edit(&mut self) {
        match self.tab {
            Tab::Models => {
                if let Some(model) = self.models.selected() {
                    let is_default = self.config.default_model == model.alias;
                    self.model_form = Some(ModelForm::new_edit(&model.alias, &model.config, is_default));
                    self.view = View::Edit;
                    self.input_mode = InputMode::Editing;
                }
            }
            Tab::Stacks => {
                if let Some(stack) = self.stacks.selected() {
                    self.stack_form = Some(StackForm::new_edit(&stack.name, &stack.config));
                    self.view = View::Edit;
                    self.input_mode = InputMode::Editing;
                }
            }
            // TODO: Add other tabs
            _ => {}
        }
    }

    fn handle_model_form_key(&mut self, key: KeyEvent) {
        // Ctrl+S to save
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
            self.save_model_form();
            return;
        }

        // Esc to cancel
        if key.code == KeyCode::Esc {
            self.cancel_form();
            return;
        }

        // Get the form mutably
        let form = match self.model_form.as_mut() {
            Some(f) => f,
            None => return,
        };

        match key.code {
            // Tab navigation between fields
            KeyCode::Tab => {
                form.next_field();
            }
            KeyCode::BackTab => {
                form.prev_field();
            }
            // Handle input based on focused field
            _ => {
                match form.focused_field {
                    0 => { form.alias.handle_key(key); }
                    1 => { form.provider.handle_key(key); }
                    2 => { form.model.handle_key(key); }
                    3 => { form.set_as_default.handle_key(key); }
                    _ => {}
                }
            }
        }
    }

    fn save_model_form(&mut self) {
        let form = match self.model_form.take() {
            Some(f) => f,
            None => return,
        };

        // Validate
        let errors = form.validate();
        if !errors.is_empty() {
            self.status_message = Some(errors.join(", "));
            self.model_form = Some(form);
            return;
        }

        let alias = form.alias.value.trim().to_string();
        let config = ModelConfig {
            provider: form.provider.value.trim().to_string(),
            model: form.model.value.trim().to_string(),
            extra: std::collections::HashMap::new(),
        };

        // If editing and alias changed, remove old entry
        if let Some(original) = &form.original_alias {
            if original != &alias {
                self.config.models.remove(original);
            }
        }

        // Insert/update model
        self.config.models.insert(alias.clone(), config);

        // Set as default if toggled
        if form.set_as_default.value {
            self.config.default_model = alias.clone();
        }

        self.dirty = true;
        self.refresh_models();
        self.view = View::List;
        self.input_mode = InputMode::Normal;

        let action = if form.mode == FormMode::Create { "Created" } else { "Updated" };
        self.status_message = Some(format!("{} model '{}'", action, alias));
    }

    fn handle_stack_form_key(&mut self, key: KeyEvent) {
        // Ctrl+S to save
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
            self.save_stack_form();
            return;
        }

        // Esc to cancel
        if key.code == KeyCode::Esc {
            self.cancel_form();
            return;
        }

        // Get the form mutably
        let form = match self.stack_form.as_mut() {
            Some(f) => f,
            None => return,
        };

        match key.code {
            // Tab navigation between fields
            KeyCode::Tab => {
                form.next_field();
            }
            KeyCode::BackTab => {
                form.prev_field();
            }
            // Handle input based on focused field
            _ => {
                match form.focused_field {
                    0 => { form.name.handle_key(key); }
                    1 => { form.extends.handle_key(key); }
                    2 => { form.model.handle_key(key); }
                    3 => { form.temperature.handle_key(key); }
                    4 => { form.timeout.handle_key(key); }
                    5 => { form.max_tokens.handle_key(key); }
                    6 => { form.skill.handle_key(key); }
                    7 => {
                        // TextArea handles its own input
                        form.context.input(key);
                    }
                    8 => { form.context_file.handle_key(key); }
                    9 => { form.unrestricted.handle_key(key); }
                    _ => {}
                }
            }
        }
    }

    fn save_stack_form(&mut self) {
        let form = match self.stack_form.take() {
            Some(f) => f,
            None => return,
        };

        // Validate
        let errors = form.validate();
        if !errors.is_empty() {
            self.status_message = Some(errors.join(", "));
            self.stack_form = Some(form);
            return;
        }

        let name = form.name.value.trim().to_string();

        // Build config from form
        let config = StackConfig {
            name: Some(name.clone()),
            extends: if form.extends.value.trim().is_empty() {
                None
            } else {
                Some(form.extends.value.trim().to_string())
            },
            model: if form.model.value.trim().is_empty() {
                None
            } else {
                Some(form.model.value.trim().to_string())
            },
            temperature: form.temperature.value.trim().parse().ok(),
            timeout: form.timeout.value.trim().parse().ok(),
            max_tokens: form.max_tokens.value.trim().parse().ok(),
            skill: if form.skill.value.trim().is_empty() {
                None
            } else {
                Some(form.skill.value.trim().to_string())
            },
            context: {
                let text: String = form.context.lines().join("\n");
                if text.trim().is_empty() { None } else { Some(text) }
            },
            context_file: if form.context_file.value.trim().is_empty() {
                None
            } else {
                Some(form.context_file.value.trim().to_string())
            },
            unrestricted: if form.unrestricted.value { Some(true) } else { None },
        };

        // If editing and name changed, remove old entry
        if let Some(original) = &form.original_name {
            if original != &name {
                self.config.stacks.remove(original);
            }
        }

        // Insert/update stack
        self.config.stacks.insert(name.clone(), config);

        self.dirty = true;
        self.refresh_stacks();
        self.view = View::List;
        self.input_mode = InputMode::Normal;

        let action = if form.mode == FormMode::Create { "Created" } else { "Updated" };
        self.status_message = Some(format!("{} stack '{}'", action, name));
    }

    fn handle_tool_form_key(&mut self, key: KeyEvent) {
        // Ctrl+S to save
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
            self.save_tool_form();
            return;
        }

        // Esc to cancel
        if key.code == KeyCode::Esc {
            self.cancel_form();
            return;
        }

        // Get the form mutably
        let form = match self.tool_form.as_mut() {
            Some(f) => f,
            None => return,
        };

        // Handle input for path field
        form.path.handle_key(key);
    }

    fn save_tool_form(&mut self) {
        let form = match self.tool_form.take() {
            Some(f) => f,
            None => return,
        };

        // Validate
        let errors = form.validate();
        if !errors.is_empty() {
            self.status_message = Some(errors.join(", "));
            self.tool_form = Some(form);
            return;
        }

        let path = form.path.value.trim().to_string();

        // Check if already exists
        if self.config.tools.custom.contains(&path) {
            self.status_message = Some("Tool already exists".to_string());
            self.tool_form = Some(form);
            return;
        }

        // Add to custom tools
        self.config.tools.custom.push(path.clone());

        self.dirty = true;
        self.refresh_tools();
        self.view = View::List;
        self.input_mode = InputMode::Normal;
        self.status_message = Some(format!("Added tool '{}'", path));
    }

    fn cancel_form(&mut self) {
        self.model_form = None;
        self.stack_form = None;
        self.tool_form = None;
        self.view = View::List;
        self.input_mode = InputMode::Normal;
        self.status_message = Some("Cancelled".to_string());
    }
}
