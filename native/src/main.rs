//! Focus Blocker — Native enforcement agent.
//!
//! Runs as a Chrome Native Messaging host. Manages system-level domain blocking
//! via the hosts file. Acts as the single source of truth for session state,
//! block rules, and settings — shared across all browser profiles and browsers.
//!
//! Usage:
//!   focus-blocker-native          # Native messaging mode (launched by Chrome)
//!   focus-blocker-native setup    # Interactive first-time password setup
//!   focus-blocker-native restore  # Re-apply persisted blocks + monitor session expiry

mod config;
mod hosts_manager;
mod native_messaging;
mod password;
mod platform;
#[cfg(windows)]
mod registry;
mod watchdog;

use serde_json::json;
use std::io;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use thiserror::Error;

// =========================================================================
// Error type
// =========================================================================

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Password error: {0}")]
    Password(String),

    #[error("Hosts file error: {0}")]
    Hosts(String),

    #[error("Messaging error: {0}")]
    Messaging(String),
}

// =========================================================================
// Entry point
// =========================================================================

fn main() {
    let result = match std::env::args().nth(1).as_deref() {
        Some("setup") => run_setup(),
        Some("restore") => run_restore(),
        _ => run_native_messaging(),
    };

    if let Err(e) = result {
        eprintln!("[FocusBlocker] Fatal: {e}");
        std::process::exit(1);
    }
}

// =========================================================================
// Setup mode (interactive CLI)
// =========================================================================

fn run_setup() -> Result<(), AppError> {
    println!("Focus Blocker — Initial Setup");
    println!("-----------------------------");

    let mut cfg = config::load()?;

    if cfg.password_hash.is_some() {
        println!("Password already configured.");
        println!(
            "Config: {}",
            platform::config_dir().join("config.json").display()
        );
        println!("Delete the config file to reset.");
        return Ok(());
    }

    // TODO: Use the rpassword crate for masked terminal input in production.
    let pw = prompt("Create a password: ")?;
    if pw.is_empty() {
        return Err(AppError::Password("Password cannot be empty".into()));
    }

    let pw2 = prompt("Confirm password:  ")?;
    if pw != pw2 {
        return Err(AppError::Password("Passwords do not match".into()));
    }

    cfg.password_hash = Some(password::hash(&pw)?);
    config::save(&cfg)?;

    println!("Password set successfully.");
    println!(
        "Config saved to: {}",
        platform::config_dir().join("config.json").display()
    );
    Ok(())
}

fn prompt(label: &str) -> Result<String, AppError> {
    use io::Write;
    print!("{label}");
    io::stdout().flush()?;
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    Ok(input.trim().to_string())
}

// =========================================================================
// Restore mode — re-apply persisted blocks + monitor session expiry
// =========================================================================

fn run_restore() -> Result<(), AppError> {
    let cfg = config::load()?;

    // Determine which domains to block: blocked_domains + youtube fallback
    let domains = collect_blocked_domains(&cfg);

    if domains.is_empty() && cfg.session.as_ref().map_or(true, |s| !s.active) {
        eprintln!("[FocusBlocker] Restore: no persisted blocks and no active session, exiting.");
        return Ok(());
    }

    if !domains.is_empty() {
        eprintln!(
            "[FocusBlocker] Restore: re-applying {} domain(s).",
            domains.len()
        );
        hosts_manager::apply(&domains)?;
    }

    // Start watchdog to guard against tampering.
    let blocked = Arc::new(Mutex::new(domains));
    let _watchdog = watchdog::start(Arc::clone(&blocked));

    // Poll config file every 10s. Check for:
    // 1. Session expiry → auto-end and clean up hosts
    // 2. Domain list changes → update watchdog state
    // 3. All clear → exit
    loop {
        thread::sleep(Duration::from_secs(10));

        let current = config::load()?;

        // Check for session expiry
        if let Some(ref session) = current.session {
            if session.active {
                if let Some(end_time) = session.end_time {
                    if config::now_ms() >= end_time {
                        eprintln!("[FocusBlocker] Restore: session expired, auto-ending.");
                        auto_end_session()?;
                        continue;
                    }
                }
            }
        }

        let current_domains = collect_blocked_domains(&current);

        if current_domains.is_empty()
            && current.session.as_ref().map_or(true, |s| !s.active)
        {
            eprintln!("[FocusBlocker] Restore: domains cleared and no active session, cleaning up.");
            hosts_manager::apply(&[])?;
            break;
        }

        // Sync in-memory state so watchdog uses the latest list.
        if let Ok(mut guard) = blocked.lock() {
            if *guard != current_domains {
                hosts_manager::apply(&current_domains)?;
                *guard = current_domains;
            }
        }
    }

    Ok(())
}

/// Auto-end an expired session: clear session state and hosts file.
fn auto_end_session() -> Result<(), AppError> {
    config::update(|cfg| {
        cfg.session = Some(config::SessionState {
            active: false,
            start_time: None,
            end_time: None,
            locked: false,
            scheduled_id: None,
        });
        cfg.blocked_domains.clear();
    })?;
    hosts_manager::apply(&[])?;
    Ok(())
}

/// Build the full list of domains to block in the hosts file.
/// Includes blocked_domains + youtube.com if fallback is enabled during a session.
fn collect_blocked_domains(cfg: &config::Config) -> Vec<String> {
    let mut domains = cfg.blocked_domains.clone();

    let session_active = cfg.session.as_ref().map_or(false, |s| s.active);
    let fallback = cfg
        .global_settings
        .as_ref()
        .map_or(false, |s| s.block_youtube_fallback);

    if session_active && fallback {
        let yt = "youtube.com".to_string();
        if !domains.contains(&yt) {
            domains.push(yt);
        }
    }

    domains
}

// =========================================================================
// Native messaging mode
// =========================================================================

fn run_native_messaging() -> Result<(), AppError> {
    let cfg = config::load()?;
    let blocked = Arc::new(Mutex::new(cfg.blocked_domains.clone()));

    // Background thread: re-applies hosts entries if they're tampered with.
    let _watchdog = watchdog::start(Arc::clone(&blocked));

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    loop {
        match native_messaging::read_message(&mut reader) {
            Ok(msg) => {
                let (response, quit) = handle_message(&msg, &blocked)?;
                native_messaging::write_message(&mut writer, &response)?;
                if quit {
                    break;
                }
            }
            // Chrome closed the pipe — clean exit.
            Err(AppError::Io(ref e)) if e.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e),
        }
    }

    Ok(())
}

// =========================================================================
// Message dispatch
// =========================================================================

fn handle_message(
    msg: &serde_json::Value,
    blocked: &Arc<Mutex<Vec<String>>>,
) -> Result<(serde_json::Value, bool), AppError> {
    let msg_type = msg["type"].as_str().unwrap_or("");

    match msg_type {
        "PING" => Ok((json!({"status": "OK"}), false)),

        // ---- Cross-profile state sync ----

        "GET_STATE" => handle_get_state(),

        "START_SESSION" => handle_start_session(msg, blocked),

        "END_SESSION" => handle_end_session(msg, blocked),

        "SYNC_RULES" => handle_sync_rules(msg),

        "SYNC_SETTINGS" => handle_sync_settings(msg),

        // ---- Registry management (Windows) ----

        "REGISTER_EXTENSION" => handle_register_extension(msg),

        // ---- Legacy per-domain controls ----

        "BLOCK_DOMAIN" => {
            let domain = require_field(msg, "domain")?;

            let cfg = config::update(move |cfg| {
                if !cfg.blocked_domains.contains(&domain) {
                    cfg.blocked_domains.push(domain);
                }
            })?;

            let domains = collect_blocked_domains(&cfg);
            hosts_manager::apply(&domains)?;

            if let Ok(mut guard) = blocked.lock() {
                *guard = domains;
            }

            Ok((json!({"status": "OK"}), false))
        }

        "UNBLOCK_DOMAIN" => {
            let domain = require_field(msg, "domain")?;

            let cfg = config::update(move |cfg| {
                cfg.blocked_domains.retain(|d| *d != domain);
            })?;

            let domains = collect_blocked_domains(&cfg);
            hosts_manager::apply(&domains)?;

            if let Ok(mut guard) = blocked.lock() {
                *guard = domains;
            }

            Ok((json!({"status": "OK"}), false))
        }

        "QUIT" => {
            let pw = msg["password"].as_str().unwrap_or("");
            let cfg = config::load()?;

            if let Some(hash) = &cfg.password_hash {
                if !password::verify(pw, hash)? {
                    return Ok((
                        json!({"status": "ERROR", "message": "Invalid password"}),
                        false,
                    ));
                }
            }

            // Remove all hosts entries before shutting down.
            let _ = hosts_manager::apply(&[]);
            Ok((json!({"status": "OK"}), true))
        }

        _ => Ok((
            json!({"status": "ERROR", "message": format!("Unknown message type: {msg_type}")}),
            false,
        )),
    }
}

// =========================================================================
// GET_STATE — return full shared state for extension polling
// =========================================================================

fn handle_get_state() -> Result<(serde_json::Value, bool), AppError> {
    let cfg = config::load()?;

    let session = cfg.session.as_ref().map(|s| {
        json!({
            "active": s.active,
            "startTime": s.start_time,
            "endTime": s.end_time,
            "locked": s.locked,
            "scheduledId": s.scheduled_id,
        })
    });

    let youtube_rules = cfg.youtube_rules.as_ref().map(|r| {
        json!({
            "blockedChannels": r.blocked_channels,
            "allowedChannels": r.allowed_channels,
        })
    });

    let settings = cfg.global_settings.as_ref().map(|s| {
        json!({
            "strictMode": s.strict_mode,
            "blockYoutubeFallback": s.block_youtube_fallback,
            "sessionDurationMinutes": s.session_duration_minutes,
        })
    });

    Ok((
        json!({
            "status": "OK",
            "session": session,
            "youtubeRules": youtube_rules,
            "blockedDomains": cfg.blocked_domains,
            "settings": settings,
        }),
        false,
    ))
}

// =========================================================================
// START_SESSION — begin a global focus session
// =========================================================================

fn handle_start_session(
    msg: &serde_json::Value,
    blocked: &Arc<Mutex<Vec<String>>>,
) -> Result<(serde_json::Value, bool), AppError> {
    let duration_minutes = msg["durationMinutes"].as_u64().unwrap_or(30) as u32;
    let scheduled_id = msg["scheduledId"].as_str().map(|s| s.to_string());
    let locked = msg["locked"].as_bool().unwrap_or(false);

    let now = config::now_ms();
    let end_time = now + (duration_minutes as u64) * 60 * 1000;

    let cfg = config::update(|cfg| {
        cfg.session = Some(config::SessionState {
            active: true,
            start_time: Some(now),
            end_time: Some(end_time),
            locked,
            scheduled_id,
        });
    })?;

    // Apply hosts-level blocks (blocked_domains + youtube fallback)
    let domains = collect_blocked_domains(&cfg);
    if !domains.is_empty() {
        hosts_manager::apply(&domains)?;
        if let Ok(mut guard) = blocked.lock() {
            *guard = domains;
        }
    }

    let session = cfg.session.as_ref().unwrap();
    Ok((
        json!({
            "status": "OK",
            "session": {
                "active": session.active,
                "startTime": session.start_time,
                "endTime": session.end_time,
                "locked": session.locked,
                "scheduledId": session.scheduled_id,
            }
        }),
        false,
    ))
}

// =========================================================================
// END_SESSION — end the global focus session
// =========================================================================

fn handle_end_session(
    msg: &serde_json::Value,
    blocked: &Arc<Mutex<Vec<String>>>,
) -> Result<(serde_json::Value, bool), AppError> {
    let natural = msg["natural"].as_bool().unwrap_or(false);
    let parent_pin = msg["parentPin"].as_str().unwrap_or("");

    let cfg = config::load()?;

    // Check if session is locked and PIN is required
    if let Some(ref session) = cfg.session {
        if session.active && session.locked && !natural {
            // Need to verify parent PIN
            if parent_pin.is_empty() {
                return Ok((
                    json!({"status": "ERROR", "message": "Session is locked. PIN required."}),
                    false,
                ));
            }

            // Verify PIN against password_hash (using Argon2)
            if let Some(ref hash) = cfg.password_hash {
                if !password::verify(parent_pin, hash)? {
                    return Ok((
                        json!({"status": "ERROR", "message": "Invalid PIN."}),
                        false,
                    ));
                }
            }
        }
    }

    // End the session
    config::update(|cfg| {
        cfg.session = Some(config::SessionState {
            active: false,
            start_time: None,
            end_time: None,
            locked: false,
            scheduled_id: None,
        });
        cfg.blocked_domains.clear();
    })?;

    // Clean up hosts file
    hosts_manager::apply(&[])?;
    if let Ok(mut guard) = blocked.lock() {
        guard.clear();
    }

    Ok((json!({"status": "OK", "natural": natural}), false))
}

// =========================================================================
// SYNC_RULES — extension pushes block rules to shared config
// =========================================================================

fn handle_sync_rules(msg: &serde_json::Value) -> Result<(serde_json::Value, bool), AppError> {
    let youtube_rules = &msg["youtubeRules"];
    let blocked_sites = &msg["blockedSites"];

    config::update(|cfg| {
        if youtube_rules.is_object() {
            let blocked_channels = youtube_rules["blockedChannels"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let allowed_channels = youtube_rules["allowedChannels"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();

            cfg.youtube_rules = Some(config::YoutubeRules {
                blocked_channels,
                allowed_channels,
            });
        }

        if let Some(sites) = blocked_sites.as_array() {
            cfg.blocked_domains = sites
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
        }
    })?;

    Ok((json!({"status": "OK"}), false))
}

// =========================================================================
// SYNC_SETTINGS — extension pushes settings to shared config
// =========================================================================

fn handle_sync_settings(msg: &serde_json::Value) -> Result<(serde_json::Value, bool), AppError> {
    let settings = &msg["settings"];

    config::update(|cfg| {
        let mut gs = cfg.global_settings.clone().unwrap_or_default();

        if let Some(v) = settings["strictMode"].as_bool() {
            gs.strict_mode = v;
        }
        if let Some(v) = settings["blockYoutubeFallback"].as_bool() {
            gs.block_youtube_fallback = v;
        }
        if let Some(v) = settings["sessionDurationMinutes"].as_u64() {
            gs.session_duration_minutes = v as u32;
        }

        cfg.global_settings = Some(gs);
    })?;

    Ok((json!({"status": "OK"}), false))
}

// =========================================================================
// REGISTER_EXTENSION — write force-install policy + Edge native messaging
// =========================================================================

fn handle_register_extension(
    msg: &serde_json::Value,
) -> Result<(serde_json::Value, bool), AppError> {
    let extension_id = msg["extensionId"]
        .as_str()
        .unwrap_or("")
        .to_string();

    if extension_id.is_empty() {
        return Ok((
            json!({"status": "ERROR", "message": "Missing extensionId"}),
            false,
        ));
    }

    #[cfg(windows)]
    {
        let manifest_path = msg["manifestPath"].as_str().unwrap_or("").to_string();
        if let Err(e) = registry::register_extension(&extension_id, &manifest_path) {
            return Ok((
                json!({"status": "ERROR", "message": format!("Registry error: {e}")}),
                false,
            ));
        }
        Ok((json!({"status": "OK"}), false))
    }

    #[cfg(not(windows))]
    {
        Ok((
            json!({"status": "ERROR", "message": "REGISTER_EXTENSION is Windows-only"}),
            false,
        ))
    }
}

// =========================================================================
// Helpers
// =========================================================================

fn require_field(msg: &serde_json::Value, field: &str) -> Result<String, AppError> {
    msg[field]
        .as_str()
        .map(|s| s.to_lowercase())
        .ok_or_else(|| AppError::Messaging(format!("Missing '{field}' field")))
}
