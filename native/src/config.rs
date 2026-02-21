//! Persistent configuration stored as JSON on disk.
//!
//! The config file is the single source of truth shared across all browser
//! profiles and browser instances. File locking (via `fs2`) ensures safe
//! concurrent access from multiple native-messaging processes.

use crate::platform;
use crate::AppError;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

// =========================================================================
// Data model
// =========================================================================

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Config {
    #[serde(default)]
    pub password_hash: Option<String>,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
    #[serde(default)]
    pub session: Option<SessionState>,
    #[serde(default)]
    pub youtube_rules: Option<YoutubeRules>,
    #[serde(default)]
    pub global_settings: Option<GlobalSettings>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct SessionState {
    pub active: bool,
    #[serde(default)]
    pub start_time: Option<u64>, // epoch ms
    #[serde(default)]
    pub end_time: Option<u64>,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub scheduled_id: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct YoutubeRules {
    #[serde(default)]
    pub blocked_channels: Vec<String>,
    #[serde(default)]
    pub allowed_channels: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GlobalSettings {
    #[serde(default)]
    pub strict_mode: bool,
    #[serde(default)]
    pub block_youtube_fallback: bool,
    #[serde(default = "default_session_duration")]
    pub session_duration_minutes: u32,
}

fn default_session_duration() -> u32 {
    30
}

impl Default for GlobalSettings {
    fn default() -> Self {
        Self {
            strict_mode: false,
            block_youtube_fallback: false,
            session_duration_minutes: 30,
        }
    }
}

// =========================================================================
// Path helpers
// =========================================================================

fn config_path() -> PathBuf {
    platform::config_dir().join("config.json")
}

/// Current time as milliseconds since Unix epoch.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// =========================================================================
// Load / save with file locking
// =========================================================================

/// Load config from disk, returning defaults if the file doesn't exist.
pub fn load() -> Result<Config, AppError> {
    let path = config_path();
    if !path.exists() {
        return Ok(Config::default());
    }

    let file = File::open(&path)?;
    file.lock_shared().map_err(|e| AppError::Config(format!("Shared lock failed: {e}")))?;

    // Read while the shared lock is held by `file`.
    let data = fs::read_to_string(&path)?;

    file.unlock().ok();

    serde_json::from_str(&data).map_err(|e| AppError::Config(format!("Invalid config: {e}")))
}

/// Persist config to disk, creating the parent directory if needed.
pub fn save(config: &Config) -> Result<(), AppError> {
    let dir = platform::config_dir();
    fs::create_dir_all(&dir)?;

    let path = config_path();
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)?;

    file.lock_exclusive()
        .map_err(|e| AppError::Config(format!("Exclusive lock failed: {e}")))?;

    let data = serde_json::to_string_pretty(config)?;
    // Truncate and write while holding the lock.
    fs::write(&path, &data)?;

    file.unlock().ok();
    Ok(())
}

/// Atomic read-modify-write with exclusive file lock.
///
/// The closure receives a mutable reference to the current config.
/// After the closure returns, the modified config is saved to disk.
pub fn update<F>(f: F) -> Result<Config, AppError>
where
    F: FnOnce(&mut Config),
{
    let dir = platform::config_dir();
    fs::create_dir_all(&dir)?;

    let path = config_path();

    // Ensure the file exists before locking.
    if !path.exists() {
        fs::write(&path, "{}")?;
    }

    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)?;

    file.lock_exclusive()
        .map_err(|e| AppError::Config(format!("Exclusive lock failed: {e}")))?;

    // Read current state under the lock.
    let data = fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());

    let mut config: Config =
        serde_json::from_str(&data).unwrap_or_default();

    f(&mut config);

    let output = serde_json::to_string_pretty(&config)?;
    fs::write(&path, &output)?;

    file.unlock().ok();
    Ok(config)
}
