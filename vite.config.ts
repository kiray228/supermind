import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import pkg from './package.json' with { type: 'json' }

/** Генерирует sw.js со списком всех файлов сборки — приложение работает офлайн */
function serviceWorker(): Plugin {
  return {
    name: 'supermind-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'))
      const assets = ['./', './index.html', ...files.map((f) => './' + f), './icon.svg', './icon-192.png', './icon-512.png', './manifest.webmanifest', './apple-touch-icon.png']
      const version = Date.now().toString(36)
      const code = `const CACHE = 'supermind-${version}';
const ASSETS = ${JSON.stringify([...new Set(assets)])};
// сначала файлы текущей версии, потом прошлых (их догружает ещё открытая вкладка старой версии)
const match = (req) => caches.open(CACHE).then((c) => c.match(req)).then((hit) => hit || caches.match(req));
self.addEventListener('install', (e) => {
  // reload — мимо HTTP-кэша браузера: логотип и манифест без хэша в имени, иначе закэшируется старый
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(ASSETS.map((a) => c.add(new Request(a, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // прошлые версии не удаляем сразу: открытая вкладка старой версии ещё догружает свои файлы (разделы, стили)
  // кэши других названий (2mind-… времён 2Mind) удаляем все: из них браузер брал старые логотип и манифест
  e.waitUntil(caches.keys().then((ks) => {
    const foreign = ks.filter((k) => !k.startsWith('supermind-'));
    const old = ks.filter((k) => k.startsWith('supermind-') && k !== CACHE);
    return Promise.all([...foreign, ...old.slice(0, Math.max(0, old.length - 2))].map((k) => caches.delete(k)));
  }).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', cp)); return r; }).catch(() => match('./index.html')));
    return;
  }
  e.respondWith(match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; })));
});
// напоминание с сервера (приложение может быть закрыто)
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { title: 'SuperMind', body: e.data ? e.data.text() : '' }; }
  const data = m.data || {};
  const tag = data.taskId ? data.taskId + '|' + (data.date || '') : data.habitId ? 'habit|' + data.habitId : undefined;
  e.waitUntil(self.registration.showNotification(m.title || 'SuperMind', {
    body: m.body || '',
    data,
    tag,
    renotify: !!tag,
    icon: './icon-192.png',
    badge: './icon-192.png',
    actions: data.taskId ? [{ action: 'done', title: '✓ Выполнено' }, { action: 'snooze', title: 'Отложить 10 мин' }] : [],
  }));
});
// нажатие на напоминание или кнопку в нём («Выполнено», «Отложить»)
self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  const data = n.data || {};
  const action = e.action || 'open';
  n.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs[0];
    if (c) {
      c.postMessage({ type: 'sm-notify', action, data });
      return action === 'open' && c.focus ? c.focus() : undefined;
    }
    const q = new URLSearchParams(Object.assign({}, ...Object.keys(data).map((k) => ({ [k]: String(data[k]) })), { task: data.taskId || '', sm: '1', action }));
    return self.clients.openWindow('./?' + q.toString());
  }));
});
`
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code })
    },
  }
}

// base './' — работает и на GitHub Pages (подпапка), и в APK (Capacitor)
export default defineConfig({
  base: './',
  // IPv4: эмулятор Android подключается через adb reverse к 127.0.0.1
  server: { host: '127.0.0.1' },
  plugins: [react(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
