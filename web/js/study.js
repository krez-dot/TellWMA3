// study.js — the Study tab: open a document, run a session, detect restlessness.
//
// Three rules decide you've drifted (no ML, just behaviour):
//   1. scroll_reversal — flipping scroll direction back and forth several times within 3 s
//                        (normal reading scrolls one way). How many flips counts depends
//                        on the "Scroll sensitivity" setting.
//   2. afk             — no scroll / typing / touch / mouse for N seconds while the document is open.
//   3. tab_switch      — you left the app or browser tab (Page Visibility API).
// Plus a manual "I'm restless" marker (hand button or F8) so users can flag moments themselves.

import { settings, onSettingsChange, updateSetting, reversalThreshold, renderStorageInfo } from './settings.js';
import { addSession, loadActiveSession, saveActiveSession, clearActiveSession, loadHistory, MAX_TIMELINE } from './storage.js';
import { $, toast, confirm, formatClock, formatDuration, formatDate, focusPercent, isSameDay, selectTab } from './ui.js';
import { playTone } from './sound.js';
import { detectType, renderPdf, renderDocx, currentLocation } from './viewer.js';
import { openSessionDetail, historyChanged } from './history.js';

const REVERSAL_WINDOW_MS = 3000;
const DETECT_COOLDOWN_MS = 5000;
const NAG_INTERVAL_MS = 3000;
const SAVE_INTERVAL_MS = 5000;

let session = null;        // the session being recorded (null when on the landing screen)
let where = null;          // { key: 'Page 3', short: '3' } — the part of the document on screen
let recentScrolls = [];    // [{ t, top }] within the reversal window
let lastDetectedAt = 0;
let calmTimer = null;
let nagTimer = null;
let tickTimer = null;
let lastTickAt = 0;
let lastSavedAt = 0;
let lastActivityAt = 0;
let afk = false;
let hiddenAt = null;       // when the app went to the background
let onStudyTab = true;

let docEl, notesEl;

// ====================================================================
// Session data
// ====================================================================

function createSession(file, type, pageCount) {
  return {
    id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    docName: file.name,
    docType: type,
    pageCount,
    startedAt: Date.now(),
    endedAt: null,
    lastSeenAt: Date.now(),
    activeMs: 0,   // present and interacting
    afkMs: 0,      // app open but idle
    awayMs: 0,     // app in the background
    detections: { scroll_reversal: 0, afk: 0, tab_switch: 0 },
    markers: 0,
    keystrokes: 0,
    pages: {},     // { 'Page 3': { timeMs, restless, markers } }
    timeline: [],  // [{ t, type, where, rule?, awayMs? }]
    notes: '',
  };
}

function pageStats(key) {
  return (session.pages[key] ||= { timeMs: 0, restless: 0, markers: 0 });
}

/** Add an event to the session timeline and update counters. */
function record(type, extra = {}) {
  if (!session) return;
  session.timeline.push({ t: Date.now(), type, where: where?.key ?? null, ...extra });
  if (session.timeline.length > MAX_TIMELINE) session.timeline.shift();

  if (type === 'detected') {
    session.detections[extra.rule]++;
    if (where) pageStats(where.key).restless++;
  } else if (type === 'marker') {
    session.markers++;
    if (where) pageStats(where.key).markers++;
  }
  renderStats();
  persist(true);
}

/** Save the in-progress session to localStorage (throttled unless forced). */
function persist(force = false) {
  if (!session) return;
  const now = Date.now();
  if (!force && now - lastSavedAt < SAVE_INTERVAL_MS) return;
  session.lastSeenAt = now;
  saveActiveSession(session);
  lastSavedAt = now;
}

// ====================================================================
// Rendering
// ====================================================================

function renderStats() {
  if (!session) return;
  const restless = Object.values(session.detections).reduce((a, b) => a + b, 0);
  $('statPage').textContent = where?.short ?? '-';
  $('statRestless').textContent = restless;
  $('statMarkers').textContent = session.markers;
  $('statFocus').textContent = `${focusPercent(session)}%`;
}

function renderTimer() {
  if (session) $('timerLabel').textContent = formatClock(Date.now() - session.startedAt);
}

function setStatus(restless, text) {
  $('status').className = `status ${restless ? 'restless' : 'calm'}`;
  $('statusText').textContent = text;
}

function showSessionScreen(active) {
  $('landing').hidden = active;
  $('session').hidden = !active;
  $('markerFab').hidden = !active;
  $('timerChip').hidden = !active;
  // The page itself shouldn't scroll during a session — the document and side panel scroll on their own.
  $('studyContent').scrollY = !active;
  if (!active) $('studyTitle').textContent = 'Tell';
}

const DAY_MS = 24 * 3600 * 1000;
const startOfDay = (ts) => new Date(ts).setHours(0, 0, 0, 0);

/** Focused ms per day for the last 7 days, oldest first: [{ day, ms }] */
function lastSevenDays(history) {
  const today = startOfDay(Date.now());
  const days = Array.from({ length: 7 }, (_, i) => ({ day: today - (6 - i) * DAY_MS, ms: 0 }));
  for (const s of history) {
    const d = days.find((x) => x.day === startOfDay(s.startedAt));
    if (d) d.ms += s.activeMs || 0;
  }
  return days;
}

/** Consecutive days with at least one session, counting back from today (or yesterday). */
function studyStreak(history) {
  const studied = new Set(history.map((s) => startOfDay(s.startedAt)));
  let day = startOfDay(Date.now());
  if (!studied.has(day)) day -= DAY_MS; // today not started yet: streak still alive from yesterday
  let streak = 0;
  while (studied.has(day)) { streak++; day -= DAY_MS; }
  return streak;
}

/** Bar chart of focused minutes, built with DOM elements (hover/focus a bar for its value). */
function renderWeekChart(days) {
  const maxMs = Math.max(...days.map((d) => d.ms), 1);
  const bars = days.map((d, i) => {
    const min = Math.round(d.ms / 60000);
    const isToday = i === days.length - 1;
    const date = new Date(d.day);
    const dayName = isToday ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' });

    const col = document.createElement('div');
    col.className = `bar-col${isToday ? ' today' : ''}`;
    col.tabIndex = 0; // tap/keyboard focus shows the tooltip on phones
    col.setAttribute('aria-label', `${dayName}: ${min} focused minutes`);

    const tip = document.createElement('span');
    tip.className = 'bar-tip';
    tip.textContent = `${date.toLocaleDateString(undefined, { weekday: 'long' })} · ${min} min`;

    const bar = document.createElement('div');
    bar.className = `bar${d.ms ? '' : ' empty'}`;
    bar.style.height = d.ms ? `${Math.max(4, (d.ms / maxMs) * 100)}%` : '2px';
    const track = document.createElement('div');
    track.className = 'bar-track';
    track.append(bar);

    const label = document.createElement('span');
    label.className = 'bar-day';
    label.textContent = isToday ? 'Today' : dayName.slice(0, 3);

    col.append(tip, track, label);
    if (isToday && min) {
      const value = document.createElement('span');
      value.className = 'bar-value';
      value.textContent = `${min}m`;
      // sit just above the bar: track height is the column minus the ~17px day label
      value.style.bottom = `calc((100% - 17px) * ${d.ms / maxMs} + 21px)`;
      value.style.top = 'auto';
      col.append(value);
    }
    return col;
  });
  const totalMs = days.reduce((sum, d) => sum + d.ms, 0);
  if (!totalMs) {
    const empty = document.createElement('div');
    empty.className = 'week-empty';
    empty.textContent = 'Your week fills in here as you study.';
    bars.push(empty);
  }
  $('weekChart').replaceChildren(...bars);
  $('weekTotal').textContent = totalMs < 60000 ? '0m' : formatDuration(totalMs);
}

/** The three most recent sessions, as a tappable Ionic list. */
function renderRecent(history) {
  const recent = history.slice(0, 3);
  $('recentSection').hidden = recent.length === 0;
  $('recentList').replaceChildren(...recent.map((s) => {
    const pct = focusPercent(s);
    const item = document.createElement('ion-item');
    item.button = true;
    item.detail = true;

    const icon = document.createElement('ion-icon');
    icon.slot = 'start';
    icon.src = 'lib/icons/document-text-outline.svg';
    icon.color = 'primary';

    const label = document.createElement('ion-label');
    const title = document.createElement('h2');
    title.textContent = s.docName;
    const sub = document.createElement('p');
    sub.textContent = `${formatDate(s.startedAt)} · ${formatDuration((s.endedAt || s.startedAt) - s.startedAt)}`;
    label.append(title, sub);

    const badge = document.createElement('ion-badge');
    badge.slot = 'end';
    badge.color = pct >= 75 ? 'success' : pct >= 50 ? 'warning' : 'danger';
    badge.textContent = `${pct}%`;

    item.append(icon, label, badge);
    item.addEventListener('click', () => selectTab('history').then(() => openSessionDetail(s.id)));
    return item;
  }));
}

/** Landing screen: greeting, goal, streak, week chart and recent sessions — all from saved history. */
export function refreshLanding() {
  $('greeting').textContent = settings.name ? `Hi, ${settings.name} 👋` : 'Ready when you are';

  const history = loadHistory();
  const streak = studyStreak(history);
  $('streakChip').hidden = streak < 1;
  $('streakText').textContent = `${streak}-day streak`;
  renderWeekChart(lastSevenDays(history));
  renderRecent(history);

  const todayMs = history
    .filter((s) => isSameDay(s.startedAt, Date.now()))
    .reduce((sum, s) => sum + (s.activeMs || 0), 0);
  const doneMin = Math.floor(todayMs / 60000);
  const goal = settings.dailyGoalMin;

  $('goalText').textContent = `${doneMin} / ${goal} focused min`;
  $('goalBar').value = Math.min(1, doneMin / goal);
  $('goalBar').color = doneMin >= goal ? 'success' : 'primary';
  $('goalHint').textContent = doneMin >= goal
    ? 'Goal reached — nice work! 🎉'
    : `${goal - doneMin} min to go today. Change your goal in Settings.`;

  checkRecovery();
}

// ====================================================================
// Alerts
// ====================================================================

function alertSound() {
  if (settings.sound) playTone(settings.tone);
}

function flashScreen() {
  $('flash').classList.add('on');
  setTimeout(() => $('flash').classList.remove('on'), 150);
}

/** One-off alert (scroll rule): show RESTLESS for a few seconds, then back to calm. */
function flagRestless(text) {
  setStatus(true, text);
  alertSound();
  clearTimeout(calmTimer);
  calmTimer = setTimeout(() => { if (!nagTimer) setStatus(false, 'Calm'); }, DETECT_COOLDOWN_MS);
}

/** Repeating alert (idle / left the app): keeps nagging until you come back. */
function startNagging(text) {
  setStatus(true, text);
  alertSound();
  clearInterval(nagTimer);
  nagTimer = setInterval(alertSound, NAG_INTERVAL_MS);
}

function stopNagging() {
  clearInterval(nagTimer);
  nagTimer = null;
  setStatus(false, 'Calm');
}

// ====================================================================
// Detection
// ====================================================================

function markActivity() {
  lastActivityAt = Date.now();
  if (afk) {
    afk = false;
    stopNagging();
  }
}

function onDocScroll() {
  if (!session) return;
  markActivity();
  where = currentLocation(docEl, session.docType);
  renderStats();
  checkScrollReversal(Math.round(docEl.scrollTop));
}

// Rule 1: several up/down direction flips inside a short window = restless scrolling.
function checkScrollReversal(top) {
  const now = Date.now();
  recentScrolls.push({ t: now, top });
  recentScrolls = recentScrolls.filter((s) => now - s.t <= REVERSAL_WINDOW_MS);

  let reversals = 0;
  let lastDir = 0;
  for (let i = 1; i < recentScrolls.length; i++) {
    const dir = Math.sign(recentScrolls[i].top - recentScrolls[i - 1].top);
    if (dir !== 0) {
      if (lastDir !== 0 && dir !== lastDir) reversals++;
      lastDir = dir;
    }
  }

  if (reversals >= reversalThreshold() && now - lastDetectedAt > DETECT_COOLDOWN_MS) {
    lastDetectedAt = now;
    record('detected', { rule: 'scroll_reversal', reversals });
    flagRestless('Restless scrolling!');
  }
}

// Runs every second: accumulates time and checks rule 2 (idle).
function tick() {
  if (!session) return;
  const now = Date.now();
  const delta = Math.min(now - lastTickAt, 5000); // timers can pause in the background; away time is measured separately
  lastTickAt = now;

  if (document.visibilityState === 'visible' && onStudyTab) {
    if (afk) {
      session.afkMs += delta;
    } else {
      session.activeMs += delta;
      if (where) pageStats(where.key).timeMs += delta;

      if (now - lastActivityAt >= settings.afkSeconds * 1000) {
        afk = true;
        record('detected', { rule: 'afk' });
        startNagging('Still there?');
      }
    }
  }
  renderTimer();
  renderStats();
  persist();
}

// Rule 3: leaving the app / tab.
function onVisibilityChange() {
  if (!session) return;
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    if (settings.awayAlert) {
      record('detected', { rule: 'tab_switch' });
      startNagging('Come back!');
    } else {
      record('away');
    }
    persist(true); // the OS may kill a backgrounded app, so save now
  } else {
    const awayMs = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    if (settings.awayAlert) session.awayMs += awayMs;
    record('back', { awayMs });
    lastActivityAt = lastTickAt = Date.now(); // coming back counts as activity
    afk = false;
    stopNagging();
    if (settings.awayAlert && awayMs > 3000) {
      toast(`You were away for ${formatDuration(awayMs)}`, { color: 'warning' });
    }
  }
}

// Manual self-report
function markRestless() {
  if (!session) return;
  record('marker');
  flashScreen();
  toast(`Marked ${where ? where.key.toLowerCase() : 'this moment'} as a struggle spot`, { duration: 1500 });
}

// ====================================================================
// Starting, ending and recovering sessions
// ====================================================================

async function openFile(file) {
  const type = detectType(file);
  if (!type) {
    toast('Please choose a PDF or DOCX file', { color: 'danger' });
    return;
  }

  // A crashed session is still waiting on the landing screen — keep it rather than overwrite it.
  if (loadActiveSession()) saveRecoveredSession(false);

  showSessionScreen(true);
  $('studyTitle').textContent = file.name;
  const bar = $('renderBar');
  bar.hidden = false;
  bar.type = type === 'pdf' ? 'determinate' : 'indeterminate';
  bar.value = 0;

  let pageCount = null;
  try {
    pageCount = type === 'pdf'
      ? await renderPdf(docEl, file, (done, total) => { bar.value = done / total; })
      : await renderDocx(docEl, file);
  } catch (e) {
    console.error(e);
    bar.hidden = true;
    docEl.innerHTML = '';
    showSessionScreen(false);
    toast('Couldn\'t open that file. Is it a valid, unlocked PDF or DOCX?', { color: 'danger', duration: 4000 });
    return;
  }
  bar.hidden = true;
  docEl.scrollTop = 0;

  // Fresh session state
  session = createSession(file, type, pageCount);
  where = currentLocation(docEl, type);
  recentScrolls = [];
  lastDetectedAt = 0;
  afk = false;
  hiddenAt = null;
  lastActivityAt = lastTickAt = Date.now();
  notesEl.value = '';
  $('sessionSoundToggle').checked = settings.sound;
  stopNagging();
  record('start');
  renderTimer();

  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
}

async function endSession() {
  if (!session) return;
  const ok = await confirm(
    'End this session?',
    `You've been studying for ${formatDuration(Date.now() - session.startedAt)}. It'll be saved to your history.`,
    'End & save'
  );
  if (ok) finishSession();
}

function finishSession() {
  clearInterval(tickTimer);
  clearTimeout(calmTimer);
  stopNagging();

  session.endedAt = Date.now();
  session.notes = notesEl.value || '';
  record('end');
  const saved = session;
  session = null;
  where = null;

  addSession(saved);
  clearActiveSession();

  docEl.innerHTML = '';
  notesEl.value = '';
  showSessionScreen(false);
  historyChanged();
  renderStorageInfo();

  toast(`Session saved · ${focusPercent(saved)}% focus`, {
    color: 'success',
    duration: 4000,
    buttons: [{ text: 'View', handler: () => { selectTab('history').then(() => openSessionDetail(saved.id)); } }],
  });
}

/** If the app was closed mid-session, offer to save or discard what was recorded. */
function checkRecovery() {
  const pending = session ? null : loadActiveSession();
  $('recoverCard').hidden = !pending;
  if (!pending) return;
  const lasted = (pending.lastSeenAt || pending.startedAt) - pending.startedAt;
  $('recoverInfo').textContent = `${pending.docName} · ${formatDuration(lasted)} · ${formatDate(pending.startedAt)}`;
}

function saveRecoveredSession(showToast = true) {
  const pending = loadActiveSession();
  if (!pending) return;
  pending.endedAt = pending.lastSeenAt || Date.now();
  pending.recovered = true;
  addSession(pending);
  clearActiveSession();
  historyChanged();
  renderStorageInfo();
  if (showToast) toast('Unfinished session saved to history', { color: 'success' });
}

export function hasActiveSession() {
  return session !== null;
}

export { endSession };

// ====================================================================
// Wiring
// ====================================================================

export function initStudy() {
  docEl = $('doc');
  notesEl = $('notes');

  // The Ionic button opens the hidden native file picker
  $('pickFileBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // allow picking the same file again later
    if (file) openFile(file);
  });

  // Drag & drop a file onto the landing card (desktop browsers)
  const dropZone = $('dropZone');
  ['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, () => dropZone.classList.remove('dragging')));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) openFile(file);
  });
  // Dropping a file anywhere else shouldn't make the browser navigate away from the app
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('seeAllBtn').addEventListener('click', () => selectTab('history'));

  docEl.addEventListener('scroll', onDocScroll, { passive: true });

  // Typing rhythm + notes auto-save
  notesEl.addEventListener('keydown', () => {
    if (!session) return;
    session.keystrokes++;
    markActivity();
  });
  notesEl.addEventListener('ionInput', (e) => {
    if (!session) return;
    session.notes = e.detail.value || '';
    markActivity(); // on-screen keyboards don't always send keydown
    persist();
  });

  // Any touch, click, mouse movement or key press counts as "still here"
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) {
    document.addEventListener(type, () => { if (session) markActivity(); }, { passive: true });
  }

  document.addEventListener('visibilitychange', onVisibilityChange);

  // Self-report: floating hand button, or F8 on a keyboard
  $('markerBtn').addEventListener('click', markRestless);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F8' && session) {
      e.preventDefault();
      markRestless();
    }
  });

  $('endSessionBtn').addEventListener('click', endSession);
  $('sessionSoundToggle').addEventListener('ionChange', (e) => updateSetting('sound', e.detail.checked));

  $('recoverSaveBtn').addEventListener('click', () => { saveRecoveredSession(); refreshLanding(); });
  $('recoverDiscardBtn').addEventListener('click', async () => {
    if (!(await confirm('Discard session?', 'The unfinished session will be deleted.', 'Discard', true))) return;
    clearActiveSession();
    refreshLanding();
  });

  // Idle detection pauses while you're on the History / Settings tabs
  $('tabs').addEventListener('ionTabsDidChange', (e) => {
    onStudyTab = e.detail.tab === 'study';
    lastActivityAt = Date.now();
    if (onStudyTab) refreshLanding();
  });

  onSettingsChange((key) => {
    if (key === 'sound') $('sessionSoundToggle').checked = settings.sound;
    if (key === 'name' || key === 'dailyGoalMin') refreshLanding();
  });
  window.addEventListener('tell:history-changed', refreshLanding);

  refreshLanding();
}
