/**
 * Итоги недели (пн–вс): чистый подсчёт по локальным данным — задачи, привычки, фокус,
 * настроение, деньги, опыт — и несколько простых наблюдений. Работает офлайн, без ИИ.
 */
import type { Habit, PlannerData } from '../types';
import type { TasksData } from '../tasks/model';
import type { FinanceData } from '../finance/model';
import { summarize } from '../finance/model';
import { activeHabits, currentStreak, doneOn, freqOf, frozenOn, mondayOf, scheduledOn, streakText, weekCount, weekGoal } from '../habits/model';
import { addDaysYmd, fromYmd, toYmd } from '../utils/mapTasks';

type Days = PlannerData['days'];

// ---------- Настроение ----------

/** Оценка настроения (те же смайлики, что в разделе «Привычки») */
export const MOOD_SCORE: Record<string, number> = { '🤩': 5, '😄': 4.5, '🙂': 4, '😐': 3, '😴': 2.5, '😕': 2, '😢': 1.5, '😡': 1 };

const normMood = (m: string | undefined) => (m ?? '').replace(/️/g, '').trim();
export const moodScore = (m: string | undefined): number | null => MOOD_SCORE[normMood(m)] ?? null;

/** Смайлик для средней оценки */
export function moodForScore(v: number): string {
  if (v >= 4.75) return '🤩';
  if (v >= 4.25) return '😄';
  if (v >= 3.5) return '🙂';
  if (v >= 2.75) return '😐';
  if (v >= 1.75) return '😕';
  return '😢';
}

// ---------- Подписи ----------

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WD_ACC = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];

/** «6–12 окт», «29 сен – 5 окт» */
export function weekLabel(monday: string): string {
  const a = fromYmd(monday);
  const b = fromYmd(addDaysYmd(monday, 6));
  const yr = b.getFullYear() !== new Date().getFullYear() ? ` ${b.getFullYear()}` : '';
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}${yr}`;
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}${yr}`;
}

/** «вт, 8 окт» */
export function dayShort(ymd: string): string {
  const d = fromYmd(ymd);
  return `${WD_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function minutesLabel(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Какую неделю показывать по умолчанию: в понедельник — прошедшую, иначе — текущую */
export function defaultReviewMonday(now = new Date()): string {
  const today = toYmd(now);
  const mon = mondayOf(today);
  return now.getDay() === 1 ? addDaysYmd(mon, -7) : mon;
}

// ---------- Подсчёт ----------

export interface WeekInputs {
  tasks: TasksData | null;
  planner: PlannerData | null;
  finance: FinanceData | null;
  /** опыт по дням (из раздела «Прогресс») */
  dayXp?: Map<string, number> | null;
}

export interface WeekDay {
  date: string;
  tasks: number;
  focus: number;
  xp: number;
  mood?: string;
}

export interface WeeklyStats {
  monday: string;
  sunday: string;
  label: string;
  /** неделя ещё идёт */
  current: boolean;
  /** неделя ещё не началась */
  future: boolean;
  days: WeekDay[];
  tasksDone: number;
  prevTasksDone: number;
  /** выполнение привычек: сделано / ожидалось (0..1); null — привычек не было */
  habitRate: number | null;
  habitDone: number;
  habitExpected: number;
  bestStreak: { name: string; icon?: string; text: string; n: number } | null;
  focusMin: number;
  prevFocusMin: number;
  moodAvg: number | null;
  moodDays: number;
  /** смайлик → сколько дней */
  moodDist: { mood: string; n: number }[];
  currency: string;
  spent: number;
  prevSpent: number;
  income: number;
  prevIncome: number;
  hasFinance: boolean;
  xp: number;
  prevXp: number;
  bestDay: WeekDay | null;
  insights: string[];
}

const dayOf = (ms: number) => toYmd(new Date(ms));

/** Выполненные задачи по дням: журнал выполнений + выполненные без записи в журнале */
function tasksPerDay(t: TasksData | null): Map<string, number> {
  const per = new Map<string, number>();
  if (!t) return per;
  const logged = new Set<string>();
  for (const l of t.log ?? []) {
    logged.add(l.taskId);
    const d = dayOf(l.at);
    per.set(d, (per.get(d) ?? 0) + 1);
  }
  for (const x of t.tasks ?? []) {
    if (x.done && x.completedAt && !logged.has(x.id) && !x.deleted) {
      const d = dayOf(x.completedAt);
      per.set(d, (per.get(d) ?? 0) + 1);
    }
  }
  return per;
}

function focusPerDay(t: TasksData | null): Map<string, number> {
  const per = new Map<string, number>();
  for (const s of t?.focus ?? []) {
    if (!(s.minutes > 0)) continue;
    const d = dayOf(s.start);
    per.set(d, (per.get(d) ?? 0) + s.minutes);
  }
  return per;
}

const sumRange = (m: Map<string, number> | null | undefined, from: string, to: string) => {
  let s = 0;
  if (!m) return s;
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) s += m.get(d) ?? 0;
  return s;
};

const createdYmd = (h: Habit) => (h.createdAt ? toYmd(new Date(h.createdAt)) : '');

/** Выполнение привычек за неделю (до `last` включительно; не отмеченный сегодня день — не пропуск) */
function habitWeek(days: Days, habits: Habit[], monday: string, last: string, today: string): { done: number; expected: number } {
  let done = 0;
  let expected = 0;
  for (const h of habits) {
    const born = createdYmd(h);
    if (born && born > last) continue;
    if (freqOf(h) === 'weekly') {
      const g = weekGoal(days, h, monday);
      if (g <= 0) continue;
      expected += g;
      done += Math.min(g, weekCount(days, h, monday));
      continue;
    }
    for (let d = monday; d <= last; d = addDaysYmd(d, 1)) {
      if (born && d < born) continue;
      if (!scheduledOn(h, d)) continue;
      const ok = doneOn(days, h, d);
      if (!ok && (d === today || frozenOn(days, h, d))) continue;
      expected++;
      if (ok) done++;
    }
  }
  return { done, expected };
}

/** Настроение в дни, когда привычка выполнена, и когда нет (за 4 недели, ≥ 4 дней с каждой стороны) */
function moodHabitInsight(days: Days, habits: Habit[], end: string): string | null {
  const start = addDaysYmd(end, -27);
  let best: { h: Habit; a: number; b: number } | null = null;
  for (const h of habits) {
    const yes: number[] = [];
    const no: number[] = [];
    for (let d = start; d <= end; d = addDaysYmd(d, 1)) {
      const s = moodScore(days[d]?.mood);
      if (s == null) continue;
      if (doneOn(days, h, d)) yes.push(s);
      else if (scheduledOn(h, d) && !frozenOn(days, h, d)) no.push(s);
    }
    if (yes.length < 4 || no.length < 4) continue;
    const a = yes.reduce((x, y) => x + y, 0) / yes.length;
    const b = no.reduce((x, y) => x + y, 0) / no.length;
    if (Math.abs(a - b) < 0.4) continue;
    if (!best || Math.abs(a - b) > Math.abs(best.a - best.b)) best = { h, a, b };
  }
  if (!best) return null;
  const f = (v: number) => v.toFixed(1).replace('.', ',');
  const name = `${best.h.icon ? best.h.icon + ' ' : ''}«${best.h.name}»`;
  return best.a > best.b
    ? `В дни с привычкой ${name} настроение выше: ${f(best.a)} против ${f(best.b)}`
    : `В дни с привычкой ${name} настроение ниже: ${f(best.a)} против ${f(best.b)} — может, стоит её пересмотреть`;
}

/** Самый продуктивный день недели за последние 8 недель (по выполненным задачам) */
function productiveWeekdayInsight(per: Map<string, number>, sunday: string): string | null {
  const start = addDaysYmd(sunday, -55);
  const sums = [0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (let d = start; d <= sunday; d = addDaysYmd(d, 1)) {
    const n = per.get(d) ?? 0;
    sums[fromYmd(d).getDay()] += n;
    total += n;
  }
  if (total < 10) return null;
  let wd = 0;
  for (let i = 1; i < 7; i++) if (sums[i] > sums[wd]) wd = i;
  const avg = sums[wd] / 8;
  // явный лидер: заметно больше среднего дня
  if (sums[wd] < (total / 7) * 1.25) return null;
  const v = avg >= 10 ? Math.round(avg) : Math.round(avg * 10) / 10;
  return `Самый продуктивный день недели — ${WD_ACC[wd]}: в среднем ${String(v).replace('.', ',')} ${plural(Math.round(v), 'задача', 'задачи', 'задач')}`;
}

const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

export function computeWeek(src: WeekInputs, monday: string, now = new Date()): WeeklyStats {
  const today = toYmd(now);
  const sunday = addDaysYmd(monday, 6);
  const prevMon = addDaysYmd(monday, -7);
  const prevSun = addDaysYmd(monday, -1);
  const current = monday <= today && today <= sunday;
  const future = monday > today;
  const last = current ? today : sunday;

  const tPer = tasksPerDay(src.tasks);
  const fPer = focusPerDay(src.tasks);
  const pDays: Days = src.planner?.days ?? {};
  const habits = activeHabits(src.planner?.habits);

  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDaysYmd(monday, i);
    const mood = normMood(pDays[d]?.mood) || undefined;
    days.push({ date: d, tasks: tPer.get(d) ?? 0, focus: fPer.get(d) ?? 0, xp: src.dayXp?.get(d) ?? 0, mood });
  }

  // привычки
  const hw = future ? { done: 0, expected: 0 } : habitWeek(pDays, habits, monday, last, today);
  let bestStreak: WeeklyStats['bestStreak'] = null;
  if (!future)
    for (const h of habits) {
      const s = currentStreak(pDays, h, last);
      if (s.n >= 2 && (!bestStreak || s.n * (s.unit === 'week' ? 7 : 1) > bestStreak.n))
        bestStreak = { name: h.name, icon: h.icon, text: streakText(s), n: s.n * (s.unit === 'week' ? 7 : 1) };
    }

  // настроение
  const moodScores = days.map((d) => moodScore(d.mood)).filter((x): x is number => x != null);
  const distMap = new Map<string, number>();
  for (const d of days) if (d.mood) distMap.set(d.mood, (distMap.get(d.mood) ?? 0) + 1);
  const moodDist = [...distMap].map(([mood, n]) => ({ mood, n })).sort((a, b) => b.n - a.n || (MOOD_SCORE[b.mood] ?? 0) - (MOOD_SCORE[a.mood] ?? 0));

  // деньги
  const fin = src.finance;
  let spent = 0, prevSpent = 0, income = 0, prevIncome = 0;
  let hasFinance = false;
  if (fin) {
    try {
      const s = summarize(fin, { from: monday, to: sunday });
      const p = summarize(fin, { from: prevMon, to: prevSun });
      spent = s.expense;
      income = s.income;
      prevSpent = p.expense;
      prevIncome = p.income;
      hasFinance = spent > 0 || income > 0 || prevSpent > 0 || prevIncome > 0;
    } catch {
      /* повреждённые данные финансов — без денег */
    }
  }

  const tasksDone = sumRange(tPer, monday, sunday);
  const prevTasksDone = sumRange(tPer, prevMon, prevSun);
  const xp = sumRange(src.dayXp, monday, sunday);

  // лучший день: больше всего опыта (без опыта — больше всего задач)
  let bestDay: WeekDay | null = null;
  for (const d of days) {
    const score = d.xp || d.tasks;
    if (score > 0 && (!bestDay || score > (bestDay.xp || bestDay.tasks))) bestDay = d;
  }

  // наблюдения
  const insights: string[] = [];
  if (!future) {
    const mh = moodHabitInsight(pDays, habits, last);
    if (mh) insights.push(mh);
    const pw = productiveWeekdayInsight(tPer, sunday);
    if (pw) insights.push(pw);
    const tc = pctChange(tasksDone, prevTasksDone);
    if (!current && tc != null && Math.abs(tc) >= 15 && prevTasksDone >= 3)
      insights.push(tc > 0 ? `Задач выполнено на ${tc}% больше, чем неделей раньше` : `Задач выполнено на ${-tc}% меньше, чем неделей раньше — бывает, главное не сдаваться`);
    const sc = pctChange(spent, prevSpent);
    if (insights.length < 3 && !current && sc != null && Math.abs(sc) >= 20 && spent > 0)
      insights.push(sc > 0 ? `Расходы выросли на ${sc}% по сравнению с прошлой неделей` : `Расходы на ${-sc}% меньше, чем на прошлой неделе`);
    if (insights.length < 3 && hw.expected > 0 && hw.done === hw.expected && hw.expected >= 3) insights.push('Все привычки выполнены по плану — отличная неделя!');
  }

  return {
    monday,
    sunday,
    label: weekLabel(monday),
    current,
    future,
    days,
    tasksDone,
    prevTasksDone,
    habitRate: hw.expected > 0 ? Math.min(1, hw.done / hw.expected) : null,
    habitDone: hw.done,
    habitExpected: hw.expected,
    bestStreak,
    focusMin: sumRange(fPer, monday, sunday),
    prevFocusMin: sumRange(fPer, prevMon, prevSun),
    moodAvg: moodScores.length ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length : null,
    moodDays: moodScores.length,
    moodDist,
    currency: fin?.prefs?.mainCurrency ?? 'KZT',
    spent,
    prevSpent,
    income,
    prevIncome,
    hasFinance,
    xp,
    prevXp: sumRange(src.dayXp, prevMon, prevSun),
    bestDay,
    insights: insights.slice(0, 3),
  };
}

// ---------- Текст итогов ----------

/** Строки ответа: по одной на пункт, без маркеров списка */
export function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+•–—]|\d{1,3}[.)]|\[[ xX]?\])\s*/, '').replace(/^#+\s*/, '').trim())
    .filter(Boolean);
}

export interface ReviewAnswers {
  good: string;
  bad: string;
  next: string;
}

/** Короткая сводка цифрами (для дневника и карты) */
export function statLines(s: WeeklyStats, money: (v: number) => string): string[] {
  const out = [`Задач выполнено: ${s.tasksDone}`];
  if (s.habitRate != null) out.push(`Привычки: ${Math.round(s.habitRate * 100)}% (${s.habitDone} из ${s.habitExpected})`);
  if (s.bestStreak) out.push(`Лучшая серия: ${s.bestStreak.icon ? s.bestStreak.icon + ' ' : ''}${s.bestStreak.name} — ${s.bestStreak.text}`);
  if (s.focusMin > 0) out.push(`Фокус: ${minutesLabel(s.focusMin)}`);
  if (s.moodAvg != null) out.push(`Настроение: ${moodForScore(s.moodAvg)} ${s.moodAvg.toFixed(1).replace('.', ',')} из 5`);
  if (s.hasFinance) out.push(`Расходы: ${money(s.spent)}${s.income > 0 ? `, доходы: ${money(s.income)}` : ''}`);
  if (s.xp > 0) out.push(`Опыт: +${Math.round(s.xp)} XP`);
  if (s.bestDay) out.push(`Лучший день: ${dayShort(s.bestDay.date)}`);
  return out;
}

/** Запись в дневник воскресенья */
export function journalText(s: WeeklyStats, a: ReviewAnswers, money: (v: number) => string): string {
  const parts = [`🗓 Итоги недели ${s.label}`, statLines(s, money).join(' · ')];
  const block = (title: string, text: string) => {
    const ls = lines(text);
    if (ls.length) parts.push(`${title}:\n${ls.map((l) => `— ${l}`).join('\n')}`);
  };
  block('Получилось', a.good);
  block('Мешало', a.bad);
  block('Главное на следующую неделю', a.next);
  return parts.join('\n\n');
}

/** Markdown для карты «Неделя 6–12 окт» */
export function reviewMarkdown(s: WeeklyStats, a: ReviewAnswers, money: (v: number) => string): string {
  const esc = (l: string) => l.replace(/\r?\n/g, ' ');
  const sec = (title: string, items: string[], task = false) => [`- ${title}`, ...items.map((l) => `  - ${task ? '[ ] ' : ''}${esc(l)}`)].join('\n');
  return [
    `# Неделя ${s.label}`,
    sec('Итоги', statLines(s, money)),
    sec('Получилось', lines(a.good)),
    sec('Мешало', lines(a.bad)),
    sec('Планы', lines(a.next), true),
  ].join('\n');
}
