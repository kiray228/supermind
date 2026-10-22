import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { holdToast, isPhoneTab, phoneTab, useApp, type PhoneTab, type View } from './store/appStore';
import { listDocs, loadSettings, saveDoc } from './store/db';
import { get as idbGet, set as idbSet } from './store/kv';
import { welcomeDoc } from './templates';
import { DialogHost, closeTopOverlay } from './ui/dialogs';
import { installFocusManager } from './ui/focusManager';
import { AuthGate } from './ui/AuthGate';
import Home from './views/Home';
import { flushSave } from './store/docStore';
import { ensureTasks, flushTasks, useTasks } from './tasks/store';
import { UpdateBanner } from './ui/UpdateBanner';
import { initAppUpdates } from './ui/appUpdate';
import { isActive } from './tasks/model';
import { todayYmd } from './utils/mapTasks';
import { SearchHost, SearchNavButton } from './search/SearchHost';
import { applyAppearance } from './ui/appearance';
import { initLargeTitles } from './ui/navbar';
import { VoiceFab, VoiceNavButton } from './voice/VoiceButton';
import { SyncDot, SyncNavButton } from './ui/SyncBadge';
import { useVoice } from './voice/state';
import { SectionIcon, type SectionId } from './ui/icons';
import { Brain, CaretLeft, DotsThreeCircle, Graph, SunHorizon, type Icon } from '@phosphor-icons/react';
import './ui/appearance.css';
import './app.css';
import { mark, whenIdle } from './perf';
import { initLock } from './ui/lock';
import { LockScreen } from './ui/LockScreen';
import { ViewBoundary } from './ui/ViewBoundary';

// код-пароль — до первой отрисовки: содержимое не мелькнёт перед экраном блокировки
initLock();

const Today = lazy(() => import('./views/Today'));
const More = lazy(() => import('./views/More'));
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
const SupportHost = lazy(() => import('./ui/Support').then((m) => ({ default: m.SupportHost })));
const ReminderStack = lazy(() => import('./tasks/ui/Reminders').then((m) => ({ default: m.ReminderStack })));

/** Широкий экран (боковая панель видна целиком) */
const WIDE = '(min-width: 761px)';
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isWide = () => window.matchMedia(WIDE).matches;

/** Боковая панель компьютера: все разделы */
const NAV: { id: Extract<View, SectionId>; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'home', label: 'Карты' },
  { id: 'tasks', label: 'Задачи' },
  { id: 'calendar', label: 'Календарь' },
  { id: 'habits', label: 'Привычки' },
  { id: 'assistant', label: 'Ассистент' },
  { id: 'notes', label: 'Заметки' },
  { id: 'goals', label: 'Цели' },
  { id: 'finance', label: 'Финансы' },
  { id: 'progress', label: 'Прогресс' },
  { id: 'focus', label: 'Фокус' },
  { id: 'board', label: 'Доска' },
  { id: 'settings', label: 'Настройки' },
];

/** Панель вкладок телефона: Сегодня · Карты · (микрофон) · Мозг · Ещё */
const PHONE_TABS: { id: PhoneTab; label: string; icon: Icon }[] = [
  { id: 'today', label: 'Сегодня', icon: SunHorizon },
  { id: 'home', label: 'Карты', icon: Graph },
  { id: 'notes', label: 'Мозг', icon: Brain },
  { id: 'more', label: 'Ещё', icon: DotsThreeCircle },
];
const TAB_TITLE: Record<PhoneTab, string> = { today: 'Сегодня', home: 'Карты', notes: 'Второй мозг', more: 'Ещё' };

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
  const [deferred, setDeferred] = useState(deferredStarted);
  const wide = useSyncExternalStore(subscribeWide, isWide);
  const taskOpen = useTasks((s) => !!s.openTaskId);
  const quickAdd = useTasks((s) => !!s.quickAdd);
  const backTab = useApp((s) => s.backTab);
  const tab = backTab ?? phoneTab(view);
  const todayCount = useTasks((s) => {
    const t = todayYmd();
    return s.data ? s.data.tasks.filter((x) => isActive(x) && !!x.date && x.date <= t).length : 0;
  });

  useEffect(() => {
    mark('app-mounted');
    installFocusManager();
    initLargeTitles();
    loadSettings()
      .then((s) => useApp.setState({ settings: s }))
      // общие настройки с других устройств (тема, цвет, модель ИИ…)
      .then(() => import('./store/sharedPrefs'))
      .then((m) => m.initSharedPrefs())
      .catch(() => {});
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
      // работа ИИ, отложенная без связи (пересказ статьи, разбор голосовой мысли)
      void import('./notes/aiQueue').then((m) => m.initAiQueue()).catch(() => {});
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
    // новая версия: сайт — «Обновить», Android с APK — «Скачать» (Play и iPhone обновляет магазин)
    initAppUpdates();
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
      // для следующего запуска: index.html ставит тему до загрузки приложения (без вспышки другой темы)
      try {
        localStorage.setItem('sm-theme', theme);
      } catch {
        /* хранилище недоступно */
      }
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
            <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => go(n.id)} aria-current={view === n.id ? 'page' : undefined}>
              <span className="nav-ico">
                <SectionIcon section={n.id} size={24} weight={view === n.id ? 'fill' : 'regular'} />
                {n.id === 'tasks' && todayCount > 0 && <i className="nav-badge">{todayCount > 99 ? '99+' : todayCount}</i>}
              </span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      )}
      {view !== 'editor' && !wide && (
        <nav className="tabbar" aria-label="Разделы">
          {PHONE_TABS.map((t, i) => (
            <PhoneTabButton key={t.id} t={t} active={tab === t.id} badge={t.id === 'today' ? todayCount : 0} sync={t.id === 'more'} onClick={() => go(t.id)} after={i === 1 ? <VoiceFab /> : null} />
          ))}
        </nav>
      )}
      {/* раздел внутри вкладки (задачи, финансы, цели…) — назад к вкладке */}
      {view !== 'editor' && !wide && !isPhoneTab(view) && (
        <button className="phone-back" onClick={() => go(tab)}>
          <CaretLeft size={17} weight="bold" />
          {TAB_TITLE[tab]}
        </button>
      )}
      <main className="app-main">
        <ViewBoundary key={view}>
        <Suspense fallback={<div className="loading"><div className="spinner" /></div>}>
          {view === 'today' && <Today />}
          {view === 'more' && <More />}
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
        </ViewBoundary>
      </main>
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
      {deferred && (
        <Suspense fallback={null}>
          <SupportHost />
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
      <LockScreen />
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
      {/* объявление для экранного диктора — область всегда на месте, меняется только текст */}
      <div className="sr-only" role="status" aria-live="polite">
        {toastMsg ?? ''}
      </div>
      {/* в редакторе не мешает: появится, когда выйдете к списку */}
      {view !== 'editor' && <UpdateBanner />}
      {toastMsg && (
        <div className={`toast${toastAction ? ' has-action' : ''}`} onMouseEnter={() => holdToast(true)} onMouseLeave={() => holdToast(false)} onFocus={() => holdToast(true)} onBlur={() => holdToast(false)}>
          <span aria-hidden="true">{toastMsg}</span>
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

function PhoneTabButton({ t, active, badge, sync, onClick, after }: { t: (typeof PHONE_TABS)[number]; active: boolean; badge: number; sync: boolean; onClick: () => void; after: ReactNode }) {
  const I = t.icon;
  return (
    <>
      <button className={`tab-item${active ? ' active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
        <span className="nav-ico">
          <I size={26} weight={active ? 'fill' : 'regular'} />
          {badge > 0 && <i className="nav-badge">{badge > 99 ? '99+' : badge}</i>}
          {sync && <SyncDot />}
        </span>
        <span>{t.label}</span>
      </button>
      {after}
    </>
  );
}
