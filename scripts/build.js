// Build step for Tell.
//
//   node scripts/build.js libs     -> copy third-party libraries from node_modules into web/lib
//   node scripts/build.js          -> libs + copy web/ into dist/ (the deployable website)
//   node scripts/build.js android  -> everything above + copy dist/ into android/www (Cordova)
//
// Every library is copied locally rather than loaded from a CDN, so the
// Android APK works fully offline and both platforms run the exact same files.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = (p) => path.join(root, 'node_modules', p);
const web = path.join(root, 'web');
const dist = path.join(root, 'dist');
const androidWww = path.join(root, 'android', 'www');

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function clean(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyLibs() {
  const lib = path.join(web, 'lib');
  clean(lib);

  // Ionic web components (ES module build) + stylesheets
  copy(nm('@ionic/core/dist/ionic'), path.join(lib, 'ionic'));
  copy(nm('@ionic/core/css/ionic.bundle.css'), path.join(lib, 'ionic/css/ionic.bundle.css'));
  copy(nm('@ionic/core/css/palettes/dark.class.css'), path.join(lib, 'ionic/css/dark.class.css'));

  // Only the Ionicons we actually use (the full set is ~1300 files)
  const icons = [
    'book', 'book-outline', 'time', 'time-outline', 'settings', 'settings-outline',
    'hand-left', 'stop-circle', 'folder-open', 'document-text', 'document-text-outline',
    'trash', 'download-outline', 'shield-checkmark-outline', 'alert-circle-outline',
    'pulse', 'close', 'create-outline', 'eye-off-outline', 'stopwatch-outline',
    'flash-outline', 'information-circle-outline', 'checkmark-circle',
    'swap-vertical', 'cloud-upload-outline', 'flame', 'chevron-forward', 'bar-chart-outline',
  ];
  for (const name of icons) {
    copy(nm(`ionicons/dist/svg/${name}.svg`), path.join(lib, 'icons', `${name}.svg`));
  }

  // Document rendering
  copy(nm('pdfjs-dist/build/pdf.min.js'), path.join(lib, 'pdfjs/pdf.min.js'));
  copy(nm('pdfjs-dist/build/pdf.worker.min.js'), path.join(lib, 'pdfjs/pdf.worker.min.js'));
  copy(nm('mammoth/mammoth.browser.min.js'), path.join(lib, 'mammoth/mammoth.browser.min.js'));

  // Font (bundled so the APK doesn't need Google Fonts)
  for (const w of [400, 500, 600, 700]) {
    const f = `poppins-latin-${w}-normal.woff2`;
    copy(nm(`@fontsource/poppins/files/${f}`), path.join(lib, 'fonts', f));
  }
  console.log('✓ libraries copied to web/lib');
}

function buildWeb() {
  clean(dist);
  copy(web, dist);
  console.log('✓ web app built to dist/');
}

function buildAndroid() {
  if (!fs.existsSync(path.join(root, 'android', 'config.xml'))) {
    console.error('✗ android/ Cordova project not found — see README "Android build"');
    process.exit(1);
  }
  clean(androidWww);
  copy(dist, androidWww);
  // Service workers don't run inside Cordova's WebView; the app skips registering it there.
  console.log('✓ dist/ copied into android/www');
}

const mode = process.argv[2];
copyLibs();
if (mode !== 'libs') buildWeb();
if (mode === 'android') buildAndroid();
