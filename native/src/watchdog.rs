//! Background watchdog thread.
//!
//! Periodically verifies that the hosts-file entries haven't been removed
//! or tampered with. Reapplies them if anything is missing.

use crate::hosts_manager;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const CHECK_INTERVAL: Duration = Duration::from_secs(10);

/// Spawn a background thread that calls `ensure_hosts_integrity` on a loop.
pub fn start(blocked_domains: Arc<Mutex<Vec<String>>>) -> thread::JoinHandle<()> {
    thread::spawn(move || loop {
        thread::sleep(CHECK_INTERVAL);

        let domains = match blocked_domains.lock() {
            Ok(guard) => guard.clone(),
            Err(e) => {
                eprintln!("[Watchdog] Lock poisoned: {e}");
                continue;
            }
        };

        if domains.is_empty() {
            continue;
        }

        if let Err(e) = hosts_manager::ensure_integrity(&domains) {
            eprintln!("[Watchdog] Integrity check failed: {e}");
        }
    })
}
