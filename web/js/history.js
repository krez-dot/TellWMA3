// history.js — the History tab. Reads finished sessions back out of localStorage
// and builds the list, the summary numbers and the detail modal with DOM methods.

import { loadHistory, deleteSession, restoreSession, clearHistory } from './storage.js';
import { $, toast, confirm, formatDate, formatDuration, focusPercent, focusColor, isCordova, isSameDay } from './ui.js';
import { renderStorageInfo } from './settings.js';

let query = '';
let range = 'all';

/** Tell every screen that history changed (list, landing goal, storage info all re-render). */
export function historyChanged() {
  window.dispatchEvent(new CustomEvent('tell:history-changed'));
}

const totalRestless = (s) => Object.values(s.detections || {}).reduce((a, b) => a + b, 0);
const sessionLength = (s) => (s.endedAt || s.lastSeenAt || s.startedAt) - s.startedAt;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// ---------- filtering ----------
function visibleSessions(all) {
  const now = Date.now();
  return all.filter((s) => {
    if (range === 'today' && !isSameDay(s.startedAt, now)) return false;
    if (range === 'week' && now - s.startedAt > 7 * 24 * 3600 * 1000) return false;
    if (query && !`${s.docName} ${s.notes || ''}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

// ---------- list ----------
function render() {
  const all = loadHistory();
  const list = visibleSessions(all);

  // Summary cards
  const studied = list.reduce((sum, s) => sum + (s.activeMs || 0), 0);
  $('sumSessions').textContent = list.length;
  $('sumTime').textContent = formatDuration(studied);
  $('sumFocus').textContent = list.length
    ? `${Math.round(list.reduce((sum, s) => sum + focusPercent(s), 0) / list.length)}%`
    : '–';
  $('sumRestless').textContent = list.reduce((sum, s) => sum + totalRestless(s), 0);

  $('historyList').replaceChildren(...list.map(buildItem));
  $('historyList').hidden = list.length === 0;
  $('historyEmpty').hidden = list.length > 0;
  $('historyEmptyText').textContent = all.length
    ? 'No sessions match your search.'
    : 'No sessions yet. Finish a study session and it\'ll show up here.';
}

function buildItem(s) {
  const pct = focusPercent(s);

  const item = el('ion-item', { button: true, detail: true, className: 'session-item' }, [
    el('ion-icon', { slot: 'start', src: 'lib/icons/document-text-outline.svg', color: 'primary' }),
    el('ion-label', {}, [
      el('h2', { textContent: s.docName }),
      el('p', { textContent: `${formatDate(s.startedAt)} · ${formatDuration(sessionLength(s))}` }),
      el('p', { textContent: `${totalRestless(s)} restless · ${s.markers} marked${s.recovered ? ' · recovered' : ''}` }),
    ]),
    el('ion-badge', { slot: 'end', color: focusColor(pct), className: 'focus-pill', textContent: `${pct}%` }),
  ]);
  item.addEventListener('click', () => openSessionDetail(s.id));

  // Swipe left to reveal Delete (a full swipe deletes straight away)
  const del = el('ion-item-option', { color: 'danger', expandable: true }, [
    el('ion-icon', { slot: 'icon-only', src: 'lib/icons/trash.svg' }),
  ]);
  del.addEventListener('click', () => removeSession(s.id));
  const options = el('ion-item-options', { side: 'end' }, [del]);
  options.addEventListener('ionSwipe', () => removeSession(s.id));

  return el('ion-item-sliding', {}, [item, options]);
}

function removeSession(id) {
  const result = deleteSession(id);
  if (!result) return;
  historyChanged();
  toast(`Deleted "${result.removed.docName}"`, {
    duration: 4000,
    buttons: [{ text: 'Undo', handler: () => { restoreSession(result.removed, result.index); historyChanged(); } }],
  });
}

// ---------- detail modal ----------
export async function openSessionDetail(id) {
  const s = loadHistory().find((x) => x.id === id);
  if (!s) return;
  const modal = $('detailModal');
  $('detailTitle').textContent = s.docName;

  const pct = focusPercent(s);
  const stat = (value, label) =>
    el('div', { className: 'stat' }, [
      el('span', { className: 'stat-value', textContent: value }),
      el('span', { className: 'stat-label', textContent: label }),
    ]);

  const content = [
    el('p', { className: 'block-note', textContent: `${formatDate(s.startedAt)} · ${s.docType.toUpperCase()}${s.pageCount ? ` · ${s.pageCount} pages` : ''}` }),
    el('div', { className: 'detail-stats' }, [
      stat(formatDuration(sessionLength(s)), 'total'),
      stat(`${pct}%`, 'focus'),
      stat(String(totalRestless(s)), 'restless'),
      stat(String(s.markers), 'marked'),
    ]),
    buildBreakdown(s),
    buildPageList(s),
  ];

  if (s.notes) {
    content.push(el('h3', { textContent: 'Your notes' }), el('div', { className: 'detail-notes', textContent: s.notes }));
  }

  const exportBtn = el('ion-button', { expand: 'block', fill: 'outline' }, [
    el('ion-icon', { slot: 'start', src: 'lib/icons/download-outline.svg' }),
    isCordova() ? 'Copy as CSV' : 'Export CSV',
  ]);
  exportBtn.addEventListener('click', () => exportCsv(s));

  const deleteBtn = el('ion-button', { expand: 'block', fill: 'outline', color: 'danger' }, [
    el('ion-icon', { slot: 'start', src: 'lib/icons/trash.svg' }),
    'Delete session',
  ]);
  deleteBtn.addEventListener('click', async () => {
    if (!(await confirm('Delete this session?', s.docName, 'Delete', true))) return;
    await modal.dismiss();
    removeSession(s.id);
  });
  content.push(el('div', { className: 'detail-actions' }, [exportBtn, deleteBtn]));

  $('detailContent').replaceChildren(...content);
  await modal.present();
}

/** Where the time went: active vs idle vs away, plus which rules fired. */
function buildBreakdown(s) {
  const d = s.detections || {};
  const row = (label, note) =>
    el('ion-item', {}, [el('ion-label', { textContent: label }), el('ion-note', { slot: 'end', textContent: note })]);
  return el('ion-list', { inset: false, lines: 'full' }, [
    el('ion-list-header', {}, [el('ion-label', { textContent: 'Where the time went' })]),
    row('Actively studying', formatDuration(s.activeMs || 0)),
    row('Idle with the document open', formatDuration(s.afkMs || 0)),
    row('Away from the app', formatDuration(s.awayMs || 0)),
    row('Restless scrolling alerts', String(d.scroll_reversal || 0)),
    row('Idle alerts', String(d.afk || 0)),
    row('Left-the-app alerts', String(d.tab_switch || 0)),
    row('Keystrokes in notes', String(s.keystrokes || 0)),
  ]);
}

/** The study diagnostic: which pages/sections you struggled with most. */
function buildPageList(s) {
  const pages = Object.entries(s.pages || {})
    .map(([key, p]) => ({ key, ...p, struggle: p.restless + p.markers }))
    .sort((a, b) => b.struggle - a.struggle || b.timeMs - a.timeMs)
    .slice(0, 10);

  const header = el('ion-list-header', {}, [el('ion-label', { textContent: 'Hardest parts of the document' })]);
  if (!pages.length) {
    return el('ion-list', {}, [header, el('ion-item', {}, [el('ion-label', { textContent: 'Not enough reading data.' })])]);
  }

  const maxStruggle = Math.max(1, ...pages.map((p) => p.struggle));
  const items = pages.map((p) =>
    el('ion-item', {}, [
      el('ion-label', {}, [
        el('h3', { textContent: p.key }),
        el('p', { textContent: `${p.restless} restless · ${p.markers} marked · ${formatDuration(p.timeMs)} read` }),
        el('div', { className: 'page-row' }, [
          el('ion-progress-bar', { value: p.struggle / maxStruggle, color: p.struggle ? 'danger' : 'success' }),
        ]),
      ]),
    ])
  );
  return el('ion-list', {}, [header, ...items]);
}

// ---------- export ----------
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(s) {
  const lines = ['time,event,location,rule,away_seconds'];
  for (const e of s.timeline || []) {
    lines.push([new Date(e.t).toISOString(), e.type, e.where, e.rule, e.awayMs ? Math.round(e.awayMs / 1000) : '']
      .map(csvCell).join(','));
  }
  lines.push('', 'location,seconds_read,restless,marked');
  for (const [key, p] of Object.entries(s.pages || {})) {
    lines.push([key, Math.round(p.timeMs / 1000), p.restless, p.markers].map(csvCell).join(','));
  }
  return lines.join('\n');
}

async function exportCsv(s) {
  const csv = toCsv(s);
  if (isCordova()) {
    // Android's WebView can't trigger file downloads, so the app copies the CSV instead.
    try {
      await navigator.clipboard.writeText(csv);
      toast('CSV copied — paste it into Sheets, Excel or Notes', { color: 'success' });
    } catch (e) {
      toast('Couldn\'t copy to clipboard', { color: 'danger' });
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = el('a', { href: url, download: `tell-${s.docName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_')}-${s.id}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- wiring ----------
export function initHistory() {
  $('historySearch').addEventListener('ionInput', (e) => {
    query = (e.detail.value || '').toLowerCase().trim();
    render();
  });
  $('historyRange').addEventListener('ionChange', (e) => {
    range = e.detail.value;
    render();
  });
  $('clearHistoryBtn').addEventListener('click', async () => {
    if (!loadHistory().length) return toast('History is already empty');
    if (!(await confirm('Clear all history?', 'Every saved session will be deleted from this device.', 'Clear', true))) return;
    clearHistory();
    historyChanged();
    toast('History cleared');
  });
  $('detailCloseBtn').addEventListener('click', () => $('detailModal').dismiss());

  window.addEventListener('tell:history-changed', () => { render(); renderStorageInfo(); });
  render();
}
