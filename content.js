/**
 * content.js — Sumi content script (v3 freemium).
 *
 * Activates CSS shield via html.intent-mode-active class.
 * Handles visibilitychange for pause/resume, floating timer, expiry overlay.
 * SPA-aware via yt-navigate-finish.
 */

(() => {
  "use strict";

  if (window.__intentModeInjected) return;
  window.__intentModeInjected = true;

  const TIMER_UPDATE_MS = 1000;
  const MUTATION_DEBOUNCE_MS = 300;

  let intentEnabled = false;
  let timerInterval = null;
  let mutationTimer = null;

  // =========================================================================
  // CSS class toggle (activates styles.css rules)
  // =========================================================================

  function activateShield() {
    document.documentElement.classList.add("intent-mode-active");
  }

  function deactivateShield() {
    document.documentElement.classList.remove("intent-mode-active");
  }

  // =========================================================================
  // Homepage message
  // =========================================================================

  function showHomepageMessage() {
    if (document.getElementById("intent-mode-homepage")) return;

    const container = document.querySelector('ytd-browse[page-subtype="home"]');
    if (!container) return;

    const msg = document.createElement("div");
    msg.id = "intent-mode-homepage";
    Object.assign(msg.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "4rem 2rem",
      textAlign: "center",
      fontFamily: "system-ui, sans-serif",
      color: "#a8a29e",
      minHeight: "50vh"
    });
    msg.innerHTML = `
      <h2 style="font-size:1.5rem; margin:0 0 0.75rem; color:#f7f4f0; font-weight:600;">
        Sumi Active
      </h2>
      <p style="font-size:1.1rem; margin:0 0 1.5rem; max-width:400px; line-height:1.5;">
        The feed is hidden. Use the search bar to find what you want to watch.
      </p>
      <button id="intent-focus-search" style="
        padding: 0.6rem 1.5rem;
        background: #f7f4f0;
        color: #0c0a09;
        border: none;
        border-radius: 6px;
        font-size: 1rem;
        cursor: pointer;
        font-weight: 500;
      ">Go to Search</button>
    `;
    container.prepend(msg);

    msg.querySelector("#intent-focus-search").addEventListener("click", () => {
      const searchInput = document.querySelector("input#search");
      if (searchInput) { searchInput.focus(); searchInput.click(); }
    });
  }

  function removeHomepageMessage() {
    const el = document.getElementById("intent-mode-homepage");
    if (el) el.remove();
  }

  // =========================================================================
  // Shorts overlay
  // =========================================================================

  function showShortsOverlay() {
    if (document.getElementById("intent-mode-shorts-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "intent-mode-shorts-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      background: "rgba(0, 0, 0, 0.85)",
      color: "#e0e0e0",
      fontFamily: "system-ui, sans-serif",
      textAlign: "center",
      padding: "2rem"
    });
    overlay.innerHTML = `
      <h2 style="font-size:1.5rem; margin:0 0 0.75rem; color:#f7f4f0;">Shorts are hidden</h2>
      <p style="font-size:1.1rem; color:#a8a29e; margin:0 0 1.5rem; max-width:400px; line-height:1.5;">
        Shorts are hidden in Sumi. Search for what you want to watch.
      </p>
      <button id="intent-shorts-go-home" style="
        padding: 0.6rem 1.5rem;
        background: #f7f4f0;
        color: #0c0a09;
        border: none;
        border-radius: 6px;
        font-size: 1rem;
        cursor: pointer;
        font-weight: 500;
      ">Go to YouTube Home</button>
    `;
    document.documentElement.appendChild(overlay);

    document.querySelectorAll("video").forEach(v => {
      try { v.pause(); } catch { /* best effort */ }
    });

    overlay.querySelector("#intent-shorts-go-home").addEventListener("click", () => {
      window.location.href = "https://www.youtube.com";
    });
  }

  function removeShortsOverlay() {
    const el = document.getElementById("intent-mode-shorts-overlay");
    if (el) el.remove();
  }

  // =========================================================================
  // Autoplay disable
  // =========================================================================

  function disableAutoplay() {
    const toggle = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (toggle) toggle.click();
  }

  // =========================================================================
  // Floating timer badge
  // =========================================================================

  function createTimerBadge() {
    if (document.getElementById("intent-mode-timer")) return;

    const badge = document.createElement("div");
    badge.id = "intent-mode-timer";
    Object.assign(badge.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      zIndex: "2147483646",
      background: "rgba(12, 10, 9, 0.9)",
      color: "#f7f4f0",
      padding: "6px 14px",
      borderRadius: "20px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "0.85rem",
      fontWeight: "500",
      boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      border: "1px solid rgba(247, 244, 240, 0.15)",
      cursor: "default",
      userSelect: "none",
      transition: "opacity 0.2s"
    });
    badge.textContent = "--:--";
    document.documentElement.appendChild(badge);
  }

  function updateTimerBadge() {
    const badge = document.getElementById("intent-mode-timer");
    if (!badge) return;

    chrome.runtime.sendMessage({ action: "getSessionState" }, (response) => {
      if (chrome.runtime.lastError || !response) return;

      if (!response.active) {
        badge.textContent = "No session";
        return;
      }

      if (response.paused) {
        const totalSeconds = Math.ceil((response.remainingMs ?? 0) / 1000);
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        badge.textContent = `${m}:${String(s).padStart(2, "0")} (paused)`;
        return;
      }

      const remainingMs = response.remainingMs ?? 0;
      if (remainingMs <= 0) {
        badge.textContent = "0:00";
        showExpiryOverlay();
        return;
      }

      const totalSeconds = Math.ceil(remainingMs / 1000);
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      badge.textContent = `${m}:${String(s).padStart(2, "0")}`;
    });
  }

  function removeTimerBadge() {
    const el = document.getElementById("intent-mode-timer");
    if (el) el.remove();
  }

  function startTimerUpdates() {
    if (timerInterval) return;
    updateTimerBadge();
    timerInterval = setInterval(updateTimerBadge, TIMER_UPDATE_MS);
  }

  function stopTimerUpdates() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // =========================================================================
  // Session expiry overlay (soft dismiss only for free)
  // =========================================================================

  function showExpiryOverlay() {
    if (document.getElementById("intent-mode-expired")) return;

    document.querySelectorAll("video, audio").forEach(el => {
      try { el.pause(); } catch { /* best effort */ }
    });

    const overlay = document.createElement("div");
    overlay.id = "intent-mode-expired";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0, 0, 0, 0.6)",
      fontFamily: "system-ui, sans-serif"
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "#1c1917",
      borderRadius: "12px",
      padding: "2rem",
      maxWidth: "400px",
      textAlign: "center",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      border: "1px solid rgba(247, 244, 240, 0.1)"
    });
    card.innerHTML = `
      <h2 style="font-size:1.3rem; margin:0 0 0.5rem; color:#f7f4f0;">Session complete. Take a break?</h2>
      <p style="font-size:1rem; color:#a8a29e; margin:0 0 1.5rem; line-height:1.4;">
        You've reached the end of your session. Great focus!
      </p>
      <button id="intent-dismiss" style="
        padding: 0.6rem 1.5rem;
        background: #f7f4f0;
        color: #0c0a09;
        border: none;
        border-radius: 6px;
        font-size: 0.95rem;
        cursor: pointer;
        font-weight: 500;
      ">Dismiss</button>
    `;
    overlay.appendChild(card);
    document.documentElement.appendChild(overlay);

    card.querySelector("#intent-dismiss").addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "endSession" });
      overlay.remove();
    });
  }

  function removeExpiryOverlay() {
    const el = document.getElementById("intent-mode-expired");
    if (el) el.remove();
  }

  // =========================================================================
  // Visibility change → pause / resume
  // =========================================================================

  document.addEventListener("visibilitychange", () => {
    if (!intentEnabled) return;

    if (document.hidden) {
      chrome.runtime.sendMessage({ action: "pauseSession" });
    } else {
      chrome.runtime.sendMessage({ action: "resumeSession" });
    }
  });

  // =========================================================================
  // Core dispatcher
  // =========================================================================

  function isOnHomepage() {
    const path = window.location.pathname;
    return path === "/" || path === "";
  }

  function isOnShortsPage() {
    return /youtube\.com\/shorts\//.test(window.location.href);
  }

  async function applyIntentMode() {
    const data = await chrome.storage.local.get(["intentModeEnabled"]);
    intentEnabled = data.intentModeEnabled ?? false;

    if (!intentEnabled) {
      cleanup();
      return;
    }

    activateShield();

    if (isOnHomepage()) {
      removeShortsOverlay();
      showHomepageMessage();
    } else if (isOnShortsPage()) {
      removeHomepageMessage();
      showShortsOverlay();
    } else {
      removeHomepageMessage();
      removeShortsOverlay();
    }

    if (window.location.pathname === "/watch") {
      setTimeout(disableAutoplay, 1000);
    }

    createTimerBadge();
    startTimerUpdates();
  }

  function cleanup() {
    deactivateShield();
    removeHomepageMessage();
    removeShortsOverlay();
    removeTimerBadge();
    removeExpiryOverlay();
    stopTimerUpdates();
  }

  // =========================================================================
  // Message handler (backup expiry notification from background)
  // =========================================================================

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "sessionExpired") {
      showExpiryOverlay();
      sendResponse({ status: "OK" });
    }
  });

  // =========================================================================
  // Storage change listener
  // =========================================================================

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.intentModeEnabled || changes.sessionEndTime || changes.sessionPausedRemaining) {
      applyIntentMode();
    }
  });

  // =========================================================================
  // SPA navigation + MutationObserver
  // =========================================================================

  function init() {
    applyIntentMode();

    document.addEventListener("yt-navigate-finish", () => {
      removeShortsOverlay();
      removeHomepageMessage();
      removeExpiryOverlay();
      setTimeout(applyIntentMode, 300);
    });

    const observer = new MutationObserver(() => {
      if (mutationTimer) clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        if (intentEnabled && isOnHomepage()) {
          showHomepageMessage();
        }
      }, MUTATION_DEBOUNCE_MS);
    });

    const target = document.body || document.documentElement;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
    }
  }

  init();
})();
