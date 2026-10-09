/**
 * Итоги недели: что сохранено, черновики ответов и «скрыть карточку» — только на этом устройстве.
 * Сами итоги уходят в дневник воскресенья и в задачи (они синхронизируются как обычно).
 */
import type { PlannerDay } from '../types';
import { loadPlanner, savePlanner } from '../store/db';
import { addDaysYmd, toYmd } from '../utils/mapTasks';
import { mondayOf } from '../habits/model';
import type { ReviewAnswers } from './weekly';

const SAVED_KEY = 'sm-weekly-saved';
const DRAFT_KEY = 'sm-weekly-draft:';
const DISMISS_KEY = 'sm-weekly-dismissed';

export interface SavedWeek {
  /** текст, дописанный в дневник (чтобы при повторном сохранении заменить его, а не дублировать) */
  text?: string;
  /** задачи, уже созданные на следующий понедельник */
  tasks?: string[];
  at?: number;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* хранилище недоступно — без памяти */
  }
}

export function savedWeek(monday: string): SavedWeek | null {
  return readJson<Record<string, SavedWeek>>(SAVED_KEY, {})[monday] ?? null;
}

export function markSaved(monday: string, patch: SavedWeek) {
  const all = readJson<Record<string, SavedWeek>>(SAVED_KEY, {});
  all[monday] = { ...all[monday], ...patch, at: Date.now() };
  // храним последние 12 недель
  const keys = Object.keys(all).sort().reverse();
  for (const k of keys.slice(12)) delete all[k];
  writeJson(SAVED_KEY, all);
}

export function readDraft(monday: string): ReviewAnswers {
  const d = readJson<Partial<ReviewAnswers>>(DRAFT_KEY + monday, {});
  return { good: String(d.good ?? ''), bad: String(d.bad ?? ''), next: String(d.next ?? '') };
}

export function writeDraft(monday: string, a: ReviewAnswers) {
  try {
    if (!a.good.trim() && !a.bad.trim() && !a.next.trim()) localStorage.removeItem(DRAFT_KEY + monday);
    else writeJson(DRAFT_KEY + monday, a);
  } catch {
    /* без черновика */
  }
}

export const isDismissed = (monday: string) => {
  try {
    return localStorage.getItem(DISMISS_KEY) === monday;
  } catch {
    return false;
  }
};

export function dismiss(monday: string) {
  try {
    localStorage.setItem(DISMISS_KEY, monday);
  } catch {
    /* не страшно */
  }
}

/** Неделя, итоги которой пора подвести: воскресенье после 17:00 — текущая, понедельник — прошедшая */
export function reviewDueMonday(now = new Date()): string | null {
  const today = toYmd(now);
  if (now.getDay() === 0 && now.getHours() >= 17) return mondayOf(today);
  if (now.getDay() === 1) return addDaysYmd(mondayOf(today), -7);
  return null;
}

/**
 * Дописать итоги в дневник дня (не затирая записи). Если в дневнике уже есть прошлый вариант
 * этих итогов (`prev`) — он заменяется новым.
 */
export async function appendJournal(ymd: string, text: string, prev?: string): Promise<void> {
  const p = await loadPlanner();
  const days = { ...(p.days ?? {}) };
  const day: PlannerDay = { ...(days[ymd] ?? { journal: '', tasks: [] }) };
  const cur = typeof day.journal === 'string' ? day.journal : '';
  if (cur.includes(text)) return;
  if (prev && cur.includes(prev)) day.journal = cur.replace(prev, () => text);
  else day.journal = cur.trim() ? `${cur.trimEnd()}\n\n${text}` : text;
  days[ymd] = day;
  await savePlanner({ ...p, days, habits: p.habits ?? [] });
  window.dispatchEvent(new Event('sm-planner-changed'));
}
