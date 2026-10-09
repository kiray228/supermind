// SuperMind для Windows: окно с веб-версией. Сайт кэшируется service worker'ом —
// после первого запуска работает офлайн, а обновления приходят сами вместе с сайтом.
const { app, BrowserWindow, shell, session, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_URL = 'https://kiray228.github.io/supermind/';
// прежний адрес (до переименования) переадресует на новый
const OLD_URL = 'https://kiray228.github.io/2mind/';
const ORIGIN = new URL(APP_URL).origin;

// метка в User-Agent: веб-версия прячет «Скачать для Windows» внутри приложения
app.userAgentFallback = `${app.userAgentFallback} SuperMind-Desktop/${app.getVersion()}`;
app.setAppUserModelId('app.twomind.mindmap');

// журнал для разбора проблем на чужих компьютерах: %APPDATA%\SuperMind\log.txt
function log(...parts) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'log.txt'), `${new Date().toISOString()} ${parts.join(' ')}\n`);
  } catch {
    /* не критично */
  }
}
process.on('uncaughtException', (e) => log('uncaught', (e && e.stack) || e));

// второй запуск только показывает уже открытое окно
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

let win = null;
const stateFile = () => path.join(app.getPath('userData'), 'window.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { width: 1280, height: 820 };
  }
}

/** Сохранённое место окна — только если оно на одном из подключённых экранов (иначе окно открылось бы за краем) */
function windowBounds(s) {
  const b = { width: s.width || 1280, height: s.height || 820 };
  if (typeof s.x !== 'number' || typeof s.y !== 'number') return b;
  const onScreen = screen.getAllDisplays().some(({ workArea: w }) =>
    s.x < w.x + w.width - 100 && s.x + b.width > w.x + 100 && s.y >= w.y - 10 && s.y < w.y + w.height - 100);
  return onScreen ? { ...b, x: s.x, y: s.y } : b;
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
    ...windowBounds(s),
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
  // окно показываем сразу с заставкой — сайт при медленном интернете грузится долго
  const reveal = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', reveal);
  setTimeout(reveal, 3000);
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
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    log('load failed', code, desc, url);
    if (!isApp(url)) return;
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: APP_URL } });
  });
  // вкладка упала (нехватка памяти, видеодрайвер) — перезапускаем, но не по кругу
  let crashes = 0;
  wc.on('render-process-gone', (_e, d) => {
    log('renderer gone', d.reason, d.exitCode);
    if (d.reason === 'clean-exit' || win.isDestroyed()) return;
    if (++crashes <= 2) win.loadURL(APP_URL).catch(() => {});
    else win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: APP_URL, crash: '1' } });
  });
  wc.on('unresponsive', () => log('unresponsive'));

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

  // заставка из файла программы, затем сайт: заставка видна, пока сайт не начнёт открываться
  win
    .loadFile(path.join(__dirname, 'loading.html'), { query: { url: APP_URL } })
    .catch(() => {})
    .then(() => win.loadURL(APP_URL))
    .catch(() => {});
}

app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('child-process-gone', (_e, d) => log('child gone', d.type, d.reason, d.exitCode));

app.whenReady().then(() => {
  if (!primary) return;
  log('start', app.getVersion(), process.getSystemVersion());
  // уведомления, микрофон (голосовой ввод), буфер обмена — только для самого приложения
  const allowed = new Set(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm) && wc.getURL().startsWith(ORIGIN)));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
