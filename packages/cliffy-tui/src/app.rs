use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::path::PathBuf;

use crate::data::{
    discover_hooks, discover_skills, discover_stacks, load_merged_config, save_config,
    CliffyConfig, HookInfo, ModelConfig, SkillInfo, StackConfig,
};
use crate::widgets::{ConfirmDialog, FilteredList, TextInput};

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

    // Hooks tab state
    pub hooks: FilteredList<HookInfo>,
    pub hook_search: TextInput,

    // Dialogs
    pub confirm_dialog: Option<ConfirmDialog>,
    pub pending_action: Option<PendingAction>,
}

/// Pending action that needs confirmation
#[derive(Debug, Clone)]
pub enum PendingAction {
    DeleteModel(String),
    DeleteStack(String),
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
            hooks: FilteredList::new(vec![]),
            hook_search: TextInput::new().with_placeholder("Search hooks..."),
            confirm_dialog: None,
            pending_action: None,
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
                // TODO: Enter edit mode
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
}
