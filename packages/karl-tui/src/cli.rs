//! CLI integration module
//!
//! Calls the karl CLI to get system info, auth status, etc.
//! The CLI is the source of truth for complex operations.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::process::Command;
use std::sync::mpsc;
use std::thread;

/// Info output from `karl info --json`
#[derive(Debug, Clone, Deserialize)]
pub struct CliInfo {
    pub version: String,
    pub config: ConfigInfo,
    pub auth: HashMap<String, AuthStatus>,
    pub models: ModelsInfo,
    pub providers: HashMap<String, ProviderStatus>,
    pub counts: Counts,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConfigInfo {
    pub global_path: String,
    pub project_path: String,
    pub global_exists: bool,
    pub project_exists: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthStatus {
    pub authenticated: bool,
    pub method: String,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelsInfo {
    pub default: String,
    pub configured: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderStatus {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub has_key: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Counts {
    pub skills: u32,
    pub stacks: u32,
    pub hooks: u32,
    pub models: u32,
}

/// Status of CLI info fetch
#[derive(Debug, Clone)]
pub enum CliStatus {
    /// Fetching info in background
    Loading,
    /// Info successfully loaded
    Loaded(CliInfo),
    /// CLI not found or error occurred
    Error(String),
    /// CLI not available
    NotAvailable,
}

impl Default for CliStatus {
    fn default() -> Self {
        CliStatus::Loading
    }
}

/// Check if karl CLI is available
pub fn check_cli_available() -> bool {
    Command::new("karl")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get CLI info synchronously (blocking)
pub fn get_cli_info() -> Result<CliInfo> {
    let output = Command::new("karl")
        .args(["info", "--json"])
        .output()
        .context("Failed to run karl info")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("karl info failed: {}", stderr);
    }

    let info: CliInfo = serde_json::from_slice(&output.stdout)
        .context("Failed to parse karl info output")?;

    Ok(info)
}

/// Spawn a background thread to fetch CLI info
/// Returns a receiver that will receive the result
pub fn fetch_cli_info_async() -> mpsc::Receiver<CliStatus> {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let status = if !check_cli_available() {
            CliStatus::NotAvailable
        } else {
            match get_cli_info() {
                Ok(info) => CliStatus::Loaded(info),
                Err(e) => CliStatus::Error(e.to_string()),
            }
        };
        let _ = tx.send(status);
    });

    rx
}

/// Run an interactive CLI command (like --login)
/// This suspends the TUI and runs the command with inherited stdio
pub fn run_interactive_command(args: &[&str]) -> Result<bool> {
    let status = Command::new("karl")
        .args(args)
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .status()
        .context("Failed to run karl command")?;

    Ok(status.success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_cli_available() {
        // This test will pass if karl is in PATH
        let available = check_cli_available();
        println!("CLI available: {}", available);
    }

    #[test]
    fn test_parse_cli_info() {
        let json = r#"{
            "version": "0.1.0",
            "config": {
                "global_path": "/home/user/.config/karl/karl.json",
                "project_path": ".karl.json",
                "global_exists": true,
                "project_exists": false
            },
            "auth": {
                "anthropic": {
                    "authenticated": true,
                    "method": "oauth",
                    "expires_at": "2025-12-20T10:00:00Z"
                }
            },
            "models": {
                "default": "fast",
                "configured": ["fast", "smart"]
            },
            "providers": {
                "anthropic": {
                    "type": "anthropic",
                    "has_key": false
                }
            },
            "counts": {
                "skills": 3,
                "stacks": 2,
                "hooks": 0,
                "models": 2
            }
        }"#;

        let info: CliInfo = serde_json::from_str(json).unwrap();
        assert_eq!(info.version, "0.1.0");
        assert!(info.auth.get("anthropic").unwrap().authenticated);
        assert_eq!(info.counts.skills, 3);
    }
}
