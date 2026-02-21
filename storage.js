/**
 * storage.js — Chrome storage abstraction layer.
 *
 * All persistent state lives in chrome.storage.local.
 * Schema is preserved for forward-compatibility with the native desktop app.
 *
 * Mode-based state machine (v2):
 *   focusSession.mode: "off" | "precision" | "strict"
 *   settings.defaultMode: "precision" | "strict"
 */

const DEFAULT_STORAGE = {
  blockRules: {
    youtube: {
      blockedChannels: [],
      allowedChannels: []
    },
    reddit: {
      blockedSubreddits: [],
      allowedSubreddits: []
    },
    blockedSites: []
  },
  focusSession: {
    mode: "off",
    startTime: null,
    endTime: null,
    locked: false,
    scheduledId: null
  },
  settings: {
    defaultMode: "precision",
    blockAllChannels: false,
    requireParentUnlock: false,
    parentPinHash: null,
    sessionDurationMinutes: 30
  },
  schedules: [],
  // { id, label, days: [0-6], startHour, startMinute, endHour, endMinute, enabled }
  sessionHistory: [],
  // { startTime, endTime, durationMinutes, actualMinutes, completedNaturally, scheduledId }
  stats: {
    totalSessions: 0,
    totalFocusMinutes: 0,
    currentStreak: 0,
    lastSessionDate: null   // "YYYY-MM-DD" local date
  }
};

/**
 * Seed storage with defaults if no data exists yet.
 * Called once on extension install/update.
 * Also runs v2 migration for existing installs.
 */
async function initializeStorage() {
  const data = await chrome.storage.local.get(null);
  const merged = {};

  for (const key of Object.keys(DEFAULT_STORAGE)) {
    if (data[key] !== undefined && typeof DEFAULT_STORAGE[key] === "object" && !Array.isArray(DEFAULT_STORAGE[key])) {
      merged[key] = { ...DEFAULT_STORAGE[key], ...data[key] };
    } else {
      merged[key] = data[key] !== undefined ? data[key] : DEFAULT_STORAGE[key];
    }
  }

  await chrome.storage.local.set(merged);

  // Run v2 migration after merging defaults
  await migrateStorageV2();

  return merged;
}

/**
 * Migrate from boolean-based schema (v1) to mode-based schema (v2).
 *
 * Old → New:
 *   focusSession.active (bool)       → focusSession.mode ("off"|"precision"|"strict")
 *   settings.strictMode (bool)       → settings.defaultMode ("precision"|"strict")
 *   settings.blockAllYouTube (bool)   → settings.blockAllChannels (bool)
 *   settings.blockYoutubeFallback     → REMOVED
 */
async function migrateStorageV2() {
  const data = await chrome.storage.local.get(["focusSession", "settings"]);
  const session = data.focusSession ?? {};
  const settings = data.settings ?? {};

  // Already migrated if mode field exists
  if (session.mode !== undefined) return;

  const updates = {};

  // Migrate focusSession
  const wasActive = session.active ?? false;
  const wasStrict = settings.strictMode ?? false;
  let mode = "off";
  if (wasActive && wasStrict) mode = "strict";
  else if (wasActive) mode = "precision";

  updates.focusSession = {
    mode,
    startTime: session.startTime ?? null,
    endTime: session.endTime ?? null,
    locked: session.locked ?? false,
    scheduledId: session.scheduledId ?? null
  };

  // Migrate settings
  updates.settings = {
    defaultMode: wasStrict ? "strict" : "precision",
    blockAllChannels: settings.blockAllYouTube ?? false,
    requireParentUnlock: settings.requireParentUnlock ?? false,
    parentPinHash: settings.parentPinHash ?? null,
    sessionDurationMinutes: settings.sessionDurationMinutes ?? 30
  };

  await chrome.storage.local.set(updates);
}

/** Return the current settings object. */
async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return settings ?? DEFAULT_STORAGE.settings;
}

/** Overwrite the entire settings object. */
async function setSettings(settings) {
  await chrome.storage.local.set({ settings });
}

/** Hash a PIN string using SHA-256 via Web Crypto, returns hex string. */
async function hashPin(pin) {
  const encoded = new TextEncoder().encode(pin);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Verify a PIN against a stored SHA-256 hex hash. */
async function verifyPin(pin, storedHash) {
  const hash = await hashPin(pin);
  return hash === storedHash;
}

/** Return the current blockRules object. */
async function getBlockRules() {
  const { blockRules } = await chrome.storage.local.get("blockRules");
  return blockRules ?? DEFAULT_STORAGE.blockRules;
}

/** Overwrite the entire blockRules object. */
async function setBlockRules(rules) {
  await chrome.storage.local.set({ blockRules: rules });
}

/** Return the current focusSession object. */
async function getActiveSession() {
  const { focusSession } = await chrome.storage.local.get("focusSession");
  return focusSession ?? DEFAULT_STORAGE.focusSession;
}

/**
 * Check whether a focus session is currently running.
 * Returns true if mode is "precision" or "strict" and not expired.
 *
 * Expiry detection triggers transitionMode via background message.
 */
async function isSessionActive() {
  const session = await getActiveSession();
  if (!session.mode || session.mode === "off") return false;

  if (session.endTime && Date.now() >= session.endTime) {
    // Route through background to handle proper transition
    if (typeof chrome.runtime.sendMessage === "function") {
      try {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: "endSession", natural: true },
            (response) => resolve(response)
          );
        });
      } catch (_) { /* background may not be ready */ }
    }
    return false;
  }

  return true;
}

/**
 * Start a focus session by routing through the background service worker.
 */
async function startFocusSession(durationMinutes, { scheduledId } = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "startSession", durationMinutes, scheduledId: scheduledId ?? null },
      (response) => resolve(response)
    );
  });
}

/**
 * End the current focus session by routing through the background service worker.
 */
async function endFocusSession({ parentApproved = false, parentPin = "", natural = false } = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "endSession", parentApproved, parentPin, natural },
      (response) => resolve(response)
    );
  });
}

/**
 * Switch mode mid-session (precision ↔ strict).
 */
async function switchMode(targetMode) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "switchMode", targetMode },
      (response) => resolve(response)
    );
  });
}

// =========================================================================
// Schedules CRUD
// =========================================================================

async function getSchedules() {
  const { schedules } = await chrome.storage.local.get("schedules");
  return schedules ?? DEFAULT_STORAGE.schedules;
}

async function setSchedules(schedules) {
  await chrome.storage.local.set({ schedules });
}

async function addSchedule(schedule) {
  const schedules = await getSchedules();
  schedules.push(schedule);
  await setSchedules(schedules);
}

async function removeSchedule(id) {
  const schedules = await getSchedules();
  await setSchedules(schedules.filter(s => s.id !== id));
}

async function updateSchedule(id, updates) {
  const schedules = await getSchedules();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx !== -1) {
    schedules[idx] = { ...schedules[idx], ...updates };
    await setSchedules(schedules);
  }
}

// =========================================================================
// Session history
// =========================================================================

const MAX_HISTORY_ENTRIES = 200;

async function getSessionHistory() {
  const { sessionHistory } = await chrome.storage.local.get("sessionHistory");
  return sessionHistory ?? DEFAULT_STORAGE.sessionHistory;
}

async function recordSession(record) {
  const history = await getSessionHistory();
  history.push(record);
  while (history.length > MAX_HISTORY_ENTRIES) {
    history.shift();
  }
  await chrome.storage.local.set({ sessionHistory: history });
}

// =========================================================================
// Stats
// =========================================================================

async function getStats() {
  const { stats } = await chrome.storage.local.get("stats");
  return stats ?? DEFAULT_STORAGE.stats;
}

/** Returns "YYYY-MM-DD" in local timezone. */
function getLocalDateString(date) {
  return date.toLocaleDateString("sv");
}

async function updateStatsAfterSession(actualMinutes) {
  const stats = await getStats();
  stats.totalSessions += 1;
  stats.totalFocusMinutes += actualMinutes;

  const today = getLocalDateString(new Date());
  if (stats.lastSessionDate === today) {
    // Already logged a session today — streak unchanged
  } else {
    const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
    if (stats.lastSessionDate === yesterday) {
      stats.currentStreak += 1;
    } else {
      stats.currentStreak = 1;
    }
    stats.lastSessionDate = today;
  }

  await chrome.storage.local.set({ stats });
}
