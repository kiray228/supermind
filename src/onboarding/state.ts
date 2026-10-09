/** Состояние окна «Что нового» (лёгкий модуль — его подключают Настройки) */
import { create } from 'zustand';

export const WHATSNEW_KEY = 'sm-whatsnew';
export const ONBOARDED_KEY = 'sm-onboarded';

interface WhatsNewState {
  /** null — закрыто; 'auto' — после обновления; 'all' — вся история */
  open: null | 'auto' | 'all';
  /** последняя просмотренная версия (для 'auto') */
  since: string | null;
}

export const useWhatsNew = create<WhatsNewState>(() => ({ open: null, since: null }));

/** Открыть «Что нового» со всей историей версий */
export function openWhatsNew() {
  useWhatsNew.setState({ open: 'all', since: null });
}

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* хранилище недоступно */
  }
}

const LAST_OPEN_KEY = 'sm-last-open';
/** через сколько дней без приложения показывать окно */
export const AWAY_DAYS = 3;

/** Сколько дней приложение не открывали (и отметить сегодняшний день) */
export function touchLastOpen(): number {
  const n = new Date();
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  const prev = lsGet(LAST_OPEN_KEY);
  if (prev !== today) lsSet(LAST_OPEN_KEY, today);
  if (!prev || !/^\d{4}-\d{2}-\d{2}$/.test(prev) || prev >= today) return 0;
  const [a, b] = [prev, today].map((d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}
