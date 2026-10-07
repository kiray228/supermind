/** Состояние окна поиска (отдельно от компонентов — для быстрого обновления в разработке) */
import { create } from 'zustand';
import { primeKeyboard } from '../ui/keyboard';

interface SearchUi {
  open: boolean;
  /** начальный текст запроса (например, «>» — сразу команды) */
  initial: string;
  /** окно новой цели (поверх раздела «Цели») */
  newGoal: boolean;
}

export const useSearchUi = create<SearchUi>(() => ({ open: false, initial: '', newGoal: false }));

/** Открыть поиск. Вызывать прямо в обработчике нажатия — на iPhone сразу откроется клавиатура */
export function openSearch(initial = '') {
  primeKeyboard();
  useSearchUi.setState({ open: true, initial });
}

export function closeSearch() {
  useSearchUi.setState({ open: false });
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SEARCH_KBD = isMac ? '⌘K' : 'Ctrl K';
