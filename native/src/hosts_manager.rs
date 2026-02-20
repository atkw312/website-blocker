//! Safe hosts-file manipulation with marker-delimited blocks.
//!
//! All entries managed by this app live between two marker comments.
//! The rest of the file is never touched.

use crate::platform;
use crate::AppError;
use std::fs;

const MARKER_START: &str = "# FocusBlocker Start";
const MARKER_END: &str = "# FocusBlocker End";

/// Build the marker-delimited block for the given domains.
fn build_block(domains: &[String]) -> String {
    if domains.is_empty() {
        return String::new();
    }

    let mut block = format!("{MARKER_START}\n");
    for domain in domains {
        block.push_str(&format!("127.0.0.1 {domain}\n"));
        // Automatically cover the www subdomain unless the entry already is www.
        if !domain.starts_with("www.") {
            block.push_str(&format!("127.0.0.1 www.{domain}\n"));
        }
    }
    block.push_str(MARKER_END);
    block
}

/// Remove every line between (and including) the FocusBlocker markers.
fn strip_block(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut inside = false;

    for line in content.lines() {
        if line.trim() == MARKER_START {
            inside = true;
            continue;
        }
        if line.trim() == MARKER_END {
            inside = false;
            continue;
        }
        if !inside {
            out.push_str(line);
            out.push('\n');
        }
    }

    out
}

/// Write the canonical block for `domains` into the hosts file,
/// replacing any existing FocusBlocker section. All other entries are preserved.
pub fn apply(domains: &[String]) -> Result<(), AppError> {
    let path = platform::hosts_file_path();

    let content = fs::read_to_string(&path).map_err(|e| {
        AppError::Hosts(format!("Cannot read {}: {e}", path.display()))
    })?;

    let mut cleaned = strip_block(&content);

    // Ensure a trailing newline before appending our block.
    if !cleaned.ends_with('\n') {
        cleaned.push('\n');
    }

    let block = build_block(domains);
    let new_content = if block.is_empty() {
        cleaned
    } else {
        format!("{cleaned}{block}\n")
    };

    fs::write(&path, new_content).map_err(|e| {
        AppError::Hosts(format!(
            "Cannot write {}: {e} (running as admin/root?)",
            path.display()
        ))
    })?;

    platform::flush_dns();
    Ok(())
}

/// Verify that every expected domain is present in the hosts file.
/// If anything is missing (e.g. user or another tool removed entries),
/// rewrite the entire block.
pub fn ensure_integrity(domains: &[String]) -> Result<(), AppError> {
    if domains.is_empty() {
        return Ok(());
    }

    let path = platform::hosts_file_path();
    let content = fs::read_to_string(&path).map_err(|e| {
        AppError::Hosts(format!("Cannot read {}: {e}", path.display()))
    })?;

    // Quick check: markers must exist and every domain must appear.
    let intact = content.contains(MARKER_START)
        && content.contains(MARKER_END)
        && domains
            .iter()
            .all(|d| content.contains(&format!("127.0.0.1 {d}")));

    if !intact {
        apply(domains)?;
    }

    Ok(())
}
