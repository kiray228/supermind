import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { setupPlatform } from './platform';
import { mark, reportPerf } from './perf';

mark('main');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

setupPlatform();
reportPerf();

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
