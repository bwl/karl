use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Cliffy configuration structure
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CliffyConfig {
    #[serde(default = "default_model")]
    pub default_model: String,
    #[serde(default)]
    pub models: HashMap<String, ModelConfig>,
    #[serde(default)]
    pub providers: HashMap<String, ProviderConfig>,
    #[serde(default)]
    pub tools: ToolsConfig,
    #[serde(default)]
    pub volley: VolleyConfig,
    #[serde(default)]
    pub stacks: HashMap<String, StackConfig>,
}

fn default_model() -> String {
    "fast".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelConfig {
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsConfig {
    #[serde(default = "default_tools")]
    pub enabled: Vec<String>,
    #[serde(default)]
    pub custom: Vec<String>,
}

fn default_tools() -> Vec<String> {
    vec![
        "bash".to_string(),
        "read".to_string(),
        "write".to_string(),
        "edit".to_string(),
    ]
}

impl Default for ToolsConfig {
    fn default() -> Self {
        Self {
            enabled: default_tools(),
            custom: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolleyConfig {
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent: u32,
    #[serde(default = "default_retry_attempts")]
    pub retry_attempts: u32,
    #[serde(default = "default_retry_backoff")]
    pub retry_backoff: String,
}

fn default_max_concurrent() -> u32 {
    3
}
fn default_retry_attempts() -> u32 {
    3
}
fn default_retry_backoff() -> String {
    "exponential".to_string()
}

impl Default for VolleyConfig {
    fn default() -> Self {
        Self {
            max_concurrent: default_max_concurrent(),
            retry_attempts: default_retry_attempts(),
            retry_backoff: default_retry_backoff(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StackConfig {
    pub name: Option<String>,
    pub extends: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub timeout: Option<u64>,
    pub max_tokens: Option<u32>,
    pub skill: Option<String>,
    pub context: Option<String>,
    pub context_file: Option<String>,
    pub unrestricted: Option<bool>,
}

/// Skill metadata from SKILL.md frontmatter
#[derive(Debug, Clone, Default)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub license: Option<String>,
    pub path: PathBuf,
}

/// Hook information
#[derive(Debug, Clone)]
pub struct HookInfo {
    pub name: String,
    pub hook_type: String,
    pub path: PathBuf,
}

/// Load config from a path
pub fn load_config(path: &Path) -> Result<CliffyConfig> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("Failed to read config from {:?}", path))?;
    let config: CliffyConfig = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse config from {:?}", path))?;
    Ok(config)
}

/// Save config to a path
pub fn save_config(config: &CliffyConfig, path: &Path) -> Result<()> {
    let content = serde_json::to_string_pretty(config)?;
    fs::write(path, content)?;
    Ok(())
}

/// Get global config path
pub fn global_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("cliffy").join("cliffy.json"))
}

/// Get project config path
pub fn project_config_path() -> PathBuf {
    PathBuf::from(".cliffy.json")
}

/// Load merged config (global + project)
pub fn load_merged_config() -> Result<(CliffyConfig, PathBuf)> {
    let mut config = CliffyConfig::default();
    let mut config_path = PathBuf::new();

    // Load global config
    if let Some(global_path) = global_config_path() {
        if global_path.exists() {
            if let Ok(global_config) = load_config(&global_path) {
                config = global_config;
                config_path = global_path;
            }
        }
    }

    // Load project config (overrides)
    let project_path = project_config_path();
    if project_path.exists() {
        if let Ok(project_config) = load_config(&project_path) {
            // Merge project config into global
            for (k, v) in project_config.models {
                config.models.insert(k, v);
            }
            for (k, v) in project_config.providers {
                config.providers.insert(k, v);
            }
            for (k, v) in project_config.stacks {
                config.stacks.insert(k, v);
            }
            if !project_config.default_model.is_empty() {
                config.default_model = project_config.default_model;
            }
            config_path = project_path;
        }
    }

    Ok((config, config_path))
}

/// Discover skills from all paths
pub fn discover_skills() -> Vec<SkillInfo> {
    let mut skills = Vec::new();
    let paths = skill_paths();

    for base_path in paths {
        if !base_path.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(&base_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                let skill_file = path.join("SKILL.md");

                if skill_file.exists() {
                    if let Ok(info) = parse_skill_file(&skill_file, &path) {
                        skills.push(info);
                    }
                }
            }
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

/// Get skill discovery paths
fn skill_paths() -> Vec<PathBuf> {
    let mut paths = vec![];

    if let Some(config_dir) = dirs::config_dir() {
        paths.push(config_dir.join("cliffy").join("skills"));
    }

    paths.push(PathBuf::from(".cliffy").join("skills"));

    paths
}

/// Parse skill metadata from SKILL.md
fn parse_skill_file(skill_file: &Path, skill_dir: &Path) -> Result<SkillInfo> {
    let content = fs::read_to_string(skill_file)?;

    // Parse YAML frontmatter
    let mut name = String::new();
    let mut description = String::new();
    let mut license = None;

    if content.starts_with("---") {
        if let Some(end) = content[3..].find("---") {
            let frontmatter = &content[3..3 + end];
            for line in frontmatter.lines() {
                let line = line.trim();
                if let Some(val) = line.strip_prefix("name:") {
                    name = val.trim().trim_matches('"').to_string();
                } else if let Some(val) = line.strip_prefix("description:") {
                    description = val.trim().trim_matches('"').to_string();
                } else if let Some(val) = line.strip_prefix("license:") {
                    license = Some(val.trim().trim_matches('"').to_string());
                }
            }
        }
    }

    // Fallback to directory name
    if name.is_empty() {
        name = skill_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
    }

    Ok(SkillInfo {
        name,
        description,
        license,
        path: skill_dir.to_path_buf(),
    })
}

/// Discover stacks from all sources
pub fn discover_stacks(config: &CliffyConfig) -> Vec<(String, StackConfig, String)> {
    let mut stacks: Vec<(String, StackConfig, String)> = Vec::new();

    // Inline stacks from config
    for (name, stack) in &config.stacks {
        stacks.push((name.clone(), stack.clone(), "inline".to_string()));
    }

    // File-based stacks
    let paths = stack_paths();
    for base_path in paths {
        if !base_path.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(&base_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(stack) = serde_json::from_str::<StackConfig>(&content) {
                            let name = path
                                .file_stem()
                                .and_then(|n| n.to_str())
                                .unwrap_or("unknown")
                                .to_string();
                            // Don't duplicate if already in config
                            if !stacks.iter().any(|(n, _, _)| n == &name) {
                                stacks.push((
                                    name,
                                    stack,
                                    path.to_string_lossy().to_string(),
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    stacks.sort_by(|a, b| a.0.cmp(&b.0));
    stacks
}

/// Get stack discovery paths
fn stack_paths() -> Vec<PathBuf> {
    let mut paths = vec![];

    if let Some(config_dir) = dirs::config_dir() {
        paths.push(config_dir.join("cliffy").join("stacks"));
    }

    paths.push(PathBuf::from(".cliffy").join("stacks"));

    paths
}

/// Discover hooks from all paths
pub fn discover_hooks() -> Vec<HookInfo> {
    let mut hooks = Vec::new();
    let paths = hook_paths();

    for base_path in paths {
        if !base_path.exists() {
            continue;
        }

        for entry in WalkDir::new(&base_path)
            .max_depth(2)
            .into_iter()
            .flatten()
        {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str());
                if matches!(ext, Some("js") | Some("ts") | Some("mjs")) {
                    let name = path
                        .file_stem()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();

                    // Infer hook type from name
                    let hook_type = if name.contains("pre-task") {
                        "pre-task"
                    } else if name.contains("post-task") {
                        "post-task"
                    } else if name.contains("pre-tool") {
                        "pre-tool"
                    } else if name.contains("post-tool") {
                        "post-tool"
                    } else if name.contains("on-error") {
                        "on-error"
                    } else {
                        "unknown"
                    };

                    hooks.push(HookInfo {
                        name,
                        hook_type: hook_type.to_string(),
                        path: path.to_path_buf(),
                    });
                }
            }
        }
    }

    hooks.sort_by(|a, b| a.name.cmp(&b.name));
    hooks
}

/// Get hook discovery paths
fn hook_paths() -> Vec<PathBuf> {
    let mut paths = vec![];

    if let Some(config_dir) = dirs::config_dir() {
        paths.push(config_dir.join("cliffy").join("hooks"));
    }

    paths.push(PathBuf::from(".cliffy").join("hooks"));

    paths
}
