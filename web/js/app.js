// app.js — entry point. Starts every screen, handles the platform differences
// between the website and the Android app (there are very few), and adapts the
// tab bar to the screen size.

import { initSettings } from './settings.js';
import { initHistory } from './history.js';
import { initStudy, hasActiveSession, endSession } from './study.js';
import { $, isCordova, selectTab } from './ui.js';

const APP_VERSION = '2.0.0';

// Responsive navigation: tab bar at the bottom on phones (thumb reach),
// at the top on wide screens where it acts like a regular nav bar.
const wideScreen = window.matchMedia('(min-width: 992px)');
function placeTabBar() {
  $('tabBar').slot = wideScreen.matches ? 'top' : 'bottom';
}

// Android hardware back button (Ionic turns Cordova's "backbutton" into ionBackButton).
// Open alerts/modals close first because Ionic gives them a higher priority.
function handleBackButton() {
  document.addEventListener('ionBackButton', (ev) => {
    ev.detail.register(10, async () => {
      const tab = await $('tabs').getSelected();
      if (tab !== 'study') selectTab('study');
      else if (hasActiveSession()) endSession();
      else navigator.app?.exitApp();
    });
  });
}

function init() {
  initSettings();
  initHistory();
  initStudy();

  placeTabBar();
  wideScreen.addEventListener('change', placeTabBar);
  handleBackButton();

  $('appVersion').textContent = `v${APP_VERSION}`;
  $('platformLabel').textContent = isCordova() ? 'Android app' : 'Web app';

  // Offline support + "Add to Home Screen" on the website. Cordova already
  // serves files from inside the APK, so the service worker is only for the web.
  if (!isCordova() && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
