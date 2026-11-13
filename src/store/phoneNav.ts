/**
 * Телефон: вкладки нижней панели и к какой вкладке относится раздел (без зависимостей — проверяется тестами).
 * Панель: три раздела на выбор пользователя · (микрофон посередине) · «Ещё» (всегда последняя).
 */
import type { View } from './appStore';

/** Разделы, которые можно поставить в нижнюю панель. «Сегодня» и «Мозг» — блоки: в них сразу несколько функций */
export type TabBlock = 'today' | 'home' | 'notes' | 'tasks' | 'calendar' | 'habits' | 'health' | 'finance' | 'goals' | 'focus' | 'assistant' | 'progress';
export type PhoneTab = TabBlock | 'more';

export const TAB_BLOCKS: TabBlock[] = ['today', 'home', 'notes', 'tasks', 'calendar', 'habits', 'health', 'finance', 'goals', 'focus', 'assistant', 'progress'];
/** Сколько разделов выбирает пользователь (плюс микрофон и «Ещё») */
export const TAB_SLOTS = 3;
export const DEFAULT_TABS: TabBlock[] = ['today', 'home', 'notes'];

/** Подписи: на вкладке — коротко; title — над кнопкой «назад» и в настройке панели */
export const TAB_INFO: Record<PhoneTab, { label: string; title: string; hint: string }> = {
  today: { label: 'Сегодня', title: 'Сегодня', hint: 'Задачи, привычки, календарь и траты дня' },
  home: { label: 'Карты', title: 'Карты', hint: 'Интеллект-карты' },
  notes: { label: 'Мозг', title: 'Второй мозг', hint: 'Заметки, цели, карточки, граф связей' },
  tasks: { label: 'Задачи', title: 'Задачи', hint: 'Все задачи и списки' },
  calendar: { label: 'Календарь', title: 'Календарь', hint: 'События, задачи и привычки по дням' },
  habits: { label: 'Привычки', title: 'Привычки', hint: 'Привычки, настроение и дневник' },
  health: { label: 'Здоровье', title: 'Здоровье и спорт', hint: 'Спорт, сон, вода и здоровые привычки' },
  finance: { label: 'Финансы', title: 'Финансы', hint: 'Счета, бюджет и траты' },
  goals: { label: 'Цели', title: 'Цели', hint: 'Цели, этапы и накопления' },
  focus: { label: 'Фокус', title: 'Фокус', hint: 'Помодоро, секундомер, отсчёты' },
  assistant: { label: 'ИИ', title: 'ИИ-ассистент', hint: 'Сводка дня и чат' },
  progress: { label: 'Прогресс', title: 'Прогресс', hint: 'Уровень, серия, достижения' },
  more: { label: 'Ещё', title: 'Ещё', hint: 'Остальные разделы и настройки' },
};

const isBlock = (x: unknown): x is TabBlock => typeof x === 'string' && (TAB_BLOCKS as string[]).includes(x);

/** Ровно TAB_SLOTS разных разделов: неизвестное и повторы — убрать, не хватает — дополнить по умолчанию */
export function normTabs(x: unknown): TabBlock[] {
  const out: TabBlock[] = [];
  for (const t of Array.isArray(x) ? x : []) if (isBlock(t) && !out.includes(t)) out.push(t);
  for (const t of [...DEFAULT_TABS, ...TAB_BLOCKS]) {
    if (out.length >= TAB_SLOTS) break;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, TAB_SLOTS);
}

/** Разделы блока «Сегодня» (если сами не стоят в панели) */
const TODAY_PARTS: View[] = ['tasks', 'calendar', 'habits', 'focus', 'planner'];

/** К какой вкладке телефона относится раздел (подсветка панели и «назад») */
export function phoneTab(v: View, tabs: TabBlock[] = DEFAULT_TABS): PhoneTab {
  const w: View = v === 'planner' ? 'habits' : v === 'editor' ? 'home' : v;
  if ((tabs as View[]).includes(w)) return w as TabBlock;
  if (TODAY_PARTS.includes(w) && tabs.includes('today')) return 'today';
  if (w === 'goals' && tabs.includes('notes')) return 'notes';
  return 'more';
}
export const isPhoneTab = (v: View, tabs: TabBlock[] = DEFAULT_TABS): v is PhoneTab => v === 'more' || (tabs as View[]).includes(v);

/**
 * Вкладка, к которой ведёт «назад» после перехода cur → view: раздел внутри вкладки помнит, откуда пришли
 * (Финансы с «Сегодня» — назад на «Сегодня»); переход между разделами внутри вкладки её не меняет.
 */
export function nextBackTab(cur: View, view: View, prev: PhoneTab | null, tabs: TabBlock[] = DEFAULT_TABS): PhoneTab | null {
  if (isPhoneTab(view, tabs)) return null;
  if (isPhoneTab(cur, tabs)) return cur;
  if (cur === 'editor') return prev ?? phoneTab('editor', tabs);
  return prev;
}

/** Разделы для «Ещё»: всё, чего нет в панели (по порядку каталога) */
export const moreBlocks = (tabs: TabBlock[]): TabBlock[] => TAB_BLOCKS.filter((t) => !tabs.includes(t));

/**
 * Панель по ответу «что для вас важно» при первом запуске: «Сегодня» первым,
 * затем выбранное (в порядке выбора), остальное — по умолчанию.
 */
export function tabsFromInterests(picked: TabBlock[]): TabBlock[] {
  return normTabs(['today', ...picked.filter((t) => t !== 'today')]);
}
