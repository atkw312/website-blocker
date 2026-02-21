/**
 * options.js — Drives the full options/settings page.
 *
 * Manages block list CRUD, default mode selection, session duration,
 * and parental PIN controls.
 */

// =========================================================================
// Reusable list CRUD helper
// =========================================================================

/**
 * Wire up a list section: text input + add button + <ul> with remove buttons.
 *
 * @param {object} opts
 * @param {string} opts.inputId    - ID of the text input element
 * @param {string} opts.btnId      - ID of the add button element
 * @param {string} opts.listId     - ID of the <ul> element
 * @param {string} opts.emptyText  - Placeholder when list is empty
 * @param {function} opts.getItems - async () => string[]  — current items from storage
 * @param {function} opts.setItems - async (string[]) => void — persist updated items
 * @param {function} [opts.sanitize] - (string) => string — normalize input before adding
 */
function setupList({ inputId, btnId, listId, emptyText, getItems, setItems, sanitize }) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  const ul = document.getElementById(listId);

  async function render() {
    const items = await getItems();
    ul.innerHTML = "";
    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = emptyText;
      ul.appendChild(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        const current = await getItems();
        await setItems(current.filter(i => i !== item));
        render();
      });
      li.appendChild(removeBtn);
      ul.appendChild(li);
    }
  }

  async function addItem() {
    let value = input.value.trim();
    if (!value) return;
    if (sanitize) value = sanitize(value);
    if (!value) return;

    const current = await getItems();
    if (current.some(i => i.toLowerCase() === value.toLowerCase())) {
      input.value = "";
      return; // duplicate
    }
    current.push(value);
    await setItems(current);
    input.value = "";
    render();
  }

  btn.addEventListener("click", addItem);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addItem();
  });

  render();
}

// =========================================================================
// Storage helpers for each list
// =========================================================================

async function getBlockedChannels() {
  const rules = await getBlockRules();
  return rules.youtube.blockedChannels;
}

async function setBlockedChannels(items) {
  const rules = await getBlockRules();
  rules.youtube.blockedChannels = items;
  await setBlockRules(rules);
}

async function getAllowedChannels() {
  const rules = await getBlockRules();
  return rules.youtube.allowedChannels;
}

async function setAllowedChannels(items) {
  const rules = await getBlockRules();
  rules.youtube.allowedChannels = items;
  await setBlockRules(rules);
}

async function getBlockedSites() {
  const rules = await getBlockRules();
  return rules.blockedSites;
}

async function setBlockedSites(items) {
  const rules = await getBlockRules();
  rules.blockedSites = items;
  await setBlockRules(rules);
}

// =========================================================================
// Sanitizers
// =========================================================================

function sanitizeChannel(value) {
  return value.replace(/^@/, "");
}

function sanitizeDomain(value) {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

// =========================================================================
// Default mode radio
// =========================================================================

const radioPrecision = document.getElementById("radio-precision");
const radioStrict = document.getElementById("radio-strict");

(async () => {
  const settings = await getSettings();
  if (settings.defaultMode === "strict") {
    radioStrict.checked = true;
  } else {
    radioPrecision.checked = true;
  }
})();

radioPrecision.addEventListener("change", async () => {
  if (radioPrecision.checked) {
    const settings = await getSettings();
    settings.defaultMode = "precision";
    await setSettings(settings);
  }
});

radioStrict.addEventListener("change", async () => {
  if (radioStrict.checked) {
    const settings = await getSettings();
    settings.defaultMode = "strict";
    await setSettings(settings);
  }
});

// =========================================================================
// Block all channels toggle
// =========================================================================

const chkBlockAllChannels = document.getElementById("chk-block-all-channels");

(async () => {
  const settings = await getSettings();
  chkBlockAllChannels.checked = settings.blockAllChannels ?? false;
})();

chkBlockAllChannels.addEventListener("change", async () => {
  const settings = await getSettings();
  settings.blockAllChannels = chkBlockAllChannels.checked;
  await setSettings(settings);
});

// =========================================================================
// Initialize lists
// =========================================================================

setupList({
  inputId: "input-blocked-channels",
  btnId: "btn-add-blocked-channels",
  listId: "list-blocked-channels",
  emptyText: "No blocked channels yet.",
  getItems: getBlockedChannels,
  setItems: setBlockedChannels,
  sanitize: sanitizeChannel
});

setupList({
  inputId: "input-allowed-channels",
  btnId: "btn-add-allowed-channels",
  listId: "list-allowed-channels",
  emptyText: "No allowed channels yet.",
  getItems: getAllowedChannels,
  setItems: setAllowedChannels,
  sanitize: sanitizeChannel
});

setupList({
  inputId: "input-blocked-sites",
  btnId: "btn-add-blocked-sites",
  listId: "list-blocked-sites",
  emptyText: "No blocked sites yet.",
  getItems: getBlockedSites,
  setItems: setBlockedSites,
  sanitize: sanitizeDomain
});

// =========================================================================
// Session duration
// =========================================================================

const inputDuration = document.getElementById("input-duration");

(async () => {
  const settings = await getSettings();
  inputDuration.value = settings.sessionDurationMinutes;
})();

inputDuration.addEventListener("change", async () => {
  let val = parseInt(inputDuration.value, 10);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 480) val = 480;
  inputDuration.value = val;

  const settings = await getSettings();
  settings.sessionDurationMinutes = val;
  await setSettings(settings);
});

// =========================================================================
// Parental controls
// =========================================================================

const chkRequirePin = document.getElementById("chk-require-pin");
const btnSetPin = document.getElementById("btn-set-pin");
const btnRemovePin = document.getElementById("btn-remove-pin");
const sectionParental = document.getElementById("section-parental");
const sessionWarning = document.getElementById("session-warning");

async function renderParental() {
  const settings = await getSettings();
  const active = await isSessionActive();

  // Show warning and disable section during active sessions
  if (active) {
    sessionWarning.style.display = "block";
    btnSetPin.disabled = true;
    btnRemovePin.disabled = true;
    chkRequirePin.disabled = true;
  } else {
    sessionWarning.style.display = "none";
    const hasPin = !!settings.parentPinHash;
    btnSetPin.disabled = false;
    btnRemovePin.disabled = !hasPin;
    chkRequirePin.disabled = !hasPin;
  }

  chkRequirePin.checked = settings.requireParentUnlock;
}

btnSetPin.addEventListener("click", async () => {
  const pin = prompt("Enter a 4–8 digit PIN:");
  if (pin === null) return;
  if (!/^\d{4,8}$/.test(pin)) {
    alert("PIN must be 4–8 digits.");
    return;
  }
  const confirm = prompt("Confirm your PIN:");
  if (confirm !== pin) {
    alert("PINs do not match.");
    return;
  }

  const settings = await getSettings();
  settings.parentPinHash = await hashPin(pin);
  await setSettings(settings);
  renderParental();
});

btnRemovePin.addEventListener("click", async () => {
  const settings = await getSettings();
  const pin = prompt("Enter your current PIN to remove it:");
  if (pin === null) return;

  const valid = await verifyPin(pin, settings.parentPinHash);
  if (!valid) {
    alert("Incorrect PIN.");
    return;
  }

  settings.parentPinHash = null;
  settings.requireParentUnlock = false;
  await setSettings(settings);
  renderParental();
});

chkRequirePin.addEventListener("change", async () => {
  const settings = await getSettings();
  settings.requireParentUnlock = chkRequirePin.checked;
  await setSettings(settings);
});

renderParental();

// =========================================================================
// Session Schedules
// =========================================================================

const inputScheduleLabel = document.getElementById("input-schedule-label");
const inputScheduleStart = document.getElementById("input-schedule-start");
const inputScheduleEnd = document.getElementById("input-schedule-end");
const btnAddSchedule = document.getElementById("btn-add-schedule");
const listSchedules = document.getElementById("list-schedules");
const dayCheckboxes = document.querySelectorAll(".day-checkboxes input[type='checkbox']");

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function renderSchedules() {
  const schedules = await getSchedules();
  listSchedules.innerHTML = "";

  if (schedules.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No schedules yet.";
    listSchedules.appendChild(li);
    return;
  }

  for (const s of schedules) {
    const li = document.createElement("li");
    const days = s.days.map(d => DAY_NAMES[d]).join(", ");
    const start = String(s.startHour).padStart(2, "0") + ":" + String(s.startMinute).padStart(2, "0");
    const end = String(s.endHour).padStart(2, "0") + ":" + String(s.endMinute).padStart(2, "0");
    li.textContent = `${s.label} — ${days} ${start}–${end}`;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "toggle-btn" + (s.enabled ? "" : " disabled");
    toggleBtn.textContent = s.enabled ? "Enabled" : "Disabled";
    toggleBtn.addEventListener("click", async () => {
      await updateSchedule(s.id, { enabled: !s.enabled });
      renderSchedules();
    });

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      await removeSchedule(s.id);
      renderSchedules();
    });

    const btnGroup = document.createElement("span");
    btnGroup.appendChild(toggleBtn);
    btnGroup.appendChild(removeBtn);
    li.appendChild(btnGroup);
    listSchedules.appendChild(li);
  }
}

btnAddSchedule.addEventListener("click", async () => {
  const label = inputScheduleLabel.value.trim();
  if (!label) { alert("Enter a schedule label."); return; }

  const days = Array.from(dayCheckboxes)
    .filter(cb => cb.checked)
    .map(cb => parseInt(cb.value, 10));
  if (days.length === 0) { alert("Select at least one day."); return; }

  const [startH, startM] = inputScheduleStart.value.split(":").map(Number);
  const [endH, endM] = inputScheduleEnd.value.split(":").map(Number);
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;
  if (endTotal <= startTotal) { alert("End time must be after start time."); return; }

  await addSchedule({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label,
    days,
    startHour: startH,
    startMinute: startM,
    endHour: endH,
    endMinute: endM,
    enabled: true
  });

  inputScheduleLabel.value = "";
  dayCheckboxes.forEach(cb => cb.checked = false);
  renderSchedules();
});

renderSchedules();

// =========================================================================
// Focus Stats
// =========================================================================

const statSessions = document.getElementById("stat-sessions");
const statTime = document.getElementById("stat-time");
const statStreak = document.getElementById("stat-streak");

async function renderStats() {
  const stats = await getStats();
  statSessions.textContent = stats.totalSessions;
  const hours = Math.floor(stats.totalFocusMinutes / 60);
  const mins = stats.totalFocusMinutes % 60;
  statTime.textContent = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  statStreak.textContent = stats.currentStreak;
}

renderStats();

// =========================================================================
// Session History
// =========================================================================

const listHistory = document.getElementById("list-history");

async function renderHistory() {
  const history = await getSessionHistory();
  listHistory.innerHTML = "";

  if (history.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No session history yet.";
    listHistory.appendChild(li);
    return;
  }

  const recent = history.slice(-50).reverse();
  for (const entry of recent) {
    const li = document.createElement("li");
    const date = new Date(entry.startTime);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    li.textContent = `${dateStr} ${timeStr} — ${entry.actualMinutes} min`;

    const badge = document.createElement("span");
    badge.className = "badge " + (entry.completedNaturally ? "completed" : "early");
    badge.textContent = entry.completedNaturally ? "Completed" : "Ended early";
    li.appendChild(badge);
    listHistory.appendChild(li);
  }
}

renderHistory();

// =========================================================================
// Import / Export
// =========================================================================

const btnExport = document.getElementById("btn-export");
const btnImport = document.getElementById("btn-import");
const fileImport = document.getElementById("file-import");

btnExport.addEventListener("click", async () => {
  const rules = await getBlockRules();
  const blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "focus-blocker-rules.json";
  a.click();
  URL.revokeObjectURL(url);
});

btnImport.addEventListener("click", () => {
  fileImport.click();
});

fileImport.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const text = await file.text();
  let imported;
  try {
    imported = JSON.parse(text);
  } catch {
    alert("Invalid JSON file.");
    return;
  }

  if (!imported || typeof imported !== "object") {
    alert("Invalid block rules format.");
    return;
  }

  const current = await getBlockRules();

  // Merge arrays using Set dedup
  if (imported.youtube) {
    if (Array.isArray(imported.youtube.blockedChannels)) {
      current.youtube.blockedChannels = [...new Set([...current.youtube.blockedChannels, ...imported.youtube.blockedChannels])];
    }
    if (Array.isArray(imported.youtube.allowedChannels)) {
      current.youtube.allowedChannels = [...new Set([...current.youtube.allowedChannels, ...imported.youtube.allowedChannels])];
    }
  }
  if (imported.reddit) {
    if (Array.isArray(imported.reddit.blockedSubreddits)) {
      current.reddit.blockedSubreddits = [...new Set([...current.reddit.blockedSubreddits, ...imported.reddit.blockedSubreddits])];
    }
    if (Array.isArray(imported.reddit.allowedSubreddits)) {
      current.reddit.allowedSubreddits = [...new Set([...current.reddit.allowedSubreddits, ...imported.reddit.allowedSubreddits])];
    }
  }
  if (Array.isArray(imported.blockedSites)) {
    current.blockedSites = [...new Set([...current.blockedSites, ...imported.blockedSites])];
  }

  await setBlockRules(current);
  alert("Rules imported successfully.");
  location.reload();
});
