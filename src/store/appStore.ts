import { create } from 'zustand';
import type { Settings } from '../types';
import { DEFAULT_SETTINGS, saveSettings } from './db';

export type View = 'home' | 'editor' | 'board' | 'planner' | 'settings' | 'tasks' | 'calendar' | 'focus';

interface AppState {
  view: View;
  settings: Settings;
  toast: string | null;
  /** меняется, когда список документов обновлён извне */
  docsVersion: number;
  go(view: View): void;
  setSettings(patch: Partial<Settings>): void;
  showToast(msg: string): void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useApp = create<AppState>((set, get) => ({
  view: 'home',
  settings: DEFAULT_SETTINGS,
  toast: null,
  docsVersion: 0,
  go(view) {
    set({ view });
  },
  setSettings(patch) {
    const s = { ...get().settings, ...patch };
    set({ settings: s });
    saveSettings(s);
  },
  showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
}));

export const toast = (msg: string) => useApp.getState().showToast(msg);
