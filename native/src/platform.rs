//! OS-specific paths and utilities.

use std::path::PathBuf;

/// Return the system hosts file path.
pub fn hosts_file_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        PathBuf::from(root).join(r"System32\drivers\etc\hosts")
    } else {
        PathBuf::from("/etc/hosts")
    }
}

/// Return the app's config directory.
///   macOS / Linux: ~/.focusblocker/
///   Windows:       %APPDATA%\FocusBlocker\
pub fn config_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        directories::BaseDirs::new()
            .map(|b| b.config_dir().join("FocusBlocker"))
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData\FocusBlocker"))
    } else {
        directories::BaseDirs::new()
            .map(|b| b.home_dir().join(".focusblocker"))
            .unwrap_or_else(|| PathBuf::from("/tmp/.focusblocker"))
    }
}

/// Flush the OS DNS cache so hosts-file changes take effect immediately.
pub fn flush_dns() {
    if cfg!(target_os = "windows") {
        let _ = std::process::Command::new("ipconfig")
            .arg("/flushdns")
            .output();
    } else if cfg!(target_os = "macos") {
        let _ = std::process::Command::new("dscacheutil")
            .arg("-flushcache")
            .output();
        let _ = std::process::Command::new("killall")
            .args(["-HUP", "mDNSResponder"])
            .output();
    }
}
