import { lazy, Suspense, useEffect, useState } from 'react';
import { Network, KanbanSquare, Settings as SettingsIcon, CheckSquare, CalendarRange, Timer, Menu as MenuIcon, NotebookPen } from 'lucide-react';
import { useApp, type View } from './store/appStore';
import { listDocs, loadSettings, saveDoc } from './store/db';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { welcomeDoc } from './templates';
import { DialogHost, closeTopOverlay } from './ui/dialogs';
import Home from './views/Home';
import { flushSave } from './store/docStore';
import { ensureTasks, flushTasks, useTasks } from './tasks/store';
import { initTaskSync } from './tasks/sync';
import { isActive } from './tasks/model';
import { todayYmd } from './utils/mapTasks';
import { TaskDetailHost } from './tasks/ui/TaskDetail';
import { QuickAddHost } from './tasks/ui/QuickAdd';
import { ReminderStack } from './tasks/ui/Reminders';
import './app.css';

const Editor = lazy(() => import('./editor/Editor'));
const Board = lazy(() => import('./views/Board'));
const Planner = lazy(() => import('./views/Planner'));
const Settings = lazy(() => import('./views/Settings'));
const Tasks = lazy(() => import('./views/Tasks'));
const Calendar = lazy(() => import('./views/Calendar'));
const Focus = lazy(() => import('./views/Focus'));

/** phone: false — на телефоне пункт в меню «Ещё» */
const NAV: { id: View; label: string; icon: typeof Network; phone: boolean }[] = [
  { id: 'home', label: 'Карты', icon: Network, phone: true },
  { id: 'tasks', label: 'Задачи', icon: CheckSquare, phone: true },
  { id: 'calendar', label: 'Календарь', icon: CalendarRange, phone: true },
  { id: 'planner', label: 'Ежедневник', icon: NotebookPen, phone: true },
  { id: 'focus', label: 'Фокус', icon: Timer, phone: false },
  { id: 'board', label: 'Доска', icon: KanbanSquare, phone: false },
  { id: 'settings', label: 'Настройки', icon: SettingsIcon, phone: false },
];

let welcomeStarted = false;

export default function App() {
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const theme = useApp((s) => s.settings.theme);
  const toastMsg = useApp((s) => s.toast);
  const toastAction = useApp((s) => s.toastAction);
  const [more, setMore] = useState(false);
  const todayCount = useTasks((s) => {
    const t = todayYmd();
    return s.data ? s.data.tasks.filter((x) => isActive(x) && !!x.date && x.date <= t).length : 0;
  });

  useEffect(() => {
    loadSettings().then((s) => useApp.setState({ settings: s }));
    // задачи: загрузка, напоминания, календарь телефона, таймер фокуса
    void ensureTasks().then(() => initTaskSync());
    void import('./tasks/focusTimer').then((m) => m.initFocusTimer()).catch(() => {});
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
      import('./views/Tasks');
      import('./views/Calendar');
    }, 800);
    // Escape закрывает верхнее окно или меню
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeTopOverlay()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onEsc, true);
    const save = () => {
      void flushSave();
      void flushTasks();
    };
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
            <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}${n.phone ? '' : ' nav-desk'}`} onClick={() => go(n.id)}>
              <span className="nav-ico">
                <n.icon size={20} />
                {n.id === 'tasks' && todayCount > 0 && <i className="nav-badge">{todayCount > 99 ? '99+' : todayCount}</i>}
              </span>
              <span>{n.label}</span>
            </button>
          ))}
          <button className={`nav-item nav-more ${NAV.some((n) => !n.phone && n.id === view) ? 'active' : ''}`} onClick={() => setMore(true)}>
            <span className="nav-ico">
              <MenuIcon size={20} />
            </span>
            <span>Ещё</span>
          </button>
        </nav>
      )}
      <main className="app-main">
        <Suspense fallback={<div className="loading"><div className="spinner" /></div>}>
          {view === 'home' && <Home />}
          {view === 'editor' && <Editor />}
          {view === 'board' && <Board />}
          {view === 'planner' && <Planner />}
          {view === 'settings' && <Settings />}
          {view === 'tasks' && <Tasks />}
          {view === 'calendar' && <Calendar />}
          {view === 'focus' && <Focus />}
        </Suspense>
      </main>
      {more && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className="modal nav-more-sheet">
            {NAV.filter((n) => !n.phone).map((n) => (
              <button
                key={n.id}
                className={`nav-sheet-item${view === n.id ? ' active' : ''}`}
                onClick={() => {
                  setMore(false);
                  go(n.id);
                }}
              >
                <n.icon size={22} />
                <span>{n.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <TaskDetailHost />
      <QuickAddHost />
      <ReminderStack />
      <DialogHost />
      {toastMsg && (
        <div className={`toast${toastAction ? ' has-action' : ''}`}>
          <span>{toastMsg}</span>
          {toastAction && (
            <button
              className="toast-btn"
              onClick={() => {
                toastAction.run();
                useApp.setState({ toast: null, toastAction: null });
              }}
            >
              {toastAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
