/**
 * Шаги и сон из Apple «Здоровья» / Health Connect: расчёты без зависимостей (проверяются тестами).
 * Сырые данные остаются на телефоне — в привычки попадает только отметка «сделано».
 */
import type { Habit } from '../types';
// путь с .ts: файл проверяется тестами node без сборщика
import { t } from '../i18n/index.ts';

export interface SleepPiece {
  startDate: string;
  endDate: string;
  /** asleep/rem/deep/light — сон; awake/inBed — нет (inBed — запасной вариант, если сна нет вовсе) */
  sleepState?: string;
  stages?: { startDate: string; endDate: string; stage: string }[];
}

const SLEEP = new Set(['asleep', 'rem', 'deep', 'light']);

type Span = [number, number];

/** Объединить пересекающиеся промежутки: iPhone и часы пишут одну ночь дважды */
function merge(spans: Span[]): Span[] {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const clip = (spans: Span[], from: number, to: number): Span[] =>
  spans.map(([a, b]): Span => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a);

const ms = (s: string) => Date.parse(s);

/** Промежутки сна в окне [from, to): по стадиям, если есть, иначе по состоянию; без сна — «в кровати» */
export function sleepSpans(samples: SleepPiece[], from: number, to: number): Span[] {
  const asleep: Span[] = [];
  const inBed: Span[] = [];
  for (const x of samples) {
    if (x.stages?.length) {
      for (const st of x.stages) if (SLEEP.has(st.stage)) asleep.push([ms(st.startDate), ms(st.endDate)]);
      continue;
    }
    const span: Span = [ms(x.startDate), ms(x.endDate)];
    if (!x.sleepState || SLEEP.has(x.sleepState)) asleep.push(span);
    else if (x.sleepState === 'inBed') inBed.push(span);
  }
  const main = clip(merge(asleep), from, to);
  return main.length ? main : clip(merge(inBed), from, to);
}

/** Минут сна за ночь, закончившуюся в день `ymd`: окно с 18:00 накануне до 14:00 этого дня */
export function nightWindow(ymd: string): { from: number; to: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { from: new Date(y, m - 1, d - 1, 18).getTime(), to: new Date(y, m - 1, d, 14).getTime() };
}

export function sleepMinutes(samples: SleepPiece[], ymd: string): number {
  const { from, to } = nightWindow(ymd);
  return Math.round(sleepSpans(samples, from, to).reduce((a, [s, e]) => a + (e - s), 0) / 60_000);
}

/** Когда уснули в ночь на `ymd` (мс) — начало первого промежутка сна; null — сна нет */
export function fellAsleepAt(samples: SleepPiece[], ymd: string): number | null {
  const { from, to } = nightWindow(ymd);
  const s = sleepSpans(samples, from, to);
  return s.length ? s[0][0] : null;
}

// ---------- Привычки, которые отмечаются сами ----------

const lower = (h: Pick<Habit, 'name'>) => h.name.trim().toLowerCase();

/** Число из названия: «10 000 шагов», «8к шагов», «Сон 7,5 часов» */
function numberIn(name: string): number | null {
  const m = name.replace(/(\d)[\s ,](?=\d{3}\b)/g, '$1').match(/(\d+(?:[.,]\d+)?)\s*(к|k|тыс)?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return m[2] ? n * 1000 : n;
}

/** Привычка про шаги → сколько шагов нужно (по умолчанию 10 000) */
export function stepsGoal(h: Pick<Habit, 'name'>): number | null {
  const name = lower(h);
  if (!/(^|[^а-яё])шаг|steps/.test(name)) return null;
  const n = numberIn(name);
  return n && n >= 100 ? Math.round(n) : 10_000;
}

/** Привычка «спать N часов» / «высыпаться» → минут сна (по умолчанию 7 ч) */
export function sleepGoal(h: Pick<Habit, 'name'>): number | null {
  const name = lower(h);
  if (/лечь|ложиться|отбой|(^|[^a-z])bed([^a-z]|$)/.test(name)) return null;
  if (!/(^|[^а-яё])(сон|сна|спать|высып)|sleep/.test(name)) return null;
  if (/перед сном|без экран|без телефон/.test(name)) return null;
  const n = numberIn(name);
  return Math.round((n && n >= 3 && n <= 14 ? n : 7) * 60);
}

/** Привычка «лечь спать до 23:00» → крайний срок в минутах от полуночи (после полуночи — +24 ч) */
export function bedtimeGoal(h: Pick<Habit, 'name' | 'time'>): number | null {
  const name = lower(h);
  if (!/(лечь|ложиться|отбой|уснуть|заснуть|(^|[^a-z])bed([^a-z]|$)|asleep)/.test(name)) return null;
  const m = name.match(/(\d{1,2})[:.](\d{2})/) ?? name.match(/(?:до|by|before)\s+(\d{1,2})(?!\d)/);
  if (!m) return null;
  const hh = +m[1];
  const mm = m[2] ? +m[2] : 0;
  if (hh > 23 || mm > 59) return null;
  return (hh < 12 ? hh + 24 : hh) * 60 + mm;
}

export interface HealthDay {
  /** шаги по дням YYYY-MM-DD */
  steps: Record<string, number>;
  /** минут сна в ночь на день */
  sleep: Record<string, number>;
  /** когда уснули в ночь на день (мс) */
  asleepAt: Record<string, number>;
}

/**
 * Какие привычки отметить: шаги — в день шагов; сон — в день пробуждения;
 * «лечь до …» — вечером накануне (в день `ymd − 1`). Возвращает пары [привычка, день].
 */
export function autoMarks(habits: Habit[], data: HealthDay, today: string, prevDay: (ymd: string) => string): [Habit, string][] {
  const out: [Habit, string][] = [];
  const yesterday = prevDay(today);
  for (const h of habits) {
    const steps = stepsGoal(h);
    if (steps != null) {
      for (const d of [yesterday, today]) if ((data.steps[d] ?? 0) >= steps) out.push([h, d]);
      continue;
    }
    const bed = bedtimeGoal(h);
    if (bed != null) {
      const at = data.asleepAt[today];
      if (at != null) {
        // минут от полуночи вчерашнего дня: 23:10 → 1390, 00:30 → 1470
        const [y, m, d] = yesterday.split('-').map(Number);
        const mins = Math.round((at - new Date(y, m - 1, d).getTime()) / 60_000);
        if (mins <= bed) out.push([h, yesterday]);
      }
      continue;
    }
    const sleep = sleepGoal(h);
    if (sleep != null && (data.sleep[today] ?? 0) >= sleep) out.push([h, today]);
  }
  return out;
}

/** «7 ч 20 мин» */
export function fmtSleep(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? t('{h} ч {m} мин', { h, m }) : t('{h} ч', { h })) : t('{n} мин', { n: m });
}
