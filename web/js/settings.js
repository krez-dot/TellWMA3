// settings.js — the Settings tab. Every control is an Ionic component; its
// ionInput / ionChange event updates the live `settings` object, saves it to
// localStorage, and notifies the rest of the app so changes apply immediately.

import { loadSettings, saveSettings, DEFAULT_SETTINGS, clearAllData, storageUsage } from './storage.js';
import { $, confirm, toast } from './ui.js';
import { playTone } from './sound.js';

export const settings = loadSettings();

const listeners = [];
export function onSettingsChange(fn) { listeners.push(fn); }

export function updateSetting(key, value) {
  if (settings[key] === value) return;
  settings[key] = value;
  saveSettings(settings);
  listeners.forEach((fn) => fn(key, value));
}

const SENSITIVITY_LABELS = ['Very low', 'Low', 'Normal', 'High', 'Very high'];

// ---------- theme ----------
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && darkQuery.matches);
  document.documentElement.classList.toggle('ion-palette-dark', dark);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#221b29' : '#ff8fab';
}
darkQuery.addEventListener('change', applyTheme);

// ---------- fill the form from saved settings ----------
function render() {
  $('setName').value = settings.name;
  $('setGoal').value = settings.dailyGoalMin;
  $('setAfk').value = settings.afkSeconds;
  $('setAfkValue').textContent = settings.afkSeconds;
  $('setSensitivity').value = settings.sensitivity;
  $('setSensitivityValue').textContent = SENSITIVITY_LABELS[settings.sensitivity - 1];
  $('setAwayAlert').checked = settings.awayAlert;
  $('setSound').checked = settings.sound;
  $('setTone').value = settings.tone;
  $('setTheme').value = settings.theme;
  renderStorageInfo();
}

export function renderStorageInfo() {
  const kb = storageUsage() / 1024;
  $('storageInfo').textContent = `${kb < 1 ? kb.toFixed(2) : kb.toFixed(1)} KB used in local storage`;
}

export function initSettings() {
  render();
  applyTheme();

  // Text inputs: ionInput fires on every keystroke
  $('setName').addEventListener('ionInput', (e) => updateSetting('name', e.detail.value.trim()));

  $('setGoal').addEventListener('ionInput', (e) => {
    const n = parseInt(e.detail.value, 10);
    if (n >= 5 && n <= 600) updateSetting('dailyGoalMin', n);
  });
  // On blur, snap an invalid goal back to a valid value
  $('setGoal').addEventListener('ionBlur', () => { $('setGoal').value = settings.dailyGoalMin; });

  // Ranges: ionInput while dragging (live label), ionChange when released (save)
  $('setAfk').addEventListener('ionInput', (e) => { $('setAfkValue').textContent = e.detail.value; });
  $('setAfk').addEventListener('ionChange', (e) => updateSetting('afkSeconds', e.detail.value));

  $('setSensitivity').addEventListener('ionInput', (e) => {
    $('setSensitivityValue').textContent = SENSITIVITY_LABELS[e.detail.value - 1];
  });
  $('setSensitivity').addEventListener('ionChange', (e) => updateSetting('sensitivity', e.detail.value));

  // Toggles, select and segment: ionChange
  $('setAwayAlert').addEventListener('ionChange', (e) => updateSetting('awayAlert', e.detail.checked));
  $('setSound').addEventListener('ionChange', (e) => updateSetting('sound', e.detail.checked));
  $('setTone').addEventListener('ionChange', (e) => {
    updateSetting('tone', e.detail.value);
    playTone(e.detail.value); // preview the chosen sound
  });
  $('setTheme').addEventListener('ionChange', (e) => {
    updateSetting('theme', e.detail.value);
    applyTheme();
  });

  $('testSoundBtn').addEventListener('click', () => {
    playTone(settings.tone);
    toast(settings.sound ? 'That\'s what a distraction sounds like 🔔' : 'Sound alerts are off — this is just a preview');
  });

  $('resetSettingsBtn').addEventListener('click', async () => {
    if (!(await confirm('Reset settings?', 'Your study history is kept.', 'Reset'))) return;
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) updateSetting(key, value);
    render();
    applyTheme();
    toast('Settings reset');
  });

  $('wipeDataBtn').addEventListener('click', async () => {
    if (!(await confirm('Delete everything?', 'This removes all sessions, notes and settings from this device. It can\'t be undone.', 'Delete', true))) return;
    clearAllData();
    location.reload();
  });

  // Keep the session screen's quick toggle in sync
  onSettingsChange((key) => { if (key === 'sound') $('setSound').checked = settings.sound; });
}

/** Scroll reversals within 3 s needed to count as restless, from the sensitivity slider. */
export function reversalThreshold() {
  return [8, 6, 4, 3, 2][settings.sensitivity - 1] ?? 4;
}
