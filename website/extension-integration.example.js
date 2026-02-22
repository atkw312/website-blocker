/**
 * Extension Integration Example
 *
 * Shows how the Chrome extension authenticates with the website API
 * and fetches plan/settings using Supabase access tokens.
 *
 * Add @supabase/supabase-js to the extension or use fetch directly.
 */

// --- Option A: Using @supabase/supabase-js in the extension ---

/*
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "your-publishable-default-key";
const API_BASE = "https://yourintentmode.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage: chrome.storage.local, storageKey: "supabase-auth" },
});

// Sign in (call from extension popup or options page)
async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data.session;
}

// Get access token for API calls
async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
*/

// --- Option B: Direct fetch (no Supabase SDK needed) ---

const API_BASE = "https://yourintentmode.com";

// Store token in chrome.storage.local after user authenticates
// (e.g., via a login page in the extension popup)

async function fetchPlan() {
  const { authToken } = await chrome.storage.local.get("authToken");
  if (!authToken) return { plan: "free", isProUser: false };

  const res = await fetch(`${API_BASE}/api/user/plan`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (!res.ok) return { plan: "free", isProUser: false };
  return res.json();
}

async function fetchSettings() {
  const { authToken } = await chrome.storage.local.get("authToken");
  if (!authToken) return null;

  const res = await fetch(`${API_BASE}/api/user/settings`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (!res.ok) return null;
  return res.json();
}

// Poll on extension startup / periodically
async function syncFromServer() {
  const plan = await fetchPlan();
  await chrome.storage.local.set({ isProUser: plan.isProUser });

  if (plan.isProUser) {
    const settings = await fetchSettings();
    if (settings) {
      await chrome.storage.local.set({
        sessionDurationMinutes: settings.session_duration_minutes,
        // schedules and hard_cutoff synced here for Pro users
      });
    }
  }
}
