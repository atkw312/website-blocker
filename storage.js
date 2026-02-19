/**
 * storage.js — Chrome storage abstraction layer.
 *
 * All persistent state lives in chrome.storage.local under three top-level
 * keys: blockRules, focusSession, and settings.  Every public function
 * returns a Promise so callers can await it.
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
    active: false,
    startTime: null,
    endTime: null,
    locked: false
  },
  settings: {
    strictMode: false,
    requireParentUnlock: false
  }
};

/**
 * Seed storage with defaults if no data exists yet.
 * Called once on extension install.
 */
async function initializeStorage() {
  const data = await chrome.storage.local.get(null);
  const merged = { ...DEFAULT_STORAGE };

  // Preserve any keys that already exist so we never blow away user data.
  for (const key of Object.keys(DEFAULT_STORAGE)) {
    if (data[key] !== undefined) {
      merged[key] = data[key];
    }
  }

  await chrome.storage.local.set(merged);
  return merged;
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
async function getFocusSession() {
  const { focusSession } = await chrome.storage.local.get("focusSession");
  return focusSession ?? DEFAULT_STORAGE.focusSession;
}

/**
 * Begin a new focus session lasting `durationMinutes` from now.
 * Automatically sets active = true and computes endTime.
 */
async function startFocusSession(durationMinutes) {
  const now = Date.now();
  const session = {
    active: true,
    startTime: now,
    endTime: now + durationMinutes * 60 * 1000,
    locked: false
  };
  await chrome.storage.local.set({ focusSession: session });
  return session;
}

/** Immediately end the current focus session. */
async function endFocusSession() {
  const session = {
    active: false,
    startTime: null,
    endTime: null,
    locked: false
  };
  await chrome.storage.local.set({ focusSession: session });
  return session;
}

/**
 * Check whether a focus session is currently running.
 * Automatically expires sessions whose endTime has passed.
 */
async function isFocusActive() {
  const session = await getFocusSession();

  if (!session.active) return false;

  // Auto-expire elapsed sessions.
  if (session.endTime && Date.now() >= session.endTime) {
    await endFocusSession();
    return false;
  }

  return true;
}
