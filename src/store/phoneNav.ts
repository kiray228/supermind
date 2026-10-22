/** Телефон: вкладки нижней панели и к какой вкладке относится раздел (без зависимостей — проверяется тестами) */
import type { View } from './appStore';

/** Вкладки нижней панели телефона: Сегодня · Карты · (микрофон) · Мозг · Ещё */
export type PhoneTab = 'today' | 'home' | 'notes' | 'more';
/** К какой вкладке телефона относится раздел (подсветка панели и «назад») */
export function phoneTab(v: View): PhoneTab {
  if (v === 'today' || v === 'tasks' || v === 'calendar' || v === 'habits' || v === 'focus' || v === 'planner') return 'today';
  if (v === 'home' || v === 'editor') return 'home';
  if (v === 'notes' || v === 'goals') return 'notes';
  return 'more';
}
export const isPhoneTab = (v: View): v is PhoneTab => v === 'today' || v === 'home' || v === 'notes' || v === 'more';

/**
 * Вкладка, к которой ведёт «назад» после перехода cur → view: раздел внутри вкладки помнит, откуда пришли
 * (Финансы с «Сегодня» — назад на «Сегодня»); переход между разделами внутри вкладки её не меняет.
 */
export function nextBackTab(cur: View, view: View, prev: PhoneTab | null): PhoneTab | null {
  if (isPhoneTab(view)) return null;
  if (isPhoneTab(cur)) return cur;
  if (cur === 'editor') return prev ?? 'home';
  return prev;
}
