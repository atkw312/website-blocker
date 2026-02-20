//! Focus Blocker — Native enforcement agent.
//!
//! Runs as a Chrome Native Messaging host. Manages system-level domain blocking
//! via the hosts file. Protected by password to prevent unauthorized shutdown.
//!
//! Usage:
//!   focus-blocker-native          # Native messaging mode (launched by Chrome)
//!   focus-blocker-native setup    # Interactive first-time password setup
//!   focus-blocker-native restore  # Re-apply persisted blocks on boot
//!
//! # TODO — Installer integration
//!
//! The following steps must be handled by an installer or setup script:
//!
//! ## Native messaging host registration
//!   Write a JSON manifest and register it so Chrome can discover this binary:
//!   - macOS:   ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
//!   - Windows: HKCU\Software\Google\Chrome\NativeMessagingHosts\
//!
//! ## Windows admin privilege elevation
//!   The hosts file requires Administrator access. The installer should either:
//!   - Install a Windows Service that runs elevated, or
//!   - Embed a UAC manifest in the binary (mt.exe / embed-resource crate).
//!
//! ## macOS signing
//!   Sign the binary with a Developer ID certificate for Gatekeeper approval:
//!   - codesign --sign "Developer ID Application: ..." focus-blocker-native

mod config;
mod hosts_manager;
mod native_messaging;
mod password;
mod platform;
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
// Restore mode — re-apply persisted blocks on boot
// =========================================================================

fn run_restore() -> Result<(), AppError> {
    let cfg = config::load()?;

    if cfg.blocked_domains.is_empty() {
        eprintln!("[FocusBlocker] Restore: no persisted blocks, exiting.");
        return Ok(());
    }

    eprintln!(
        "[FocusBlocker] Restore: re-applying {} domain(s).",
        cfg.blocked_domains.len()
    );
    hosts_manager::apply(&cfg.blocked_domains)?;

    // Start watchdog to guard against tampering.
    let blocked = Arc::new(Mutex::new(cfg.blocked_domains));
    let _watchdog = watchdog::start(Arc::clone(&blocked));

    // Poll config file every 10s. When the native messaging instance clears
    // blocked_domains (session ended), clean up and exit.
    loop {
        thread::sleep(Duration::from_secs(10));

        let current = config::load()?;
        if current.blocked_domains.is_empty() {
            eprintln!("[FocusBlocker] Restore: domains cleared, cleaning up.");
            hosts_manager::apply(&[])?;
            break;
        }

        // Sync in-memory state so watchdog uses the latest list.
        if let Ok(mut guard) = blocked.lock() {
            *guard = current.blocked_domains;
        }
    }

    Ok(())
}

// =========================================================================
// Native messaging mode
// =========================================================================

fn run_native_messaging() -> Result<(), AppError> {
    let cfg = config::load()?;
    let password_hash = cfg.password_hash;
    let blocked = Arc::new(Mutex::new(cfg.blocked_domains));

    // Background thread: re-applies hosts entries if they're tampered with.
    let _watchdog = watchdog::start(Arc::clone(&blocked));

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    loop {
        match native_messaging::read_message(&mut reader) {
            Ok(msg) => {
                let (response, quit) = handle_message(&msg, &blocked, &password_hash)?;
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
    password_hash: &Option<String>,
) -> Result<(serde_json::Value, bool), AppError> {
    let msg_type = msg["type"].as_str().unwrap_or("");

    match msg_type {
        "PING" => Ok((json!({"status": "OK"}), false)),

        "BLOCK_DOMAIN" => {
            let domain = require_field(msg, "domain")?;

            // Update in-memory state (short lock), then do I/O after release.
            let domains = {
                let mut guard = blocked.lock().map_err(lock_err)?;
                if !guard.contains(&domain) {
                    guard.push(domain);
                }
                guard.clone()
            };

            hosts_manager::apply(&domains)?;
            persist(&domains, password_hash)?;
            Ok((json!({"status": "OK"}), false))
        }

        "UNBLOCK_DOMAIN" => {
            let domain = require_field(msg, "domain")?;

            let domains = {
                let mut guard = blocked.lock().map_err(lock_err)?;
                guard.retain(|d| d != &domain);
                guard.clone()
            };

            hosts_manager::apply(&domains)?;
            persist(&domains, password_hash)?;
            Ok((json!({"status": "OK"}), false))
        }

        "QUIT" => {
            let pw = msg["password"].as_str().unwrap_or("");

            if let Some(hash) = password_hash {
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
// Helpers
// =========================================================================

fn require_field(msg: &serde_json::Value, field: &str) -> Result<String, AppError> {
    msg[field]
        .as_str()
        .map(|s| s.to_lowercase())
        .ok_or_else(|| AppError::Messaging(format!("Missing '{field}' field")))
}

fn lock_err<T>(e: std::sync::PoisonError<T>) -> AppError {
    AppError::Config(format!("Lock poisoned: {e}"))
}

fn persist(domains: &[String], password_hash: &Option<String>) -> Result<(), AppError> {
    config::save(&config::Config {
        password_hash: password_hash.clone(),
        blocked_domains: domains.to_vec(),
    })
}
