import { create } from 'zustand';
import type { Settings } from '../types';
import { DEFAULT_SETTINGS, saveSettings } from './db';
import { shareSettings } from './sharedPrefs';

export type View = 'today' | 'more' | 'home' | 'editor' | 'board' | 'planner' | 'settings' | 'tasks' | 'calendar' | 'focus' | 'notes' | 'goals' | 'finance' | 'assistant' | 'progress' | 'habits';

export { phoneTab, isPhoneTab, type PhoneTab } from './phoneNav';
import { nextBackTab, type PhoneTab } from './phoneNav';

interface AppState {
  view: View;
  /** телефон: вкладка, с которой открыли раздел (Финансы с «Сегодня» — назад на «Сегодня») */
  backTab: PhoneTab | null;
  settings: Settings;
  toast: string | null;
  /** кнопка в уведомлении («Отменить») */
  toastAction: { label: string; run: () => void } | null;
  /** меняется, когда список документов обновлён извне */
  docsVersion: number;
  go(view: View): void;
  setSettings(patch: Partial<Settings>): void;
  showToast(msg: string, action?: { label: string; run: () => void }): void;
}

/** последний открытый раздел — приложение открывается там, где закончили */
const RESTORABLE: View[] = ['today', 'more', 'home', 'tasks', 'calendar', 'planner', 'board', 'focus', 'settings', 'notes', 'goals', 'finance', 'assistant', 'progress', 'habits'];
function initialView(): View {
  try {
    const v = localStorage.getItem('sm-view') as View | null;
    if (v === 'planner') return 'habits';
    // первый запуск — с экрана дня
    return v && RESTORABLE.includes(v) ? v : 'today';
  } catch {
    return 'today';
  }
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function cachedTheme(): Settings['theme'] {
  try {
    const t = localStorage.getItem('sm-theme');
    return t === 'dark' || t === 'light' || t === 'system' ? t : DEFAULT_SETTINGS.theme;
  } catch {
    return DEFAULT_SETTINGS.theme;
  }
}

export const useApp = create<AppState>((set, get) => ({
  view: initialView(),
  backTab: null,
  // тема — сразу из прошлого запуска (настройки читаются из базы позже, иначе мелькнула бы другая тема)
  settings: { ...DEFAULT_SETTINGS, theme: cachedTheme() },
  toast: null,
  toastAction: null,
  docsVersion: 0,
  go(view) {
    // Ежедневник заменён разделом «Привычки» (дневник и настроение — там же)
    if (view === 'planner') view = 'habits';
    const cur = get().view;
    const backTab = nextBackTab(cur, view, get().backTab);
    set({ view, backTab });
    try {
      if (RESTORABLE.includes(view)) localStorage.setItem('sm-view', view);
    } catch {
      /* хранилище недоступно */
    }
  },
  setSettings(patch) {
    const s = { ...get().settings, ...patch };
    set({ settings: s });
    saveSettings(s);
    void shareSettings(patch);
  },
  showToast(msg, action) {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg, toastAction: action ?? null });
    toastTimer = setTimeout(() => set({ toast: null, toastAction: null }), action ? 6000 : 2600);
  },
}));

export const toast = (msg: string, action?: { label: string; run: () => void }) => useApp.getState().showToast(msg, action);

/** Сообщение под мышью или в фокусе — не исчезает (успеть нажать «Отменить»); ушли — ещё немного */
export function holdToast(hold: boolean) {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  if (!hold && useApp.getState().toast) toastTimer = setTimeout(() => useApp.setState({ toast: null, toastAction: null }), 2500);
}
