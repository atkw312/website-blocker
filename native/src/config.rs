//! Persistent configuration stored as JSON on disk.

use crate::platform;
use crate::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Config {
    #[serde(default)]
    pub password_hash: Option<String>,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
}

fn config_path() -> PathBuf {
    platform::config_dir().join("config.json")
}

/// Load config from disk, returning defaults if the file doesn't exist.
pub fn load() -> Result<Config, AppError> {
    let path = config_path();
    if !path.exists() {
        return Ok(Config::default());
    }
    let data = fs::read_to_string(&path)?;
    serde_json::from_str(&data).map_err(|e| AppError::Config(format!("Invalid config: {e}")))
}

/// Persist config to disk, creating the parent directory if needed.
pub fn save(config: &Config) -> Result<(), AppError> {
    let dir = platform::config_dir();
    fs::create_dir_all(&dir)?;
    let data = serde_json::to_string_pretty(config)?;
    fs::write(config_path(), data)?;
    Ok(())
}
