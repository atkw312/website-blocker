//! Windows registry operations for cross-browser extension management.
//!
//! Writes:
//! - Chrome force-install policy (HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist)
//! - Edge force-install policy  (HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist)
//! - Edge native messaging host (HKCU\Software\Microsoft\Edge\NativeMessagingHosts\...)

use crate::AppError;
use winreg::enums::*;
use winreg::RegKey;

const NATIVE_HOST_NAME: &str = "com.focusblocker.native";

/// Register force-install policies for Chrome and Edge, plus Edge native messaging host.
pub fn register_extension(extension_id: &str, manifest_path: &str) -> Result<(), AppError> {
    register_force_install(
        r"SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist",
        extension_id,
    )?;

    register_force_install(
        r"SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist",
        extension_id,
    )?;

    if !manifest_path.is_empty() {
        register_edge_native_host(manifest_path)?;
    }

    Ok(())
}

/// Write an extension ID to a force-install policy registry key.
///
/// The key contains numbered string values ("1", "2", ...).
/// We find the next available slot or skip if already registered.
fn register_force_install(subkey: &str, extension_id: &str) -> Result<(), AppError> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    let (key, _) = hklm
        .create_subkey(subkey)
        .map_err(|e| AppError::Config(format!("Cannot create registry key {subkey}: {e}. Run as administrator.")))?;

    // The force-install value format: "<extension_id>;https://clients2.google.com/service/update2/crx"
    // For unpacked/local extensions, just the ID is enough to prevent removal.
    let entry_value = extension_id.to_string();

    // Check existing entries to avoid duplicates.
    let mut max_index: u32 = 0;
    for (name, _) in key.enum_values().filter_map(|r| r.ok()) {
        if let Ok(existing) = key.get_value::<String, _>(&name) {
            if existing == entry_value || existing.starts_with(&format!("{extension_id};")) {
                // Already registered
                return Ok(());
            }
        }
        if let Ok(idx) = name.parse::<u32>() {
            if idx >= max_index {
                max_index = idx + 1;
            }
        }
    }

    // Write the next numbered entry.
    key.set_value(max_index.to_string(), &entry_value)
        .map_err(|e| AppError::Config(format!("Cannot write force-install entry: {e}")))?;

    Ok(())
}

/// Register native messaging host manifest for Edge.
fn register_edge_native_host(manifest_path: &str) -> Result<(), AppError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let subkey = format!(
        r"Software\Microsoft\Edge\NativeMessagingHosts\{NATIVE_HOST_NAME}"
    );

    let (key, _) = hkcu
        .create_subkey(&subkey)
        .map_err(|e| AppError::Config(format!("Cannot create Edge NativeMessagingHosts key: {e}")))?;

    key.set_value("", &manifest_path)
        .map_err(|e| AppError::Config(format!("Cannot write Edge native host manifest path: {e}")))?;

    Ok(())
}
