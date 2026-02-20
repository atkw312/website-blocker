/**
 * options.js — Drives the full options/settings page.
 *
 * Manages block list CRUD, session duration config, and parental PIN controls.
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
