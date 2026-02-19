/**
 * background.js — Service worker (Manifest V3).
 *
 * Responsibilities:
 *   1. Seed storage on first install.
 *   2. Listen for tab navigations and check every URL against the rule engine.
 *   3. Redirect blocked pages to blocked.html.
 *   4. Handle messages from content scripts asking "is this blocked?"
 */

importScripts("storage.js", "rules.js");

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await initializeStorage();
    console.log("[FocusBlocker] Storage initialized on first install.");
  }
});

// ---------------------------------------------------------------------------
// Tab navigation listener
// ---------------------------------------------------------------------------

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when a navigation commits a new URL.
  if (changeInfo.status !== "complete" || !tab.url) return;

  try {
    const blocked = await shouldBlockUrl(tab.url);
    if (blocked) {
      const blockedPage = chrome.runtime.getURL("blocked.html");
      chrome.tabs.update(tabId, { url: blockedPage });
    }
  } catch (err) {
    console.error("[FocusBlocker] Error evaluating URL:", err);
  }
});

// ---------------------------------------------------------------------------
// Message handler — content scripts ask the background whether to block.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_BLOCK") {
    const { url, channelId } = message;

    (async () => {
      const focusActive = await isFocusActive();
      if (!focusActive) {
        sendResponse({ blocked: false });
        return;
      }

      let blocked = false;

      if (url.includes("youtube.com") && channelId) {
        // Content script extracted a channel ID from the DOM — use it.
        blocked = await isYouTubeVideoBlocked(url, channelId);
      } else {
        blocked = await shouldBlockUrl(url);
      }

      sendResponse({ blocked });
    })();

    // Return true to keep the message channel open for the async response.
    return true;
  }
});
