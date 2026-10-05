import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { setupPlatform } from './platform';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

setupPlatform();

// Отладка (только в режиме разработки): доступ к состоянию из консоли и автотестов
if (import.meta.env.DEV) {
  Promise.all([import('./store/docStore'), import('./store/appStore'), import('./actions'), import('./templates'), import('./tasks/store'), import('./tasks/sync')]).then(([doc, app, actions, templates, tasks, sync]) => {
    (window as unknown as Record<string, unknown>).__supermind = { doc, app, actions, templates, tasks, sync };
  });
}
