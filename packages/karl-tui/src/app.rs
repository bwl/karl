use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use tui_textarea::TextArea;

use crate::cli::{self, CliStatus};
use crate::data::{
    discover_hooks, discover_skills, discover_stacks, load_merged_config, save_config,
    KarlConfig, HookInfo, ModelConfig, SkillInfo, StackConfig,
};
use crate::widgets::{ConfirmDialog, FilteredList, Selector, TextInput, Toggle};

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
    pub provider: Selector,
    pub model: Selector,
    pub set_as_default: Toggle,
}

impl ModelForm {
    pub fn new_create(providers: Vec<String>) -> Self {
        let first_provider = providers.first().map(|s| s.as_str()).unwrap_or("");
        let models = ProviderOption::models_for_provider(first_provider);

        Self {
            mode: FormMode::Create,
            original_alias: None,
            focused_field: 0,
            alias: TextInput::new().with_placeholder("e.g., fast, smart, claude"),
            provider: Selector::new(providers),
            model: Selector::new(models),
            set_as_default: Toggle::new("Set as default model"),
        }
    }

    pub fn new_edit(alias: &str, config: &ModelConfig, is_default: bool, providers: Vec<String>) -> Self {
        let mut provider_selector = Selector::new(providers);
        provider_selector.select_by_value(&config.provider);

        let models = ProviderOption::models_for_provider(&config.provider);
        let mut model_selector = Selector::new(models);
        model_selector.select_by_value(&config.model);

        Self {
            mode: FormMode::Edit,
            original_alias: Some(alias.to_string()),
            focused_field: 0,
            alias: TextInput::new().with_value(alias),
            provider: provider_selector,
            model: model_selector,
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

    pub fn selected_provider(&self) -> Option<&str> {
        self.provider.selected_value()
    }

    /// Update model options when provider changes
    pub fn update_model_options(&mut self) {
        if let Some(provider_key) = self.provider.selected_value() {
            let models = ProviderOption::models_for_provider(provider_key);
            self.model = Selector::new(models);
        }
    }

    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if self.alias.value.trim().is_empty() {
            errors.push("Alias is required".to_string());
        }
        if self.provider.is_empty() {
            errors.push("No providers configured".to_string());
        }
        if self.model.selected_value().is_none() {
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

/// Sections on the page (replaces tabs)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Section {
    Settings,
    Models,
    Stacks,
    Skills,
    Tools,
    Hooks,
}

impl Section {
    pub fn all() -> &'static [Section] {
        &[
            Section::Settings,
            Section::Models,
            Section::Stacks,
            Section::Skills,
            Section::Tools,
            Section::Hooks,
        ]
    }

    pub fn name(&self) -> &'static str {
        match self {
            Section::Settings => "Settings",
            Section::Models => "Models",
            Section::Stacks => "Stacks",
            Section::Skills => "Skills",
            Section::Tools => "Tools",
            Section::Hooks => "Hooks",
        }
    }

    pub fn next(self) -> Self {
        match self {
            Section::Settings => Section::Models,
            Section::Models => Section::Stacks,
            Section::Stacks => Section::Skills,
            Section::Skills => Section::Tools,
            Section::Tools => Section::Hooks,
            Section::Hooks => Section::Settings,
        }
    }

    pub fn prev(self) -> Self {
        match self {
            Section::Settings => Section::Hooks,
            Section::Models => Section::Settings,
            Section::Stacks => Section::Models,
            Section::Skills => Section::Stacks,
            Section::Tools => Section::Skills,
            Section::Hooks => Section::Tools,
        }
    }

    pub fn from_number(n: u8) -> Option<Self> {
        match n {
            1 => Some(Section::Settings),
            2 => Some(Section::Models),
            3 => Some(Section::Stacks),
            4 => Some(Section::Skills),
            5 => Some(Section::Tools),
            6 => Some(Section::Hooks),
            _ => None,
        }
    }
}

// Keep Tab as alias for backwards compatibility with view logic
pub type Tab = Section;

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
    pub section: Section,
    pub tab: Tab, // Alias for section (backwards compat)
    pub view: View,
    pub input_mode: InputMode,
    pub should_quit: bool,
    pub status_message: Option<String>,

    // Scroll position for the page
    pub scroll_offset: u16,

    // Config
    pub config: KarlConfig,
    pub config_path: PathBuf,
    pub dirty: bool,

    // Models section state
    pub models: FilteredList<ModelItem>,
    pub model_search: TextInput,

    // Stacks section state
    pub stacks: FilteredList<StackItem>,
    pub stack_search: TextInput,

    // Skills section state
    pub skills: FilteredList<SkillInfo>,
    pub skill_search: TextInput,

    // Tools section state
    pub tools: FilteredList<ToolItem>,
    pub tool_search: TextInput,
    pub tool_form: Option<ToolForm>,

    // Hooks section state
    pub hooks: FilteredList<HookInfo>,
    pub hook_search: TextInput,

    // Dialogs
    pub confirm_dialog: Option<ConfirmDialog>,
    pub pending_action: Option<PendingAction>,

    // Forms
    pub model_form: Option<ModelForm>,
    pub stack_form: Option<StackForm>,

    // CLI integration (for Settings section)
    pub cli_status: CliStatus,
    cli_info_receiver: Option<Receiver<CliStatus>>,

    // Login flow state
    pub needs_login_flow: bool,

    // Init wizard state (for --init mode)
    pub init_wizard: Option<InitWizard>,
}

/// Pending action that needs confirmation
#[derive(Debug, Clone)]
pub enum PendingAction {
    DeleteModel(String),
    DeleteStack(String),
    DeleteTool(String),
    Quit,
}

/// Init wizard step
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InitStep {
    Welcome,
    SelectProvider,
    AuthenticateOAuth,
    AuthenticateApiKey,
    CreateModel,
    Confirm,
}

/// Provider option for wizard
#[derive(Debug, Clone)]
pub struct ProviderOption {
    pub key: &'static str,
    pub name: &'static str,
    pub auth_type: &'static str,
    pub provider_type: &'static str,
    pub default_models: &'static [(&'static str, &'static str)], // (alias, model_id)
}

impl ProviderOption {
    pub const CLAUDE_PRO_MAX: Self = Self {
        key: "claude-pro-max",
        name: "Claude Pro/Max",
        auth_type: "oauth",
        provider_type: "anthropic",
        default_models: &[
            ("haiku", "claude-haiku-4-5-20251001"),
            ("sonnet", "claude-sonnet-4-5-20250929"),
            ("opus", "claude-opus-4-5-20251101"),
        ],
    };

    pub const ANTHROPIC: Self = Self {
        key: "anthropic",
        name: "Anthropic API",
        auth_type: "api_key",
        provider_type: "anthropic",
        default_models: &[
            ("fast", "claude-sonnet-4-20250514"),
            ("smart", "claude-opus-4-20250514"),
            ("haiku", "claude-haiku-3-5-20241022"),
        ],
    };

    pub const OPENROUTER: Self = Self {
        key: "openrouter",
        name: "OpenRouter",
        auth_type: "api_key",
        provider_type: "openai",
        default_models: &[
            ("mistral-small", "mistralai/mistral-small-creative"),
            ("devstral", "mistralai/devstral-2512:free"),
            ("mimo", "xiaomi/mimo-v2-flash:free"),
            ("grok", "x-ai/grok-4.1-fast"),
        ],
    };

    pub fn all() -> &'static [Self] {
        &[Self::CLAUDE_PRO_MAX, Self::ANTHROPIC, Self::OPENROUTER]
    }

    /// Get available model IDs for a provider key
    pub fn models_for_provider(key: &str) -> Vec<String> {
        for provider in Self::all() {
            if provider.key == key {
                return provider
                    .default_models
                    .iter()
                    .map(|(_, id)| id.to_string())
                    .collect();
            }
        }
        vec![] // Unknown provider
    }
}

/// Init wizard state
pub struct InitWizard {
    pub step: InitStep,
    pub provider_index: usize,
    pub api_key: TextInput,
    pub model_alias: TextInput,
    pub model_selector: Selector,
    pub oauth_status: OAuthStatus,
    pub error_message: Option<String>,
    /// Field focus in CreateModel step: 0=alias, 1=model selector
    pub model_focused_field: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OAuthStatus {
    NotStarted,
    InProgress,
    Success,
    Failed(String),
}

impl InitWizard {
    pub fn new() -> Self {
        let providers = ProviderOption::all();
        let first_provider = &providers[0];
        let model_options: Vec<String> = first_provider
            .default_models
            .iter()
            .map(|(_, id)| id.to_string())
            .collect();

        Self {
            step: InitStep::Welcome,
            provider_index: 0,
            api_key: TextInput::new().with_placeholder("Enter your API key"),
            model_alias: TextInput::new().with_value("fast"),
            model_selector: Selector::new(model_options),
            oauth_status: OAuthStatus::NotStarted,
            error_message: None,
            model_focused_field: 0, // Start focused on alias field
        }
    }

    pub fn selected_provider(&self) -> &'static ProviderOption {
        &ProviderOption::all()[self.provider_index]
    }

    pub fn next_provider(&mut self) {
        let count = ProviderOption::all().len();
        self.provider_index = (self.provider_index + 1) % count;
        self.update_model_options();
    }

    pub fn prev_provider(&mut self) {
        let count = ProviderOption::all().len();
        self.provider_index = self.provider_index.checked_sub(1).unwrap_or(count - 1);
        self.update_model_options();
    }

    fn update_model_options(&mut self) {
        let provider = self.selected_provider();
        let model_options: Vec<String> = provider
            .default_models
            .iter()
            .map(|(_, id)| id.to_string())
            .collect();
        self.model_selector = Selector::new(model_options);
    }

    pub fn selected_model(&self) -> Option<&str> {
        self.model_selector.selected_value()
    }
}

impl App {
    pub fn new(init_mode: bool) -> anyhow::Result<Self> {
        let (config, config_path) = load_merged_config()?;

        // Start background CLI info fetch (skip in init mode)
        let cli_info_receiver = if init_mode {
            None
        } else {
            Some(cli::fetch_cli_info_async())
        };

        // Create wizard if in init mode
        let init_wizard = if init_mode {
            Some(InitWizard::new())
        } else {
            None
        };

        let mut app = Self {
            section: Section::Settings,
            tab: Section::Settings, // Alias
            view: View::List,
            input_mode: InputMode::Normal,
            should_quit: false,
            status_message: None,
            scroll_offset: 0,
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
            cli_status: CliStatus::Loading,
            cli_info_receiver,
            needs_login_flow: false,
            init_wizard,
        };

        if !init_mode {
            app.refresh_all();
        }
        Ok(app)
    }

    /// Check for CLI info updates (call this in the event loop)
    pub fn poll_cli_info(&mut self) {
        if let Some(ref receiver) = self.cli_info_receiver {
            if let Ok(status) = receiver.try_recv() {
                self.cli_status = status;
                self.cli_info_receiver = None; // Done receiving
            }
        }
    }

    /// Refresh CLI info
    pub fn refresh_cli_info(&mut self) {
        self.cli_status = CliStatus::Loading;
        self.cli_info_receiver = Some(cli::fetch_cli_info_async());
    }

    /// Request a login flow (will be handled by main loop)
    pub fn request_login(&mut self) {
        self.needs_login_flow = true;
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
        // Handle init wizard first (takes over entire UI)
        if self.init_wizard.is_some() {
            self.handle_wizard_key(key);
            return;
        }

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

        // Section navigation (Tab/Shift-Tab to switch sections)
        match key.code {
            KeyCode::Tab => {
                self.section = self.section.next();
                self.tab = self.section; // Keep in sync
                self.view = View::List;
                return;
            }
            KeyCode::BackTab => {
                self.section = self.section.prev();
                self.tab = self.section; // Keep in sync
                self.view = View::List;
                return;
            }
            KeyCode::Char(c) if c.is_ascii_digit() => {
                if let Some(section) = Section::from_number(c as u8 - b'0') {
                    self.section = section;
                    self.tab = section; // Keep in sync
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
                self.refresh_cli_info();
                self.status_message = Some("Refreshed".to_string());
            }
            // Login (Settings section)
            KeyCode::Char('L') if self.section == Section::Settings => {
                self.request_login();
            }
            // Toggle (for tools)
            KeyCode::Char(' ') if self.section == Section::Tools => {
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
                let search_input = match self.section {
                    Section::Models => &mut self.model_search,
                    Section::Stacks => &mut self.stack_search,
                    Section::Skills => &mut self.skill_search,
                    Section::Tools => &mut self.tool_search,
                    Section::Hooks => &mut self.hook_search,
                    Section::Settings => return,
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
        match self.section {
            Section::Models => self.models.next(),
            Section::Stacks => self.stacks.next(),
            Section::Skills => self.skills.next(),
            Section::Tools => self.tools.next(),
            Section::Hooks => self.hooks.next(),
            Section::Settings => {}
        }
    }

    fn move_up(&mut self) {
        match self.section {
            Section::Models => self.models.previous(),
            Section::Stacks => self.stacks.previous(),
            Section::Skills => self.skills.previous(),
            Section::Tools => self.tools.previous(),
            Section::Hooks => self.hooks.previous(),
            Section::Settings => {}
        }
    }

    fn apply_search(&mut self) {
        match self.section {
            Section::Models => {
                let query = self.model_search.value.to_lowercase();
                self.models
                    .apply_filter(|item| item.alias.to_lowercase().contains(&query));
            }
            Section::Stacks => {
                let query = self.stack_search.value.to_lowercase();
                self.stacks
                    .apply_filter(|item| item.name.to_lowercase().contains(&query));
            }
            Section::Skills => {
                let query = self.skill_search.value.to_lowercase();
                self.skills.apply_filter(|item| {
                    item.name.to_lowercase().contains(&query)
                        || item.description.to_lowercase().contains(&query)
                });
            }
            Section::Tools => {
                let query = self.tool_search.value.to_lowercase();
                self.tools
                    .apply_filter(|item| item.name.to_lowercase().contains(&query));
            }
            Section::Hooks => {
                let query = self.hook_search.value.to_lowercase();
                self.hooks
                    .apply_filter(|item| item.name.to_lowercase().contains(&query));
            }
            Section::Settings => {}
        }
    }

    fn clear_search(&mut self) {
        match self.section {
            Section::Models => {
                self.model_search.clear();
                self.models.clear_filter();
            }
            Section::Stacks => {
                self.stack_search.clear();
                self.stacks.clear_filter();
            }
            Section::Skills => {
                self.skill_search.clear();
                self.skills.clear_filter();
            }
            Section::Tools => {
                self.tool_search.clear();
                self.tools.clear_filter();
            }
            Section::Hooks => {
                self.hook_search.clear();
                self.hooks.clear_filter();
            }
            Section::Settings => {}
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
        match self.section {
            Section::Models => {
                if let Some(model) = self.models.selected() {
                    self.confirm_dialog = Some(ConfirmDialog::new(
                        "Delete Model",
                        &format!("Delete model '{}'?", model.alias),
                    ));
                    self.pending_action = Some(PendingAction::DeleteModel(model.alias.clone()));
                }
            }
            Section::Stacks => {
                if let Some(stack) = self.stacks.selected() {
                    self.confirm_dialog = Some(ConfirmDialog::new(
                        "Delete Stack",
                        &format!("Delete stack '{}'?", stack.name),
                    ));
                    self.pending_action = Some(PendingAction::DeleteStack(stack.name.clone()));
                }
            }
            Section::Tools => {
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

    /// Get list of provider names from config
    fn get_provider_names(&self) -> Vec<String> {
        self.config.providers.keys().cloned().collect()
    }

    fn start_create(&mut self) {
        match self.section {
            Section::Models => {
                let providers = self.get_provider_names();
                self.model_form = Some(ModelForm::new_create(providers));
                self.view = View::Create;
                self.input_mode = InputMode::Editing;
            }
            Section::Stacks => {
                self.stack_form = Some(StackForm::new_create());
                self.view = View::Create;
                self.input_mode = InputMode::Editing;
            }
            Section::Tools => {
                self.tool_form = Some(ToolForm::new());
                self.view = View::Create;
                self.input_mode = InputMode::Editing;
            }
            _ => {}
        }
    }

    fn start_edit(&mut self) {
        match self.section {
            Section::Models => {
                if let Some(model) = self.models.selected() {
                    let is_default = self.config.default_model == model.alias;
                    let providers = self.get_provider_names();
                    self.model_form = Some(ModelForm::new_edit(&model.alias, &model.config, is_default, providers));
                    self.view = View::Edit;
                    self.input_mode = InputMode::Editing;
                }
            }
            Section::Stacks => {
                if let Some(stack) = self.stacks.selected() {
                    self.stack_form = Some(StackForm::new_edit(&stack.name, &stack.config));
                    self.view = View::Edit;
                    self.input_mode = InputMode::Editing;
                }
            }
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
                    1 => {
                        // Update model options when provider changes
                        if form.provider.handle_key(key) {
                            form.update_model_options();
                        }
                    }
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
        let provider = form.selected_provider().unwrap_or_default().to_string();
        let config = ModelConfig {
            provider,
            model: form.model.selected_value().unwrap_or_default().to_string(),
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

    // Init Wizard handling

    fn handle_wizard_key(&mut self, key: KeyEvent) {
        // Esc to cancel wizard (quit with message)
        if key.code == KeyCode::Esc {
            self.should_quit = true;
            return;
        }

        let wizard = match self.init_wizard.as_mut() {
            Some(w) => w,
            None => return,
        };

        match wizard.step {
            InitStep::Welcome => {
                // Any key proceeds to provider selection
                if key.code == KeyCode::Enter {
                    wizard.step = InitStep::SelectProvider;
                }
            }
            InitStep::SelectProvider => {
                match key.code {
                    KeyCode::Up | KeyCode::Char('k') => wizard.prev_provider(),
                    KeyCode::Down | KeyCode::Char('j') => wizard.next_provider(),
                    KeyCode::Enter => {
                        let provider = wizard.selected_provider();
                        if provider.auth_type == "oauth" {
                            wizard.step = InitStep::AuthenticateOAuth;
                        } else {
                            wizard.step = InitStep::AuthenticateApiKey;
                        }
                    }
                    _ => {}
                }
            }
            InitStep::AuthenticateOAuth => {
                match key.code {
                    KeyCode::Enter => {
                        // Request OAuth flow through main loop
                        self.needs_login_flow = true;
                        wizard.oauth_status = OAuthStatus::InProgress;
                    }
                    KeyCode::Char('s') | KeyCode::Char('S') => {
                        // Skip - proceed without OAuth (user can do it later)
                        wizard.step = InitStep::CreateModel;
                    }
                    KeyCode::Backspace => {
                        wizard.step = InitStep::SelectProvider;
                        wizard.oauth_status = OAuthStatus::NotStarted;
                    }
                    _ => {}
                }
            }
            InitStep::AuthenticateApiKey => {
                match key.code {
                    KeyCode::Enter => {
                        if !wizard.api_key.value.trim().is_empty() {
                            wizard.step = InitStep::CreateModel;
                        } else {
                            wizard.error_message = Some("API key is required".to_string());
                        }
                    }
                    KeyCode::Backspace if wizard.api_key.value.is_empty() => {
                        wizard.step = InitStep::SelectProvider;
                    }
                    _ => {
                        wizard.api_key.handle_key(key);
                        wizard.error_message = None;
                    }
                }
            }
            InitStep::CreateModel => {
                match key.code {
                    KeyCode::Tab => {
                        // Toggle between alias (0) and model selector (1)
                        wizard.model_focused_field = 1 - wizard.model_focused_field;
                    }
                    KeyCode::Enter => {
                        if !wizard.model_alias.value.trim().is_empty() {
                            wizard.step = InitStep::Confirm;
                        } else {
                            wizard.error_message = Some("Model alias is required".to_string());
                        }
                    }
                    KeyCode::Esc => {
                        // Go back to previous step
                        let provider = wizard.selected_provider();
                        if provider.auth_type == "oauth" {
                            wizard.step = InitStep::AuthenticateOAuth;
                        } else {
                            wizard.step = InitStep::AuthenticateApiKey;
                        }
                    }
                    _ => {
                        // Handle input based on focused field
                        if wizard.model_focused_field == 0 {
                            // Alias field - all keys go to text input
                            wizard.model_alias.handle_key(key);
                            wizard.error_message = None;
                        } else {
                            // Model selector - j/k/up/down navigate
                            match key.code {
                                KeyCode::Up | KeyCode::Char('k') => {
                                    wizard.model_selector.previous();
                                }
                                KeyCode::Down | KeyCode::Char('j') => {
                                    wizard.model_selector.next();
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            InitStep::Confirm => {
                match key.code {
                    KeyCode::Enter | KeyCode::Char('y') | KeyCode::Char('Y') => {
                        self.complete_wizard();
                    }
                    KeyCode::Backspace | KeyCode::Char('n') | KeyCode::Char('N') => {
                        if let Some(w) = self.init_wizard.as_mut() {
                            w.step = InitStep::CreateModel;
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    /// Called when OAuth flow completes (from main loop)
    pub fn wizard_oauth_complete(&mut self, success: bool) {
        if let Some(wizard) = self.init_wizard.as_mut() {
            if success {
                wizard.oauth_status = OAuthStatus::Success;
                wizard.step = InitStep::CreateModel;
            } else {
                wizard.oauth_status = OAuthStatus::Failed("OAuth authentication failed".to_string());
            }
        }
    }

    /// Complete the wizard and save config
    fn complete_wizard(&mut self) {
        let wizard = match self.init_wizard.take() {
            Some(w) => w,
            None => return,
        };

        let provider = wizard.selected_provider();
        let model_alias = wizard.model_alias.value.trim().to_string();
        let model_id = wizard.selected_model().unwrap_or(provider.default_models[0].1).to_string();

        // Add provider to config
        let mut provider_config = crate::data::ProviderConfig::default();
        provider_config.provider_type = provider.provider_type.to_string();

        if provider.auth_type == "oauth" {
            provider_config.auth_type = Some("oauth".to_string());
        } else {
            // For API key providers, store the actual key in config
            let api_key = wizard.api_key.value.trim().to_string();
            provider_config.api_key = Some(api_key);

            if provider.key == "openrouter" {
                provider_config.base_url = Some("https://openrouter.ai/api/v1".to_string());
            }
        }

        self.config.providers.insert(provider.key.to_string(), provider_config);

        // Add model to config
        let model_config = ModelConfig {
            provider: provider.key.to_string(),
            model: model_id.clone(),
            extra: std::collections::HashMap::new(),
        };
        self.config.models.insert(model_alias.clone(), model_config);

        // Set as default model
        self.config.default_model = model_alias.clone();

        // Save config
        match save_config(&self.config, &self.config_path) {
            Ok(()) => {
                self.status_message = Some(format!("Setup complete! Default model: {}", model_alias));
            }
            Err(e) => {
                self.status_message = Some(format!("Setup failed: {}", e));
            }
        }

        // Exit after setup
        self.should_quit = true;
    }

    /// Check if we're in wizard mode
    pub fn is_wizard_mode(&self) -> bool {
        self.init_wizard.is_some()
    }
}
