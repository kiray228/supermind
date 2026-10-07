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
