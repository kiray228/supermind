// SuperMind для Windows: окно с веб-версией. Сайт кэшируется service worker'ом —
// после первого запуска работает офлайн, а обновления приходят сами вместе с сайтом.
const { app, BrowserWindow, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_URL = 'https://kiray228.github.io/supermind/';
// прежний адрес (до переименования) переадресует на новый
const OLD_URL = 'https://kiray228.github.io/2mind/';
const ORIGIN = new URL(APP_URL).origin;

// метка в User-Agent: веб-версия прячет «Скачать для Windows» внутри приложения
app.userAgentFallback = `${app.userAgentFallback} SuperMind-Desktop/${app.getVersion()}`;
app.setAppUserModelId('app.twomind.mindmap');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
const stateFile = () => path.join(app.getPath('userData'), 'window.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { width: 1280, height: 820 };
  }
}

function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    /* не критично */
  }
}

const isApp = (url) => url.startsWith(APP_URL) || url.startsWith(OLD_URL);
const openOutside = (url) => {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
};

function createWindow() {
  const s = loadState();
  win = new BrowserWindow({
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    minWidth: 360,
    minHeight: 500,
    show: false,
    title: 'SuperMind',
    backgroundColor: '#f6f6f8',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { spellcheck: true },
  });
  win.removeMenu();
  if (s.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveState);

  const wc = win.webContents;
  // ссылки на другие сайты — в обычном браузере
  wc.setWindowOpenHandler(({ url }) => {
    if (!isApp(url)) openOutside(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (isApp(url) || url.startsWith('data:')) return;
    e.preventDefault();
    openOutside(url);
  });
  // нет интернета при самом первом запуске (до того как сайт закэшировался)
  wc.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3 || !isApp(url)) return;
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: APP_URL } });
  });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') {
      e.preventDefault();
      if (isApp(wc.getURL())) wc.reload();
      else win.loadURL(APP_URL);
    } else if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      e.preventDefault();
      wc.toggleDevTools();
    }
  });

  win.loadURL(APP_URL);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  // уведомления, микрофон (голосовой ввод), буфер обмена — только для самого приложения
  const allowed = new Set(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm) && wc.getURL().startsWith(ORIGIN)));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
