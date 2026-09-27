// ui.js — small helpers shared by every screen: formatting, and Ionic overlays
// (toasts and alerts are created with document.createElement, then presented).

export const $ = (id) => document.getElementById(id);

export const isCordova = () => typeof window.cordova !== 'undefined';

export function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatClock(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function isSameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Focus % = time actively studying / total time (idle and away time count against you). */
export function focusPercent(session) {
  const total = (session.activeMs || 0) + (session.afkMs || 0) + (session.awayMs || 0);
  return total > 0 ? Math.round((session.activeMs / total) * 100) : 100;
}

export function focusColor(pct) {
  return pct >= 75 ? 'success' : pct >= 50 ? 'warning' : 'danger';
}

/** Show an ion-toast. `buttons` is optional, e.g. [{ text: 'Undo', handler }]. */
export async function toast(message, { color = 'dark', duration = 2500, buttons } = {}) {
  const el = document.createElement('ion-toast');
  el.message = message;
  el.duration = duration;
  el.color = color;
  el.position = 'top';
  if (buttons) el.buttons = buttons;
  document.body.appendChild(el);
  el.addEventListener('didDismiss', () => el.remove());
  await el.present();
  return el;
}

/** Show an ion-alert with Cancel / confirm buttons. Resolves true if confirmed. */
export async function confirm(header, message, confirmText = 'OK', destructive = false) {
  const el = document.createElement('ion-alert');
  el.header = header;
  el.message = message;
  el.buttons = [
    { text: 'Cancel', role: 'cancel' },
    { text: confirmText, role: 'confirm', cssClass: destructive ? 'alert-danger' : '' },
  ];
  document.body.appendChild(el);
  await el.present();
  const { role } = await el.onDidDismiss();
  el.remove();
  return role === 'confirm';
}

/** Switch the bottom tab bar to another tab. */
export function selectTab(tab) {
  return $('tabs').select(tab);
}
