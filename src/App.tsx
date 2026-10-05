import { lazy, Suspense, useEffect } from 'react';
import { Network, KanbanSquare, CalendarDays, Settings as SettingsIcon } from 'lucide-react';
import { useApp, type View } from './store/appStore';
import { listDocs, loadSettings, saveDoc } from './store/db';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { welcomeDoc } from './templates';
import { DialogHost, closeTopOverlay } from './ui/dialogs';
import Home from './views/Home';
import { flushSave } from './store/docStore';
import './app.css';

const Editor = lazy(() => import('./editor/Editor'));
const Board = lazy(() => import('./views/Board'));
const Planner = lazy(() => import('./views/Planner'));
const Settings = lazy(() => import('./views/Settings'));

const NAV: { id: View; label: string; icon: typeof Network }[] = [
  { id: 'home', label: 'Карты', icon: Network },
  { id: 'board', label: 'Задачи', icon: KanbanSquare },
  { id: 'planner', label: 'Ежедневник', icon: CalendarDays },
  { id: 'settings', label: 'Настройки', icon: SettingsIcon },
];

let welcomeStarted = false;

export default function App() {
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const theme = useApp((s) => s.settings.theme);
  const toastMsg = useApp((s) => s.toast);

  useEffect(() => {
    loadSettings().then((s) => useApp.setState({ settings: s }));
    // первая карта-подсказка при первом запуске
    if (!welcomeStarted) (welcomeStarted = true) && (async () => {
      if (await idbGet('welcomed')) return;
      await idbSet('welcomed', true);
      if ((await listDocs()).length) return;
      await saveDoc(welcomeDoc());
      useApp.setState({ docsVersion: Date.now() });
    })();
    // заранее подгружаем редактор и разделы, чтобы карта открывалась мгновенно
    const preload = setTimeout(() => {
      import('./editor/Editor');
      import('./views/Board');
      import('./views/Planner');
    }, 800);
    // Escape закрывает верхнее окно или меню
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeTopOverlay()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onEsc, true);
    const save = () => void flushSave();
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => {
      clearTimeout(preload);
      window.removeEventListener('keydown', onEsc, true);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', save);
    };
  }, []);

  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#17191e' : '#ffffff');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // кнопка «назад» на Android
  useEffect(() => {
    history.replaceState({ view }, '');
  }, [view]);

  return (
    <div className="app">
      {view !== 'editor' && (
        <nav className="sidebar">
          <div className="brand">
            <img src="./icon.svg" alt="" width={30} height={30} />
            <span>SuperMind</span>
          </div>
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
              <n.icon size={20} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      )}
      <main className="app-main">
        <Suspense fallback={<div className="loading"><div className="spinner" /></div>}>
          {view === 'home' && <Home />}
          {view === 'editor' && <Editor />}
          {view === 'board' && <Board />}
          {view === 'planner' && <Planner />}
          {view === 'settings' && <Settings />}
        </Suspense>
      </main>
      <DialogHost />
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
