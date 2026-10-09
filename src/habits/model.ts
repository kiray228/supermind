/**
 * Привычки: частота, счётчики, серии и статистика.
 * Только чистые функции — их используют Ежедневник, Календарь и напоминания.
 *
 * Совместимость: все новые поля привычки необязательны; привычка без `freq` — ежедневная,
 * без `target` — простая отметка. Выполнение дня хранится в PlannerDay.habits (как раньше),
 * счётчики — в PlannerDay.habitCounts; при достижении цели id попадает и в habits.
 *
 * Несколько раз в день (Habit.times): это счётчик с целью = числу времён; i-й приём выполнен, если отметок > i.
 * Напоминание — на каждое время, пока этот приём не отмечен.
 *
 * Заморозка серии: пропуск дня — id в PlannerDay.skipped (сливается вместе с днём, как отметки),
 * пауза — Habit.pauses (диапазоны дат, сливаются вместе с привычкой). Замороженный день
 * (пропуск или пауза, если привычка не выполнена) — не по плану: серию не рвёт и не продлевает,
 * не считается пропуском в статистике и уменьшает недельную цель «N раз в неделю».
 */
import type { Habit, HabitFreq, HabitPart, HabitPause, PlannerData, PlannerDay } from '../types';
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
const partOfTime = (t: string): HabitPart => {
  const m = minutesOf(t);
  return m < 12 * 60 ? 'morning' : m < 17 * 60 ? 'day' : 'evening';
};

export function partOf(h: Pick<Habit, 'part' | 'time'>): HabitPart {
  if (h.part) return h.part;
  if (h.time) return partOfTime(h.time);
  return 'any';
}

/** Времена приёмов, если привычка несколько раз в день (иначе пусто) */
export const timesOf = (h: Pick<Habit, 'times'>): string[] => (h.times && h.times.length > 1 ? h.times : []);

/** Время следующего неотмеченного приёма (null — все отмечены или привычка не «несколько раз») */
export function nextSlot(h: Habit, count: number): string | null {
  const t = timesOf(h);
  return t.length && count < t.length ? t[count] : null;
}

/**
 * Часть дня с учётом отметок: привычка «утром и вечером» стоит в «Утро», пока утренний приём
 * не отмечен, потом переходит в «Вечер». Выбранная вручную часть дня главнее.
 */
export function partNow(h: Habit, count: number): HabitPart {
  const t = timesOf(h);
  if (!t.length || h.part) return partOf(h);
  return partOfTime(t[Math.min(count, t.length - 1)]);
}

/** Время напоминания: отдельное, иначе время привычки (если напоминания не выключены) */
export function reminderTimeOf(h: Habit): string | undefined {
  if (h.remindOff) return undefined;
  return h.remind || h.time || undefined;
}

/** Все времена напоминаний: у «несколько раз в день» — каждое время приёма */
export function reminderTimesOf(h: Habit): string[] {
  if (h.remindOff) return [];
  const t = timesOf(h);
  if (t.length) return t;
  const one = reminderTimeOf(h);
  return one ? [one] : [];
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
  const t = timesOf(h);
  if (t.length) return t.join(' · ');
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
  if (v >= t) {
    hs.push(h.id);
    // выполнено — пропуск больше не нужен
    if (day.skipped?.includes(h.id)) setSkipped(out, day.skipped.filter((x) => x !== h.id));
  }
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
  if (day.skipped?.includes(id)) setSkipped(out, day.skipped.filter((x) => x !== id));
  if (day.habitCounts?.[id] != null) {
    const counts = { ...day.habitCounts };
    delete counts[id];
    if (Object.keys(counts).length) out.habitCounts = counts;
    else delete out.habitCounts;
  }
  return out;
}

// ---------- Заморозка: пропуск дня и пауза ----------

function setSkipped(out: PlannerDay, list: string[]) {
  if (list.length) out.skipped = list;
  else delete out.skipped;
}

/** Пропуск по уважительной причине отмечен в этот день */
export const skipMarked = (day: PlannerDay | undefined, h: Habit) => !!day?.skipped?.includes(h.id);

/**
 * Отметить / снять пропуск дня; пропуск снимает отметку выполнения.
 * Неполный счётчик («6 из 8 стаканов») сохраняется — отмена пропуска вернёт его как был.
 */
export function withSkip(day: PlannerDay, h: Habit, on: boolean): PlannerDay {
  const partial = isCounter(h) && countOn(day, h) < targetOf(h);
  const out = !on ? { ...day } : partial ? { ...day, habits: (day.habits ?? []).filter((x) => x !== h.id) } : withoutHabit(day, h.id);
  const rest = (day.skipped ?? []).filter((x) => x !== h.id);
  setSkipped(out, on ? [...rest, h.id] : rest);
  return out;
}

/** Пауза, в которую попадает день (если есть) */
export function pauseOn(h: Habit, ymd: string): HabitPause | undefined {
  return h.pauses?.find((p) => p.from <= ymd && ymd <= p.to);
}

/** Привычка на паузе в этот день */
export const pausedOn = (h: Habit, ymd: string) => !!pauseOn(h, ymd);

export type FreezeKind = 'skip' | 'pause';

/** День заморожен (не выполнен, но пропущен или на паузе): не по плану, серию не рвёт */
export function frozenOn(days: Days, h: Habit, ymd: string): FreezeKind | null {
  if (!h.pauses?.length && !days[ymd]?.skipped?.length) return null;
  if (doneOn(days, h, ymd)) return null;
  if (pausedOn(h, ymd)) return 'pause';
  if (skipMarked(days[ymd], h)) return 'skip';
  return null;
}

/** Последний день непрерывной паузы, в которую попадает `ymd` (смежные паузы склеены normPauses) */
export function pauseEnd(h: Habit, ymd: string): string | undefined {
  let end: string | undefined;
  let d = ymd;
  for (let i = 0; i < 50; i++) {
    const p = pauseOn(h, d);
    if (!p) break;
    end = p.to;
    d = addDaysYmd(p.to, 1);
  }
  return end;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Порядок и склейка пауз: пересекающиеся и смежные — в одну; кончившиеся больше 2 лет назад — прочь */
export function normPauses(list: HabitPause[] | undefined, today = toYmd(new Date())): HabitPause[] {
  const old = addDaysYmd(today, -730);
  const ok = (list ?? []).filter((p) => p && YMD_RE.test(p.from) && YMD_RE.test(p.to) && p.from <= p.to && p.to >= old);
  ok.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: HabitPause[] = [];
  for (const p of ok) {
    const last = out[out.length - 1];
    if (last && p.from <= addDaysYmd(last.to, 1)) {
      if (p.to > last.to) last.to = p.to;
    } else out.push({ from: p.from, to: p.to });
  }
  return out;
}

/** Поставить на паузу с `from` по `to` включительно */
export function withPause(h: Habit, from: string, to: string): Habit {
  return { ...h, pauses: normPauses([...(h.pauses ?? []), { from, to }]) };
}

/** Снять паузу с `today`: прошедшие дни паузы остаются (история серии), сегодня и дальше — по плану */
export function withResume(h: Habit, today: string): Habit {
  const y = addDaysYmd(today, -1);
  const pauses = (h.pauses ?? []).flatMap((p) => (p.to < today ? [p] : p.from <= y ? [{ from: p.from, to: y }] : []));
  return { ...h, pauses };
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «до завтра», «до 15 окт» — до какого дня (не включая) привычка на паузе; null — не на паузе */
export function pauseUntilLabel(h: Habit, ymd: string): string | null {
  const end = pauseEnd(h, ymd);
  if (!end) return null;
  const back = addDaysYmd(end, 1);
  if (back === addDaysYmd(ymd, 1)) return 'до завтра';
  const d = fromYmd(back);
  const y = d.getFullYear() !== fromYmd(ymd).getFullYear() ? ` ${d.getFullYear()}` : '';
  return `до ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${y}`;
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

/**
 * Недельная цель «N раз в неделю» с учётом заморозки: замороженные дни уменьшают цель пропорционально
 * (неделя целиком на паузе — цель 0: такая неделя серию не рвёт и не продлевает).
 */
export function weekGoal(days: Days, h: Habit, ymd: string): number {
  const per = perWeekOf(h);
  const mon = mondayOf(ymd);
  let active = 0;
  for (let i = 0; i < 7; i++) if (!frozenOn(days, h, addDaysYmd(mon, i))) active++;
  return active >= 7 ? per : Math.min(per, Math.ceil((per * active) / 7));
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
  // пропуск и пауза — не по плану (выполненный день — по плану всегда)
  if (frozenOn(days, h, ymd)) return false;
  const f = freqOf(h);
  if (f === 'daily') return true;
  if (f === 'weekdays') return scheduledOn(h, ymd);
  return doneOn(days, h, ymd) || weekCount(days, h, ymd, ymd) < weekGoal(days, h, ymd);
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
 * Ежедневно / по дням недели — подряд выполненные запланированные дни (незапланированные и замороженные дни
 * серию не рвут и не продлевают, сам `ymd`, если ещё не отмечен, тоже). N раз в неделю — подряд недели
 * с выполненной целью (текущая неделя, пока цель не набрана, серию не рвёт; неделя целиком на паузе — тоже).
 */
export function currentStreak(days: Days, h: Habit, ymd: string): Streak {
  const stop = firstMark(days, h);
  if (freqOf(h) === 'weekly') {
    if (!stop) return { n: 0, unit: 'week' };
    const first = mondayOf(stop);
    let w = mondayOf(ymd);
    const g0 = weekGoal(days, h, w);
    let n = g0 > 0 && weekCount(days, h, w) >= g0 ? 1 : 0;
    for (let i = 0; i < 520; i++) {
      w = addDaysYmd(w, -7);
      if (w < first) break;
      const g = weekGoal(days, h, w);
      if (g === 0) continue;
      if (weekCount(days, h, w) < g) break;
      n++;
    }
    return { n, unit: 'week' };
  }
  let n = 0;
  let d = ymd;
  for (let i = 0; i < 3700 && stop && d >= stop; i++) {
    if (doneOn(days, h, d)) n++;
    else if (i > 0 && scheduledOn(h, d) && !frozenOn(days, h, d)) break;
    d = addDaysYmd(d, -1);
  }
  return { n, unit: 'day' };
}

/** Лучшая серия за всю историю (до `today` включительно) */
export function bestStreak(days: Days, h: Habit, today: string): Streak {
  const first = firstMark(days, h);
  if (!first) return { n: 0, unit: freqOf(h) === 'weekly' ? 'week' : 'day' };
  if (freqOf(h) === 'weekly') {
    let best = 0;
    let run = 0;
    for (let w = mondayOf(first), i = 0; w <= today && i < 1000; w = addDaysYmd(w, 7), i++) {
      const g = weekGoal(days, h, w);
      // неделя целиком на паузе — мостик
      if (g === 0) continue;
      if (weekCount(days, h, w) >= g) best = Math.max(best, ++run);
      else run = 0;
    }
    return { n: best, unit: 'week' };
  }
  let best = 0;
  let run = 0;
  for (let d = first, i = 0; d <= today && i < 5000; d = addDaysYmd(d, 1), i++) {
    if (doneOn(days, h, d)) best = Math.max(best, ++run);
    else if (scheduledOn(h, d) && d !== today && !frozenOn(days, h, d)) run = 0;
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
    // пропуск и пауза — не в счёт
    if (!ok && frozenOn(days, h, d)) continue;
    span++;
    if (freqOf(h) !== 'weekly' && scheduledOn(h, d)) expected++;
  }
  if (freqOf(h) === 'weekly') {
    if (!span) return { rate: 0, done, expected: 0 };
    expected = Math.max(1, Math.round((perWeekOf(h) * span) / 7));
  }
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
  /** день заморожен: пропуск или пауза (и в будущем — запланированная пауза) */
  frozen?: FreezeKind;
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
      const fz = frozenOn(days, h, ymd);
      const cell: HeatCell = { ymd, level: null };
      if (fz) cell.frozen = fz;
      if (ymd <= today) {
        const c = countOn(days[ymd], h);
        const level = doneOn(days, h, ymd) ? 1 : t > 1 ? Math.min(1, c / t) : 0;
        cell.level = level === 0 && !scheduledOn(h, ymd) ? -1 : level;
      }
      col.push(cell);
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
  // несколько раз в день: времена по порядку без повторов; цель и первое время — из них
  const times = [...new Set((out.times ?? []).filter((t) => /^\d{2}:\d{2}$/.test(t)))].sort();
  if (times.length > 1) {
    out.times = times;
    out.target = times.length;
    out.time = times[0];
    delete out.remind;
  } else {
    if (out.times && times.length === 1 && !out.time) out.time = times[0];
    delete out.times;
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
  const pauses = normPauses(out.pauses);
  if (pauses.length) out.pauses = pauses;
  else delete out.pauses;
  return out;
}

/** Порядок внутри части дня: по времени, без времени — в конце (порядок списка сохраняется) */
export function compareByTime(a: Habit, b: Habit): number {
  if (a.time && b.time) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  if (a.time) return -1;
  if (b.time) return 1;
  return 0;
}
