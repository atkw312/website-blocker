/**
 * background.js — Service worker (Manifest V3).
 *
 * Responsibilities:
 *   1. Seed storage on first install.
 *   2. Manage native messaging connection to focus-blocker-native.
 *   3. Sync blocked domains to the native app when sessions start/stop.
 *   4. Keep the service worker alive during active sessions (MV3 alarms).
 */

importScripts("storage.js", "rules.js");

const NATIVE_HOST = "com.focusblocker.native";
const LOG_PREFIX = "[FocusBlocker]";
const KEEPALIVE_ALARM = "focusblocker-keepalive";

let nativePort = null;

// =========================================================================
// Lifecycle
// =========================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
    await initializeStorage();
    console.log(LOG_PREFIX, "Storage initialized on", details.reason);
  }
});

// =========================================================================
// Native messaging — connection management
// =========================================================================

function connectNative() {
  if (nativePort) return;

  nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  console.log(LOG_PREFIX, "Connected to native app.");

  nativePort.onMessage.addListener((msg) => {
    console.log(LOG_PREFIX, "Native:", JSON.stringify(msg));
  });

  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message;
    console.warn(LOG_PREFIX, "Native port disconnected.", err ?? "");
    nativePort = null;
  });
}

function disconnectNative() {
  if (!nativePort) return;
  try {
    nativePort.disconnect();
  } catch (_) {
    // port may already be dead
  }
  nativePort = null;
  console.log(LOG_PREFIX, "Disconnected from native app.");
}

function sendToNative(msg) {
  if (!nativePort) {
    console.warn(LOG_PREFIX, "sendToNative: no active port.");
    return;
  }
  try {
    nativePort.postMessage(msg);
  } catch (e) {
    console.error(LOG_PREFIX, "sendToNative error:", e);
    nativePort = null;
  }
}

// =========================================================================
// Domain sync helpers
// =========================================================================

function blockDomain(domain) {
  sendToNative({ type: "BLOCK_DOMAIN", domain });
}

function unblockDomain(domain) {
  sendToNative({ type: "UNBLOCK_DOMAIN", domain });
}

async function syncAllDomains() {
  const rules = await getBlockRules();
  const sites = rules.blockedSites ?? [];
  for (const domain of sites) {
    blockDomain(domain);
  }
}

async function unblockAllDomains() {
  const rules = await getBlockRules();
  const sites = rules.blockedSites ?? [];
  for (const domain of sites) {
    unblockDomain(domain);
  }
}

// =========================================================================
// Session state change handler
// =========================================================================

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  // --- Focus session toggled ---
  if (changes.focusSession) {
    const oldActive = changes.focusSession.oldValue?.active ?? false;
    const newActive = changes.focusSession.newValue?.active ?? false;

    if (!oldActive && newActive) {
      // Session started
      const { strictMode } = await getSettings();
      if (strictMode) {
        connectNative();
        await syncAllDomains();
      }
      chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
      console.log(LOG_PREFIX, "Session started.", strictMode ? "Strict mode — domains synced." : "Precision mode only.");
    } else if (oldActive && !newActive) {
      // Session ended
      if (nativePort) {
        await unblockAllDomains();
        disconnectNative();
      }
      chrome.alarms.clear(KEEPALIVE_ALARM);
      console.log(LOG_PREFIX, "Session ended — keepalive cleared.");
    }
  }

  // --- Block rules changed during active session ---
  if (changes.blockRules) {
    const session = await getActiveSession();
    if (!session.active || !nativePort) return;

    const oldSites = new Set(changes.blockRules.oldValue?.blockedSites ?? []);
    const newSites = new Set(changes.blockRules.newValue?.blockedSites ?? []);

    // Domains added
    for (const domain of newSites) {
      if (!oldSites.has(domain)) blockDomain(domain);
    }
    // Domains removed
    for (const domain of oldSites) {
      if (!newSites.has(domain)) unblockDomain(domain);
    }
  }

  // --- strictMode toggled mid-session ---
  if (changes.settings) {
    const oldStrict = changes.settings.oldValue?.strictMode ?? false;
    const newStrict = changes.settings.newValue?.strictMode ?? false;
    if (oldStrict === newStrict) return;

    const active = await isSessionActive();
    if (!active) return;

    if (newStrict) {
      // Strict mode turned ON during active session — connect + sync
      console.log(LOG_PREFIX, "Strict mode enabled mid-session — connecting native.");
      connectNative();
      await syncAllDomains();
    } else {
      // Strict mode turned OFF during active session — unblock + disconnect
      console.log(LOG_PREFIX, "Strict mode disabled mid-session — disconnecting native.");
      if (nativePort) {
        await unblockAllDomains();
        disconnectNative();
      }
    }
  }
});

// =========================================================================
// Service worker resilience (MV3 alarms keepalive)
// =========================================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;

  const active = await isSessionActive();
  if (!active) {
    // Session expired naturally — clean up
    if (nativePort) {
      await unblockAllDomains();
      disconnectNative();
    }
    chrome.alarms.clear(KEEPALIVE_ALARM);
    return;
  }

  const { strictMode } = await getSettings();
  if (!strictMode) return;

  if (!nativePort) {
    // Port died — reconnect and resync
    console.log(LOG_PREFIX, "Keepalive: reconnecting...");
    connectNative();
    await syncAllDomains();
  } else {
    // Port alive — heartbeat
    sendToNative({ type: "PING" });
  }
});

// =========================================================================
// Startup recovery — reconnect if session was active before SW restart
// =========================================================================

(async () => {
  const active = await isSessionActive();
  if (!active) return;

  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });

  const { strictMode } = await getSettings();
  if (strictMode) {
    console.log(LOG_PREFIX, "Startup: active session + strict mode, reconnecting...");
    connectNative();
    await syncAllDomains();
  } else {
    console.log(LOG_PREFIX, "Startup: active session, precision mode only.");
  }
})();
