import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { useApp, type View } from './store/appStore';
import { listDocs, loadSettings, saveDoc } from './store/db';
import { get as idbGet, set as idbSet } from './store/kv';
import { welcomeDoc } from './templates';
import { DialogHost, closeTopOverlay } from './ui/dialogs';
import { AuthGate } from './ui/AuthGate';
import Home from './views/Home';
import { flushSave } from './store/docStore';
import { ensureTasks, flushTasks, useTasks } from './tasks/store';
import { isActive } from './tasks/model';
import { todayYmd } from './utils/mapTasks';
import { SearchHost, SearchNavButton, SearchSheetButton } from './search/SearchHost';
import { applyAppearance } from './ui/appearance';
import { initLargeTitles } from './ui/navbar';
import { VoiceFab, VoiceNavButton } from './voice/VoiceButton';
import { SyncDot, SyncNavButton, SyncSheetRow } from './ui/SyncBadge';
import { useVoice } from './voice/state';
import { IconTile, SectionIcon, type SectionId } from './ui/icons';
import './ui/appearance.css';
import './app.css';
import { mark, whenIdle } from './perf';

const Editor = lazy(() => import('./editor/Editor'));
const Board = lazy(() => import('./views/Board'));
const Planner = lazy(() => import('./views/Planner'));
const Habits = lazy(() => import('./views/Habits'));
const Settings = lazy(() => import('./views/Settings'));
const Tasks = lazy(() => import('./views/Tasks'));
const Calendar = lazy(() => import('./views/Calendar'));
const Focus = lazy(() => import('./views/Focus'));
const Notes = lazy(() => import('./views/Notes'));
const Goals = lazy(() => import('./views/Goals'));
const Finance = lazy(() => import('./views/Finance'));
const Assistant = lazy(() => import('./views/Assistant'));
const Progress = lazy(() => import('./views/Progress'));
const LevelBadge = lazy(() => import('./progress/LevelBadge').then((m) => ({ default: m.LevelBadge })));
const VoiceHost = lazy(() => import('./voice/VoiceSheet'));
const OnboardingHost = lazy(() => import('./onboarding/OnboardingHost'));
// поздравления с уровнем, достижениями и серией — в любом разделе
const ProgressWatcher = lazy(() => import('./progress/ProgressWatcher'));
// окна задач и напоминаний — отдельными модулями: при запуске не нужны
const TaskDetailHost = lazy(() => import('./tasks/ui/TaskDetail').then((m) => ({ default: m.TaskDetailHost })));
const QuickAddHost = lazy(() => import('./tasks/ui/QuickAdd').then((m) => ({ default: m.QuickAddHost })));
const ReminderStack = lazy(() => import('./tasks/ui/Reminders').then((m) => ({ default: m.ReminderStack })));

/** Широкий экран (боковая панель видна целиком) */
const WIDE = '(min-width: 761px)';
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isWide = () => window.matchMedia(WIDE).matches;

/** phone: false — на телефоне пункт в меню «Ещё» */
const NAV: { id: Extract<View, SectionId>; label: string; phone: boolean }[] = [
  { id: 'home', label: 'Карты', phone: true },
  { id: 'tasks', label: 'Задачи', phone: true },
  { id: 'calendar', label: 'Календарь', phone: true },
  { id: 'habits', label: 'Привычки', phone: true },
  { id: 'assistant', label: 'Ассистент', phone: false },
  { id: 'notes', label: 'Заметки', phone: false },
  { id: 'goals', label: 'Цели', phone: false },
  { id: 'finance', label: 'Финансы', phone: false },
  { id: 'progress', label: 'Прогресс', phone: false },
  { id: 'focus', label: 'Фокус', phone: false },
  { id: 'board', label: 'Доска', phone: false },
  { id: 'settings', label: 'Настройки', phone: false },
];

let welcomeStarted = false;
/** Второстепенное (напоминания, виджеты, push, таймер фокуса, окна задач) уже запущено — после первой отрисовки */
let deferredStarted = false;

export default function App() {
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const voiceOpen = useVoice((s) => s.open);
  const theme = useApp((s) => s.settings.theme);
  const accent = useApp((s) => s.settings.accent);
  const glass = useApp((s) => s.settings.glass);
  const backdrop = useApp((s) => s.settings.backdrop);
  useEffect(() => applyAppearance({ accent, glass, backdrop }), [accent, glass, backdrop]);
  const toastMsg = useApp((s) => s.toast);
  const toastAction = useApp((s) => s.toastAction);
  const [more, setMore] = useState(false);
  const [deferred, setDeferred] = useState(deferredStarted);
  const wide = useSyncExternalStore(subscribeWide, isWide);
  const taskOpen = useTasks((s) => !!s.openTaskId);
  const quickAdd = useTasks((s) => !!s.quickAdd);
  const moreActive = NAV.some((n) => !n.phone && n.id === view);
  const todayCount = useTasks((s) => {
    const t = todayYmd();
    return s.data ? s.data.tasks.filter((x) => isActive(x) && !!x.date && x.date <= t).length : 0;
  });

  useEffect(() => {
    mark('app-mounted');
    initLargeTitles();
    loadSettings().then((s) => useApp.setState({ settings: s }));
    // задачи (счётчик на вкладке «Задачи»)
    void ensureTasks();
    // аккаунт и синхронизация между устройствами (экран входа ждёт только чтения аккаунта)
    void import('./store/cloudWire').then((m) => m.setupCloud()).catch(() => {});
    // остальное — когда первый экран уже отрисован: не мешает запуску
    whenIdle(() => {
      if (deferredStarted) return;
      deferredStarted = true;
      mark('deferred');
      setDeferred(true);
      // напоминания, календарь телефона; push-напоминания (iPhone/веб); таймер фокуса; виджеты и «Поделиться»
      void ensureTasks()
        .then(() => import('./tasks/sync'))
        .then((m) => m.initTaskSync())
        .catch(() => {});
      void import('./store/push').then((m) => m.ensurePush()).catch(() => {});
      void import('./tasks/focusTimer').then((m) => m.initFocusTimer()).catch(() => {});
      void import('./native/widget').then((m) => m.initWidget()).catch(() => {});
    }, 1500);
    // первая карта-подсказка при первом запуске
    if (!welcomeStarted) {
      welcomeStarted = true;
      void (async () => {
        if (await idbGet('welcomed')) return;
        // отметка — только после сохранения карты: прерванный первый запуск не оставит пустой список
        if (!(await listDocs()).length) {
          await saveDoc(welcomeDoc());
          useApp.setState({ docsVersion: Date.now() });
        }
        await idbSet('welcomed', true);
      })();
    }
    // заранее подгружаем редактор и разделы, чтобы карта открывалась мгновенно (после запуска)
    const preload = setTimeout(() => {
      import('./editor/Editor');
      import('./views/Board');
      import('./views/Planner');
      import('./views/Tasks');
      import('./views/Calendar');
      import('./views/Habits');
    }, 2500);
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
      void import('./finance/store').then((m) => m.flushFinance()).catch(() => {});
      void import('./goals/store').then((m) => m.flushGoals()).catch(() => {});
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
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
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
          {/* значок уровня считает опыт по всем разделам — только на широком экране (на телефоне скрыт) и после запуска */}
          {wide && deferred && (
            <Suspense fallback={null}>
              <LevelBadge className="nav-level" />
            </Suspense>
          )}
          <SearchNavButton />
          <VoiceNavButton />
          {/* неотправленные в облако изменения — только когда есть повод */}
          <SyncNavButton />
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}${n.phone ? '' : ' nav-desk'}`} onClick={() => go(n.id)}>
              <span className="nav-ico">
                <SectionIcon section={n.id} size={24} weight={view === n.id ? 'fill' : 'regular'} />
                {n.id === 'tasks' && todayCount > 0 && <i className="nav-badge">{todayCount > 99 ? '99+' : todayCount}</i>}
              </span>
              <span>{n.label}</span>
            </button>
          ))}
          <button className={`nav-item nav-more ${moreActive ? 'active' : ''}`} onClick={() => setMore(true)}>
            <span className="nav-ico">
              <SectionIcon section="more" size={24} weight={moreActive ? 'fill' : 'regular'} />
              <SyncDot />
            </span>
            <span>Ещё</span>
          </button>
        </nav>
      )}
      {view !== 'editor' && <VoiceFab />}
      <main className="app-main">
        <Suspense fallback={<div className="loading"><div className="spinner" /></div>}>
          {view === 'home' && <Home />}
          {view === 'editor' && <Editor />}
          {view === 'board' && <Board />}
          {view === 'planner' && <Planner />}
          {view === 'habits' && <Habits />}
          {view === 'settings' && <Settings />}
          {view === 'tasks' && <Tasks />}
          {view === 'calendar' && <Calendar />}
          {view === 'focus' && <Focus />}
          {view === 'notes' && <Notes />}
          {view === 'goals' && <Goals />}
          {view === 'finance' && <Finance />}
          {view === 'assistant' && <Assistant />}
          {view === 'progress' && <Progress />}
        </Suspense>
      </main>
      {more && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className="modal nav-more-sheet" role="dialog" aria-label="Все разделы">
            <SearchSheetButton onPick={() => setMore(false)} />
            <SyncSheetRow onPick={() => setMore(false)} />
            <Suspense fallback={null}>
              <LevelBadge className="nav-sheet-level" onClick={() => (setMore(false), go('progress'))} />
            </Suspense>
            {NAV.filter((n) => !n.phone).map((n) => (
              <button
                key={n.id}
                className={`nav-sheet-item${view === n.id ? ' active' : ''}`}
                onClick={() => {
                  setMore(false);
                  go(n.id);
                }}
              >
                <IconTile section={n.id} size="lg" />
                <span>{n.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {taskOpen && (
        <Suspense fallback={null}>
          <TaskDetailHost />
        </Suspense>
      )}
      {/* окно быстрого добавления всегда в DOM (фокус на iPhone) — но после первой отрисовки */}
      {(deferred || quickAdd) && (
        <Suspense fallback={null}>
          <QuickAddHost />
        </Suspense>
      )}
      {deferred && (
        <Suspense fallback={null}>
          <ReminderStack />
        </Suspense>
      )}
      <SearchHost />
      {voiceOpen && (
        <Suspense fallback={null}>
          <VoiceHost />
        </Suspense>
      )}
      <AuthGate />
      <DialogHost />
      {deferred && (
        <Suspense fallback={null}>
          <OnboardingHost />
        </Suspense>
      )}
      {deferred && (
        <Suspense fallback={null}>
          <ProgressWatcher />
        </Suspense>
      )}
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
