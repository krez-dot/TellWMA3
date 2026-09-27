// storage.js — everything Tell saves lives here, in the browser/WebView's localStorage.
//
// Three keys, all JSON:
//   tell.settings       user preferences (name, daily goal, detection sensitivity, sound, theme)
//   tell.history        array of finished study sessions, newest first
//   tell.activeSession  the session in progress, re-saved every few seconds so a crash or
//                       closed tab doesn't lose it (offered for recovery on next launch)

const KEYS = {
  settings: 'tell.settings',
  history: 'tell.history',
  active: 'tell.activeSession',
};

export const DEFAULT_SETTINGS = {
  name: '',
  dailyGoalMin: 60,   // minutes of focused study per day
  afkSeconds: 12,     // idle this long with the document open -> "you still there?"
  sensitivity: 3,     // 1 (low) .. 5 (high), maps to how many scroll reversals count as restless
  awayAlert: true,    // treat leaving the app/tab as a distraction
  sound: true,
  tone: 'beep',       // 'beep' | 'chime' | 'buzz'
  theme: 'system',    // 'system' | 'light' | 'dark'
};

// Keep a session's timeline bounded so years of history still fit in localStorage (~5 MB).
export const MAX_TIMELINE = 400;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback; // storage blocked (private mode) or corrupted JSON
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`Could not save ${key}`, e); // usually QuotaExceededError
    return false;
  }
}

// ---------- settings ----------
export function loadSettings() {
  // Merge over the defaults so settings added in a newer version get a sane value.
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(settings) {
  return write(KEYS.settings, settings);
}

// ---------- history ----------
export function loadHistory() {
  const list = read(KEYS.history, []);
  return Array.isArray(list) ? list : [];
}

function saveHistory(list) {
  if (write(KEYS.history, list)) return true;
  // Out of space: drop the detailed timelines of the oldest sessions (their summaries stay) and retry.
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].timeline && list[i].timeline.length) {
      list[i].timeline = [];
      if (write(KEYS.history, list)) return true;
    }
  }
  return false;
}

export function addSession(session) {
  const list = loadHistory();
  list.unshift(session);
  return saveHistory(list);
}

export function deleteSession(id) {
  const list = loadHistory();
  const index = list.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const [removed] = list.splice(index, 1);
  saveHistory(list);
  return { removed, index }; // returned so the caller can offer "Undo"
}

export function restoreSession(session, index) {
  const list = loadHistory();
  list.splice(Math.min(index, list.length), 0, session);
  saveHistory(list);
}

export function clearHistory() {
  write(KEYS.history, []);
}

// ---------- in-progress session ----------
export function loadActiveSession() {
  return read(KEYS.active, null);
}

export function saveActiveSession(session) {
  return write(KEYS.active, session);
}

export function clearActiveSession() {
  try { localStorage.removeItem(KEYS.active); } catch (e) { /* ignore */ }
}

// ---------- misc ----------
export function clearAllData() {
  for (const key of Object.values(KEYS)) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
}

/** Approximate bytes used by Tell's keys (localStorage stores UTF-16, 2 bytes per char). */
export function storageUsage() {
  let chars = 0;
  for (const key of Object.values(KEYS)) {
    try { chars += (localStorage.getItem(key) || '').length; } catch (e) { /* ignore */ }
  }
  return chars * 2;
}
