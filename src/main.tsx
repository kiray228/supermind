import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { setupPlatform } from './platform';
import { mark, reportPerf } from './perf';
import { installErrorReporting } from './ui/errorReport';
import { APP_VERSION } from './store/safety';

mark('main');
// тестовая сборка для симулятора/эмулятора (CI): без входа и приветствий, затем самопроверка
const SELFTEST = import.meta.env.VITE_SELFTEST === '1';
if (SELFTEST) {
  try {
    localStorage.setItem('sm-local-only', '1');
    localStorage.setItem('sm-onboarded', String(Date.now() - 30 * 86_400_000));
    localStorage.setItem('sm-whatsnew', APP_VERSION);
    localStorage.setItem('sm-firststeps-hidden', '1');
    if (!localStorage.getItem('sm-selftest-seed')) localStorage.setItem('sm-view', 'today');
  } catch {
    /* хранилище недоступно — проверка покажет экран входа */
  }
}
// ошибки — в журнал для диагностики и (если не выключено) в отчёты владельцу
installErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

setupPlatform();
reportPerf();
if (SELFTEST) void import('./selftest/run').then((m) => m.runSelfTest());

// приложение обновилось, пока было открыто: файлы раздела старой версии уже не найти — перезагрузиться один раз
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('sm-reload-at')) || 0;
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem('sm-reload-at', String(Date.now()));
  } catch {
    /* без хранилища — просто перезагрузка */
  }
  e.preventDefault();
  location.reload();
});

// Отладка (только в режиме разработки): доступ к состоянию из консоли и автотестов
if (import.meta.env.DEV) {
  Promise.all([import('./store/docStore'), import('./store/appStore'), import('./actions'), import('./templates'), import('./tasks/store'), import('./tasks/sync'), import('./store/cloud')]).then(([doc, app, actions, templates, tasks, sync, cloud]) => {
    (window as unknown as Record<string, unknown>).__supermind = { doc, app, actions, templates, tasks, sync, cloud };
  });
}
