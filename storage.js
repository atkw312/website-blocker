/**
 * storage.js — Chrome storage abstraction for Sumi (v3 freemium).
 *
 * Flat keys in chrome.storage.local. Shared by background, content, and popup.
 *
 * Pro schema extensions (not yet implemented):
 *   schedules: []            — array of { days, startTime, endTime, duration }
 *   schedulesEnabled: false  — master toggle for scheduled auto-start
 */

const DEFAULTS = {
  intentModeEnabled: false,
  sessionEndTime: null,
  sessionPausedRemaining: null,
  sessionDurationMinutes: 25,
  dailySessionCount: 0,
  lastSessionDate: null,
  isProUser: false
};

const FREE_DAILY_LIMIT = 2;

/** Seed storage with defaults for any missing keys. */
async function initializeStorage() {
  const data = await chrome.storage.local.get(null);
  const patch = {};
  for (const [key, val] of Object.entries(DEFAULTS)) {
    if (data[key] === undefined) patch[key] = val;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}

/** Returns "YYYY-MM-DD" in local timezone. */
function todayDateString() {
  return new Date().toLocaleDateString("sv");
}

/**
 * Check daily limit and reset counter if the date has changed.
 * Returns { allowed: bool, used: number, limit: number }.
 */
async function checkDailyLimit() {
  const data = await chrome.storage.local.get([
    "dailySessionCount", "lastSessionDate", "isProUser"
  ]);

  const today = todayDateString();
  let count = data.dailySessionCount ?? 0;

  // Reset if date changed
  if (data.lastSessionDate !== today) {
    count = 0;
    await chrome.storage.local.set({ dailySessionCount: 0, lastSessionDate: today });
  }

  if (data.isProUser) {
    return { allowed: true, used: count, limit: Infinity };
  }
  return { allowed: count < FREE_DAILY_LIMIT, used: count, limit: FREE_DAILY_LIMIT };
}

/** Increment daily session count (call when a session starts). */
async function incrementDailyCount() {
  const today = todayDateString();
  const data = await chrome.storage.local.get(["dailySessionCount", "lastSessionDate"]);
  let count = data.dailySessionCount ?? 0;
  if (data.lastSessionDate !== today) count = 0;
  count += 1;
  await chrome.storage.local.set({ dailySessionCount: count, lastSessionDate: today });
}

/**
 * Compute remaining ms for the active session.
 * Returns null if no session is running/paused.
 */
async function getRemainingMs() {
  const data = await chrome.storage.local.get([
    "intentModeEnabled", "sessionEndTime", "sessionPausedRemaining"
  ]);
  if (!data.intentModeEnabled) return null;
  if (data.sessionPausedRemaining != null) return data.sessionPausedRemaining;
  if (data.sessionEndTime != null) return Math.max(0, data.sessionEndTime - Date.now());
  return null;
}
