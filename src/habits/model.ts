/**
 * Привычки: частота, счётчики, серии и статистика.
 * Только чистые функции — их используют Ежедневник, Календарь и напоминания.
 *
 * Совместимость: все новые поля привычки необязательны; привычка без `freq` — ежедневная,
 * без `target` — простая отметка. Выполнение дня хранится в PlannerDay.habits (как раньше),
 * счётчики — в PlannerDay.habitCounts; при достижении цели id попадает и в habits.
 */
import type { Habit, HabitFreq, HabitPart, PlannerData, PlannerDay } from '../types';
import { addDaysYmd, fromYmd, toYmd } from '../utils/mapTasks';

type Days = PlannerData['days'];

// ---------- Справочники ----------

export const PARTS: { id: HabitPart; label: string; icon: string }[] = [
  { id: 'morning', label: 'Утро', icon: '🌅' },
  { id: 'day', label: 'День', icon: '☀️' },
  { id: 'evening', label: 'Вечер', icon: '🌙' },
  { id: 'any', label: 'Любое время', icon: '🕐' },
];

export const HABIT_COLORS = ['#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#64748b'];

export const HABIT_EMOJIS = [
  '💧', '🏃', '🤸', '🧘', '📚', '✍️', '🥗', '🍎', '💊', '😴', '🚶', '🏋️', '🚴', '🏊', '🦷', '🧠',
  '🗣️', '🎧', '🎸', '🎨', '📝', '🎯', '📵', '💸', '🐷', '📞', '❤️', '🙏', '🌬️', '☀️', '🌙', '🔥',
];

/** Пн..Вс → номер дня недели JS (0 — воскресенье) */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const WD_SHORT_BY_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

// ---------- Поля привычки ----------

/** Не удалена и не в архиве */
export const isActiveHabit = (h: Habit) => !h.deleted && !h.archived;
export const activeHabits = (list: Habit[] | undefined) => (list ?? []).filter(isActiveHabit);

export function freqOf(h: Habit): HabitFreq {
  if (h.freq === 'weekdays' && h.days?.length) return 'weekdays';
  if (h.freq === 'weekly' && (h.perWeek ?? 0) > 0) return 'weekly';
  return 'daily';
}
export const perWeekOf = (h: Habit) => Math.min(7, Math.max(1, Math.round(h.perWeek ?? 3)));
export const targetOf = (h: Habit) => Math.max(1, Math.round(h.target ?? 1));
export const isCounter = (h: Habit) => targetOf(h) > 1;

const minutesOf = (t: string) => {
  const [hh, mm] = t.split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
};
const pad2 = (n: number) => String(n).padStart(2, '0');
export const timeOfMin = (m: number) => {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`;
};

/** Часть дня: заданная, иначе по времени, иначе «любое время» */
export function partOf(h: Pick<Habit, 'part' | 'time'>): HabitPart {
  if (h.part) return h.part;
  if (h.time) {
    const m = minutesOf(h.time);
    return m < 12 * 60 ? 'morning' : m < 17 * 60 ? 'day' : 'evening';
  }
  return 'any';
}

/** Время напоминания: отдельное, иначе время привычки (если напоминания не выключены) */
export function reminderTimeOf(h: Habit): string | undefined {
  if (h.remindOff) return undefined;
  return h.remind || h.time || undefined;
}

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

export function freqLabel(h: Habit): string {
  const f = freqOf(h);
  if (f === 'weekly') {
    const n = perWeekOf(h);
    return `${n} ${plural(n, ['раз', 'раза', 'раз'])} в неделю`;
  }
  if (f === 'weekdays') {
    const ds = [...new Set(h.days)].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
    if (ds.length === 7) return 'Каждый день';
    if (ds.length === 5 && ds.every((d) => d >= 1 && d <= 5)) return 'По будням';
    if (ds.length === 2 && ds.includes(0) && ds.includes(6)) return 'По выходным';
    return ds.map((d) => WD_SHORT_BY_DAY[d]).join(', ');
  }
  return 'Каждый день';
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** «07:00–07:15», «07:00» или '' */
export function timeRangeLabel(h: Habit): string {
  if (!h.time) return '';
  return h.duration ? `${h.time}–${timeOfMin(minutesOf(h.time) + h.duration)}` : h.time;
}

// ---------- Отметки ----------

/** Сколько раз выполнено за день (для простой отметки — 0 или 1) */
export function countOn(day: PlannerDay | undefined, h: Habit): number {
  const t = targetOf(h);
  const c = day?.habitCounts?.[h.id] ?? 0;
  if (day?.habits?.includes(h.id)) return Math.max(c, t);
  return Math.min(c, t > 1 ? 999 : 1);
}

export function doneOn(days: Days, h: Habit, ymd: string): boolean {
  const d = days[ymd];
  if (!d) return false;
  if (d.habits?.includes(h.id)) return true;
  const t = targetOf(h);
  return t > 1 && (d.habitCounts?.[h.id] ?? 0) >= t;
}

/** Новое значение счётчика за день; при достижении цели привычка считается выполненной */
export function withCount(day: PlannerDay, h: Habit, n: number): PlannerDay {
  const t = targetOf(h);
  const v = Math.max(0, Math.min(999, Math.round(n)));
  const out: PlannerDay = { ...day };
  const hs = (day.habits ?? []).filter((x) => x !== h.id);
  if (v >= t) hs.push(h.id);
  out.habits = hs;
  if (t > 1) {
    const counts = { ...(day.habitCounts ?? {}) };
    if (v > 0) counts[h.id] = v;
    else delete counts[h.id];
    if (Object.keys(counts).length) out.habitCounts = counts;
    else delete out.habitCounts;
  } else if (day.habitCounts?.[h.id] != null) {
    const counts = { ...day.habitCounts };
    delete counts[h.id];
    if (Object.keys(counts).length) out.habitCounts = counts;
    else delete out.habitCounts;
  }
  return out;
}

/** Отметить выполненной / снять отметку (счётчик — сразу до цели / в ноль) */
export function withDone(day: PlannerDay, h: Habit, done: boolean): PlannerDay {
  return withCount(day, h, done ? targetOf(h) : 0);
}

/** Убрать все отметки привычки за день */
export function withoutHabit(day: PlannerDay, id: string): PlannerDay {
  const out: PlannerDay = { ...day };
  if (day.habits?.includes(id)) out.habits = day.habits.filter((x) => x !== id);
  if (day.habitCounts?.[id] != null) {
    const counts = { ...day.habitCounts };
    delete counts[id];
    if (Object.keys(counts).length) out.habitCounts = counts;
    else delete out.habitCounts;
  }
  return out;
}

// ---------- Расписание ----------

export function mondayOf(ymd: string): string {
  return addDaysYmd(ymd, -((fromYmd(ymd).getDay() + 6) % 7));
}

/** Запланирована ли привычка на день недели (N раз в неделю — в любой день) */
export function scheduledOn(h: Habit, ymd: string): boolean {
  if (freqOf(h) !== 'weekdays') return true;
  return h.days!.includes(fromYmd(ymd).getDay());
}

/** Сколько дней недели (с понедельника) выполнено; `except` — не считать этот день */
export function weekCount(days: Days, h: Habit, ymd: string, except?: string): number {
  const mon = mondayOf(ymd);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDaysYmd(mon, i);
    if (d !== except && doneOn(days, h, d)) n++;
  }
  return n;
}

/**
 * Привычка «на этот день»: входит в план дня и в счёт «X из Y».
 * N раз в неделю — пока недельная цель не выполнена другими днями (или если отмечена в этот день).
 */
export function dueOn(days: Days, h: Habit, ymd: string): boolean {
  const f = freqOf(h);
  if (f === 'daily') return true;
  if (f === 'weekdays') return scheduledOn(h, ymd);
  return doneOn(days, h, ymd) || weekCount(days, h, ymd, ymd) < perWeekOf(h);
}

const createdYmd = (h: Habit) => (h.createdAt ? toYmd(new Date(h.createdAt)) : undefined);

/** Первый день с отметкой этой привычки */
export function firstMark(days: Days, h: Habit): string | undefined {
  let min: string | undefined;
  for (const [k, d] of Object.entries(days)) {
    if (d.habits?.includes(h.id) || (d.habitCounts?.[h.id] ?? 0) > 0) if (!min || k < min) min = k;
  }
  return min;
}

// ---------- Серии ----------

export interface Streak {
  n: number;
  unit: 'day' | 'week';
}

export const streakText = (s: Streak) =>
  s.unit === 'week' ? `${s.n} ${plural(s.n, ['неделя', 'недели', 'недель'])}` : `${s.n} ${plural(s.n, ['день', 'дня', 'дней'])}`;

/**
 * Текущая серия на дату `ymd`.
 * Ежедневно / по дням недели — подряд выполненные запланированные дни (незапланированные дни серию не рвут,
 * сам `ymd`, если ещё не отмечен, тоже). N раз в неделю — подряд недели с выполненной целью
 * (текущая неделя, пока цель не набрана, серию не рвёт).
 */
export function currentStreak(days: Days, h: Habit, ymd: string): Streak {
  if (freqOf(h) === 'weekly') {
    const per = perWeekOf(h);
    let w = mondayOf(ymd);
    let n = weekCount(days, h, w) >= per ? 1 : 0;
    for (let i = 0; i < 520; i++) {
      w = addDaysYmd(w, -7);
      if (weekCount(days, h, w) < per) break;
      n++;
    }
    return { n, unit: 'week' };
  }
  const stop = firstMark(days, h);
  let n = 0;
  let d = ymd;
  for (let i = 0; i < 3700 && stop && d >= stop; i++) {
    if (doneOn(days, h, d)) n++;
    else if (i > 0 && scheduledOn(h, d)) break;
    d = addDaysYmd(d, -1);
  }
  return { n, unit: 'day' };
}

/** Лучшая серия за всю историю (до `today` включительно) */
export function bestStreak(days: Days, h: Habit, today: string): Streak {
  const first = firstMark(days, h);
  if (!first) return { n: 0, unit: freqOf(h) === 'weekly' ? 'week' : 'day' };
  if (freqOf(h) === 'weekly') {
    const per = perWeekOf(h);
    let best = 0;
    let run = 0;
    for (let w = mondayOf(first), i = 0; w <= today && i < 1000; w = addDaysYmd(w, 7), i++) {
      if (weekCount(days, h, w) >= per) best = Math.max(best, ++run);
      else run = 0;
    }
    return { n: best, unit: 'week' };
  }
  let best = 0;
  let run = 0;
  for (let d = first, i = 0; d <= today && i < 5000; d = addDaysYmd(d, 1), i++) {
    if (doneOn(days, h, d)) best = Math.max(best, ++run);
    else if (scheduledOn(h, d) && d !== today) run = 0;
  }
  return { n: best, unit: 'day' };
}

// ---------- Статистика ----------

export interface Completion {
  /** 0..1 */
  rate: number;
  done: number;
  /** сколько выполнений ожидалось */
  expected: number;
}

/** Выполнение за последние `n` дней (до `today`; не отмеченный сегодня день не считается пропуском) */
export function completion(days: Days, h: Habit, today: string, n = 30): Completion {
  let start = addDaysYmd(today, -(n - 1));
  const created = createdYmd(h);
  const first = firstMark(days, h);
  // привычка младше окна — считаем с момента создания (или первой отметки)
  const born = [created, first].filter(Boolean).sort()[0];
  if (born && born > start) start = born;
  if (start > today) return { rate: 0, done: 0, expected: 0 };
  let done = 0;
  let expected = 0;
  let span = 0;
  for (let d = start; d <= today; d = addDaysYmd(d, 1)) {
    const ok = doneOn(days, h, d);
    if (ok) done++;
    if (d === today && !ok) continue;
    span++;
    if (freqOf(h) !== 'weekly' && scheduledOn(h, d)) expected++;
  }
  if (freqOf(h) === 'weekly') expected = Math.max(1, Math.round((perWeekOf(h) * span) / 7));
  if (freqOf(h) !== 'weekly') {
    // выполнения в незапланированные дни — бонус, но не больше 100%
    const scheduledDone = countScheduledDone(days, h, start, today);
    return { rate: expected ? Math.min(1, scheduledDone / expected) : 0, done, expected };
  }
  return { rate: Math.min(1, done / expected), done, expected };
}

function countScheduledDone(days: Days, h: Habit, from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) if (scheduledOn(h, d) && doneOn(days, h, d)) n++;
  return n;
}

/** Всего дней с выполнением */
export function totalDone(days: Days, h: Habit): number {
  let n = 0;
  for (const k of Object.keys(days)) if (doneOn(days, h, k)) n++;
  return n;
}

export interface HeatCell {
  ymd: string;
  /** 0..1 — доля цели дня; -1 — день не запланирован; null — будущее */
  level: number | null;
}

/** Тепловая карта: `weeks` столбцов (недели с понедельника), в каждом 7 дней */
export function heatmap(days: Days, h: Habit, today: string, weeks = 12): HeatCell[][] {
  const start = addDaysYmd(mondayOf(today), -(weeks - 1) * 7);
  const t = targetOf(h);
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const ymd = addDaysYmd(start, w * 7 + i);
      if (ymd > today) {
        col.push({ ymd, level: null });
        continue;
      }
      const c = countOn(days[ymd], h);
      const level = doneOn(days, h, ymd) ? 1 : t > 1 ? Math.min(1, c / t) : 0;
      col.push({ ymd, level: level === 0 && !scheduledOn(h, ymd) ? -1 : level });
    }
    cols.push(col);
  }
  return cols;
}

// ---------- Создание ----------

/** Нормализовать привычку перед сохранением: лишние поля прочь, отметка времени изменения */
export function cleanHabit(h: Habit): Habit {
  const out: Habit = { ...h, name: h.name.trim() || 'Привычка', updatedAt: Date.now() };
  const f = freqOf(out);
  if (f === 'daily') {
    delete out.freq;
    delete out.days;
    delete out.perWeek;
  } else if (f === 'weekdays') {
    out.days = [...new Set(out.days)].sort();
    delete out.perWeek;
  } else {
    out.perWeek = perWeekOf(out);
    delete out.days;
  }
  if (!out.time) {
    delete out.time;
    delete out.duration;
  }
  if (!out.duration) delete out.duration;
  if (targetOf(out) <= 1) {
    delete out.target;
    delete out.unit;
  } else out.target = targetOf(out);
  if (!out.unit?.trim()) delete out.unit;
  if (!out.icon) delete out.icon;
  if (!out.part) delete out.part;
  if (!out.remind) delete out.remind;
  if (!out.remindOff) delete out.remindOff;
  if (!out.archived) delete out.archived;
  return out;
}

/** Порядок внутри части дня: по времени, без времени — в конце (порядок списка сохраняется) */
export function compareByTime(a: Habit, b: Habit): number {
  if (a.time && b.time) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  if (a.time) return -1;
  if (b.time) return 1;
  return 0;
}
