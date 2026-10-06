import { create } from 'zustand';
import type { Settings } from '../types';
import { DEFAULT_SETTINGS, saveSettings } from './db';

export type View = 'home' | 'editor' | 'board' | 'planner' | 'settings' | 'tasks' | 'calendar' | 'focus';

interface AppState {
  view: View;
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
const RESTORABLE: View[] = ['home', 'tasks', 'calendar', 'planner', 'board', 'focus', 'settings'];
function initialView(): View {
  try {
    const v = localStorage.getItem('sm-view') as View | null;
    return v && RESTORABLE.includes(v) ? v : 'home';
  } catch {
    return 'home';
  }
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useApp = create<AppState>((set, get) => ({
  view: initialView(),
  settings: DEFAULT_SETTINGS,
  toast: null,
  toastAction: null,
  docsVersion: 0,
  go(view) {
    set({ view });
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
  },
  showToast(msg, action) {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg, toastAction: action ?? null });
    toastTimer = setTimeout(() => set({ toast: null, toastAction: null }), action ? 6000 : 2600);
  },
}));

export const toast = (msg: string, action?: { label: string; run: () => void }) => useApp.getState().showToast(msg, action);
