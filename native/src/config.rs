//! Persistent configuration stored as JSON on disk.
//!
//! The config file is the single source of truth shared across all browser
//! profiles and browser instances. File locking (via `fs2`) ensures safe
//! concurrent access from multiple native-messaging processes.
//!
//! Mode-based state machine (v2):
//!   session.mode: "off" | "precision" | "strict"
//!   global_settings.default_mode: "precision" | "strict"

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

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionState {
    /// "off" | "precision" | "strict" — replaces the old `active` boolean.
    #[serde(default = "default_mode_off")]
    pub mode: String,
    #[serde(default)]
    pub start_time: Option<u64>, // epoch ms
    #[serde(default)]
    pub end_time: Option<u64>,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub scheduled_id: Option<String>,

    // Legacy fields — read for migration, never written back.
    #[serde(default, skip_serializing)]
    active: Option<bool>,
}

fn default_mode_off() -> String {
    "off".to_string()
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            mode: "off".to_string(),
            start_time: None,
            end_time: None,
            locked: false,
            scheduled_id: None,
            active: None,
        }
    }
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
    /// "precision" | "strict" — replaces the old `strict_mode` boolean.
    #[serde(default = "default_mode_precision")]
    pub default_mode: String,
    /// Only applies in precision mode.
    #[serde(default)]
    pub block_all_channels: bool,
    #[serde(default = "default_session_duration")]
    pub session_duration_minutes: u32,

    // Legacy fields — read for migration, never written back.
    #[serde(default, skip_serializing)]
    strict_mode: Option<bool>,
    #[serde(default, skip_serializing)]
    block_youtube_fallback: Option<bool>,
}

fn default_mode_precision() -> String {
    "precision".to_string()
}

fn default_session_duration() -> u32 {
    30
}

impl Default for GlobalSettings {
    fn default() -> Self {
        Self {
            default_mode: "precision".to_string(),
            block_all_channels: false,
            session_duration_minutes: 30,
            strict_mode: None,
            block_youtube_fallback: None,
        }
    }
}

/// Returns true if the mode value represents an active session.
pub fn is_mode_active(mode: &str) -> bool {
    mode == "precision" || mode == "strict"
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
// Migration
// =========================================================================

/// Migrate legacy boolean fields to mode-based schema.
/// Called after deserialization — mutates in place.
fn migrate(config: &mut Config) {
    // Migrate session: if mode is default "off" but legacy `active` is true
    if let Some(ref mut session) = config.session {
        if session.mode == "off" {
            if let Some(true) = session.active {
                // Derive mode from global_settings.strict_mode
                let was_strict = config
                    .global_settings
                    .as_ref()
                    .and_then(|gs| gs.strict_mode)
                    .unwrap_or(false);
                session.mode = if was_strict {
                    "strict".to_string()
                } else {
                    "precision".to_string()
                };
            }
        }
        // Clear legacy field
        session.active = None;
    }

    // Migrate global_settings: if legacy strict_mode exists
    if let Some(ref mut gs) = config.global_settings {
        if let Some(strict) = gs.strict_mode {
            if gs.default_mode == "precision" && strict {
                gs.default_mode = "strict".to_string();
            }
            gs.strict_mode = None;
        }
        if let Some(fallback) = gs.block_youtube_fallback {
            // block_youtube_fallback is removed — strict mode IS the fallback.
            // If it was true and block_all_channels is false, leave it.
            // The behavior is now handled by mode, not a separate flag.
            gs.block_youtube_fallback = None;
            let _ = fallback; // consumed
        }
    }
}

// =========================================================================
// Load / save with file locking
// =========================================================================

/// Load config from disk, returning defaults if the file doesn't exist.
/// Runs migration for legacy fields.
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

    let mut config: Config =
        serde_json::from_str(&data).map_err(|e| AppError::Config(format!("Invalid config: {e}")))?;
    migrate(&mut config);
    Ok(config)
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

    migrate(&mut config);
    f(&mut config);

    let output = serde_json::to_string_pretty(&config)?;
    fs::write(&path, &output)?;

    file.unlock().ok();
    Ok(config)
}
