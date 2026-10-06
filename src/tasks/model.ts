import type { ID } from '../types';
import { addDaysYmd, fromYmd, todayYmd, toYmd } from '../utils/mapTasks';

// ================= Модель задач (как в TickTick) =================

/** 0 — нет, 1 — высокий, 2 — средний, 3 — низкий (как у задач в картах) */
export type Priority = 0 | 1 | 2 | 3;

export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RepeatRule {
  freq: RepeatFreq;
  /** каждые N дней/недель/месяцев/лет */
  interval: number;
  /** для weekly: дни недели 0..6 (0 — воскресенье) */
  weekdays?: number[];
  /** для monthly: «N-й день недели месяца», n = 1..4 или -1 (последний) */
  monthWeek?: { n: number; wd: number };
  /** последний день месяца */
  lastDay?: boolean;
  /** повторять до даты включительно (YYYY-MM-DD) */
  until?: string;
  /** всего повторений (включая первое) */
  count?: number;
  /** следующий срок считается от даты выполнения, а не от прошлого срока */
  fromCompletion?: boolean;
  /** закреплённый день месяца (monthly/yearly): 31-е не «съезжает» на 28-е после февраля */
  day?: number;
  /** закреплённый месяц 0..11 (yearly) */
  month?: number;
}

export interface ChecklistItem {
  id: ID;
  text: string;
  done: boolean;
}

export interface TaskItem {
  id: ID;
  title: string;
  notes?: string;
  listId: ID;
  done: boolean;
  completedAt?: number;
  /** «Не буду делать» */
  wontDo?: boolean;
  createdAt: number;
  updatedAt: number;
  priority: Priority;
  tags: string[];
  /** дата срока / начала (YYYY-MM-DD) */
  date?: string;
  /** время начала HH:MM; без времени — задача на весь день */
  time?: string;
  /** длительность в минутах (для задач со временем) */
  duration?: number;
  /** напоминания: минуты относительно начала (со временем) или полуночи дня срока (весь день); отрицательные — раньше */
  reminders: number[];
  repeat?: RepeatRule;
  /** сколько повторений уже выполнено */
  repeatDone?: number;
  checklist: ChecklistItem[];
  order: number;
  pinned?: boolean;
  /** время перемещения в корзину */
  deleted?: number;
  /** связанная тема карты */
  source?: { docId: ID; topicId: ID; docTitle?: string };
  /** событие в календаре телефона: id и «подпись» состояния, чтобы обновлять только изменённое */
  cal?: { id: string; sig: string };
  /** минуты фокуса (помодоро) по задаче */
  focusMinutes?: number;
}

export interface TaskList {
  id: ID;
  name: string;
  color: string;
  emoji?: string;
  order: number;
}

export type WhenFilter = 'any' | 'overdue' | 'today' | 'tomorrow' | 'week' | 'nodate' | 'hasdate';

/** Умный фильтр пользователя */
export interface TaskFilter {
  id: ID;
  name: string;
  color: string;
  lists?: ID[];
  tags?: string[];
  priorities?: number[];
  when?: WhenFilter;
  query?: string;
}

/** Запись о выполнении (для статистики и повторяющихся задач) */
export interface CompletionLog {
  taskId: ID;
  title: string;
  listId: ID;
  at: number;
  /** дата повторения, которое выполнили */
  date?: string;
}

export interface FocusSession {
  id: ID;
  start: number;
  minutes: number;
  taskId?: ID;
  kind: 'pomo' | 'stopwatch';
}

export interface Countdown {
  id: ID;
  title: string;
  date: string;
  emoji?: string;
  color: string;
  /** повторять каждый год (дни рождения, годовщины) */
  yearly?: boolean;
}

export interface TaskPrefs {
  /** напоминания включены */
  notify: boolean;
  /** напоминания по умолчанию для задач со временем */
  timedReminders: number[];
  /** напоминания по умолчанию для задач на весь день */
  allDayReminders: number[];
  /** записывать задачи в календарь телефона (Android) */
  calendarSync: boolean;
  calendarId?: string;
  /** показывать события календаря телефона в SuperMind */
  showPhoneEvents: boolean;
  pomo: { work: number; short: number; long: number; longEvery: number; autoNext: boolean };
  /** скрывать выполненные в списках */
  hideCompleted: boolean;
  sortBy: 'date' | 'priority' | 'title' | 'created';
  /** «настойчивое» напоминание — повторяется каждые N минут, пока не отметите (0 — выкл) */
  nag: number;
}

export interface TasksData {
  version: 1;
  tasks: TaskItem[];
  lists: TaskList[];
  filters: TaskFilter[];
  tagColors: Record<string, string>;
  log: CompletionLog[];
  focus: FocusSession[];
  countdowns: Countdown[];
  prefs: TaskPrefs;
  /** удалённое навсегда (id) — чтобы синхронизация не вернула его с другого устройства */
  gone?: Record<string, number>;
}

export const INBOX = 'inbox';

export const LIST_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ec4899', '#ef4444', '#14b8a6', '#f59e0b', '#6366f1', '#64748b'];

export const DEFAULT_PREFS: TaskPrefs = {
  notify: true,
  timedReminders: [0],
  allDayReminders: [540],
  calendarSync: false,
  showPhoneEvents: true,
  pomo: { work: 25, short: 5, long: 15, longEvery: 4, autoNext: false },
  hideCompleted: false,
  sortBy: 'date',
  nag: 0,
};

export function emptyTasksData(): TasksData {
  return {
    version: 1,
    tasks: [],
    lists: [
      { id: INBOX, name: 'Входящие', color: '#3b82f6', emoji: '📥', order: 0 },
      { id: 'personal', name: 'Личное', color: '#22c55e', emoji: '🏡', order: 1 },
      { id: 'work', name: 'Работа', color: '#f97316', emoji: '💼', order: 2 },
    ],
    filters: [],
    tagColors: {},
    log: [],
    focus: [],
    countdowns: [],
    prefs: structuredClone(DEFAULT_PREFS),
  };
}

// ================= Даты и время =================

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function timeOf(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** Начало задачи (локальное время) для даты повторения */
export function startAt(task: Pick<TaskItem, 'time'>, date: string): Date {
  const d = fromYmd(date);
  if (task.time) d.setMinutes(minutesOf(task.time));
  return d;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / 86400000);
}

export function mondayOf(ymd: string): string {
  const d = fromYmd(ymd);
  return addDaysYmd(ymd, -((d.getDay() + 6) % 7));
}

function addMonthsClamped(ymd: string, n: number, day?: number): string {
  const d = fromYmd(ymd);
  const want = day ?? d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(want, last));
  return toYmd(t);
}

function nthWeekdayOfMonth(y: number, m: number, n: number, wd: number): string | null {
  if (n === -1) {
    const last = new Date(y, m + 1, 0);
    while (last.getDay() !== wd) last.setDate(last.getDate() - 1);
    return toYmd(last);
  }
  const d = new Date(y, m, 1);
  while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + (n - 1) * 7);
  return d.getMonth() === m ? toYmd(d) : null;
}

/**
 * Закрепить в правиле день недели / число / месяц по дате задачи.
 * После этого перенос задачи на другой день не меняет расписание повторов.
 */
export function pinRule(rule: RepeatRule, date: string): RepeatRule {
  const d = fromYmd(date);
  const r = { ...rule };
  if (r.freq === 'weekly' && !r.weekdays?.length) r.weekdays = [d.getDay()];
  if (r.freq === 'monthly' && !r.monthWeek && !r.lastDay && !r.day) r.day = d.getDate();
  if (r.freq === 'yearly') {
    r.day ??= d.getDate();
    r.month ??= d.getMonth();
  }
  return r;
}

/** Следующая дата повторения строго после `from` (с учётом правила; без проверки until/count) */
export function nextOccurrence(rule: RepeatRule, from: string, anchor = from): string {
  const iv = Math.max(1, rule.interval || 1);
  switch (rule.freq) {
    case 'daily':
      return addDaysYmd(from, iv);
    case 'weekly': {
      const days = rule.weekdays?.length ? rule.weekdays : [fromYmd(anchor).getDay()];
      const aMon = mondayOf(anchor);
      for (let i = 1; i <= 7 * iv + 7; i++) {
        const d = addDaysYmd(from, i);
        const weeks = Math.round(daysBetween(aMon, mondayOf(d)) / 7);
        if (weeks % iv === 0 && days.includes(fromYmd(d).getDay())) return d;
      }
      return addDaysYmd(from, 7 * iv);
    }
    case 'monthly': {
      if (rule.monthWeek) {
        const f = fromYmd(from);
        for (let k = 0; k <= 24; k++) {
          const t = new Date(f.getFullYear(), f.getMonth() + k * 1, 1);
          const monthsFromAnchor = (t.getFullYear() - fromYmd(anchor).getFullYear()) * 12 + t.getMonth() - fromYmd(anchor).getMonth();
          if (monthsFromAnchor % iv !== 0) continue;
          const c = nthWeekdayOfMonth(t.getFullYear(), t.getMonth(), rule.monthWeek.n, rule.monthWeek.wd);
          if (c && c > from) return c;
        }
        return addMonthsClamped(from, iv);
      }
      if (rule.lastDay) return addMonthsClamped(from, iv, 31);
      return addMonthsClamped(from, iv, rule.day ?? fromYmd(anchor).getDate());
    }
    case 'yearly': {
      const a = fromYmd(anchor);
      const f = fromYmd(from);
      const month = rule.month ?? a.getMonth();
      const day = rule.day ?? a.getDate();
      // ближайший год, в котором дата повторения позже `from`
      for (let k = 0; k <= iv * 2; k += iv) {
        const t = new Date(f.getFullYear() + k, month, 1);
        const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
        t.setDate(Math.min(day, last));
        if (toYmd(t) > from) return toYmd(t);
      }
      return toYmd(new Date(f.getFullYear() + iv, month, Math.min(day, 28)));
    }
  }
}

function withinRule(rule: RepeatRule, date: string, doneCount: number): boolean {
  if (rule.until && date > rule.until) return false;
  if (rule.count && doneCount >= rule.count) return false;
  return true;
}

/** Даты повторений задачи в диапазоне [from, to] (для календаря и напоминаний) */
export function occurrences(task: TaskItem, from: string, to: string, limit = 400): string[] {
  if (!task.date) return [];
  if (!task.repeat || task.done) return task.date >= from && task.date <= to ? [task.date] : [];
  const out: string[] = [];
  let d = task.date;
  let n = task.repeatDone ?? 0;
  for (let i = 0; i < 5000 && out.length < limit && d <= to; i++) {
    if (!withinRule(task.repeat, d, n)) break;
    if (d >= from) out.push(d);
    // «от даты выполнения» — будущие даты неизвестны, показываем только ближайшую
    if (task.repeat.fromCompletion) break;
    d = nextOccurrence(task.repeat, d, task.date);
    n++;
  }
  return out;
}

/** Следующая дата после выполнения повторяющейся задачи; null — повторы закончились */
export function advanceRepeat(task: TaskItem, completedOn = todayYmd()): string | null {
  if (!task.repeat || !task.date) return null;
  const rule = task.repeat;
  const base = rule.fromCompletion ? completedOn : task.date;
  let next = nextOccurrence(rule, base, rule.fromCompletion ? completedOn : task.date);
  // пропущенные повторы не копятся: просроченная задача после выполнения переносится на ближайший день после сегодня
  if (!rule.fromCompletion) {
    for (let i = 0; i < 5000 && next <= completedOn; i++) next = nextOccurrence(rule, next, task.date);
  }
  if (!withinRule(rule, next, (task.repeatDone ?? 0) + 1)) return null;
  return next;
}

// ================= Напоминания =================

export interface ReminderFire {
  task: TaskItem;
  date: string;
  at: number;
  offset: number;
}

/** Все срабатывания напоминаний в интервале времени [fromMs, toMs] */
export function reminderFires(tasks: TaskItem[], fromMs: number, toMs: number): ReminderFire[] {
  const out: ReminderFire[] = [];
  const fromDay = toYmd(new Date(fromMs - 2 * 86400000));
  for (const t of tasks) {
    if (t.done || t.deleted || t.wontDo || !t.date || !t.reminders.length) continue;
    // напоминание «за 2 недели» срабатывает задолго до самой задачи — расширяем окно поиска
    const ahead = Math.max(2 * 1440, ...t.reminders.map((r) => -r + 1440));
    const toDay = toYmd(new Date(toMs + ahead * 60000));
    for (const d of occurrences(t, fromDay, toDay, 120)) {
      const base = startAt(t, d).getTime();
      for (const off of t.reminders) {
        const at = base + off * 60000;
        if (at >= fromMs && at <= toMs) out.push({ task: t, date: d, at, offset: off });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export const TIMED_REMINDER_OPTIONS: { v: number; label: string }[] = [
  { v: 0, label: 'В момент начала' },
  { v: -5, label: 'За 5 минут' },
  { v: -10, label: 'За 10 минут' },
  { v: -15, label: 'За 15 минут' },
  { v: -30, label: 'За 30 минут' },
  { v: -60, label: 'За 1 час' },
  { v: -120, label: 'За 2 часа' },
  { v: -1440, label: 'За 1 день' },
  { v: -2880, label: 'За 2 дня' },
  { v: -10080, label: 'За неделю' },
];

export const ALLDAY_REMINDER_OPTIONS: { v: number; label: string }[] = [
  { v: 540, label: 'В день срока (09:00)' },
  { v: -900, label: 'За 1 день (09:00)' },
  { v: -2340, label: 'За 2 дня (09:00)' },
  { v: -3780, label: 'За 3 дня (09:00)' },
  { v: -9540, label: 'За неделю (09:00)' },
];

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
export { plural };

export function reminderLabel(off: number, timed: boolean): string {
  const list = timed ? TIMED_REMINDER_OPTIONS : ALLDAY_REMINDER_OPTIONS;
  const known = list.find((o) => o.v === off);
  if (known) return known.label;
  if (timed) {
    const m = -off;
    if (m === 0) return 'В момент начала';
    if (m < 0) return `Через ${-m} мин после начала`;
    if (m % 1440 === 0) return `За ${m / 1440} ${plural(m / 1440, 'день', 'дня', 'дней')}`;
    if (m % 60 === 0) return `За ${m / 60} ${plural(m / 60, 'час', 'часа', 'часов')}`;
    return `За ${m} мин`;
  }
  const days = Math.ceil(-off / 1440);
  const t = timeOf(off + days * 1440);
  return days <= 0 ? `В день срока (${t})` : `За ${days} ${plural(days, 'день', 'дня', 'дней')} (${t})`;
}

/** «напомнить за N …» из текста: для задачи без времени — за нужное число дней в 09:00 */
export function parsedReminder(offset: number, timed: boolean): number {
  if (timed) return offset;
  return allDayOffset(Math.floor(-offset / 1440), '09:00');
}

/** Для задачи на весь день: напоминание «за N дней в HH:MM» */
export function allDayOffset(daysBefore: number, time: string): number {
  return -daysBefore * 1440 + minutesOf(time);
}

// ================= Повторы: подписи =================

const EVERY_WD = ['Каждое воскресенье', 'Каждый понедельник', 'Каждый вторник', 'Каждую среду', 'Каждый четверг', 'Каждую пятницу', 'Каждую субботу'];
export const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const NTH = { 1: 'первый', 2: 'второй', 3: 'третий', 4: 'четвёртый', [-1]: 'последний' } as Record<number, string>;

export function repeatLabel(r: RepeatRule): string {
  const iv = r.interval || 1;
  let s: string;
  switch (r.freq) {
    case 'daily':
      s = iv === 1 ? 'Каждый день' : `Каждые ${iv} ${plural(iv, 'день', 'дня', 'дней')}`;
      break;
    case 'weekly': {
      const wd = [...(r.weekdays ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const isWork = wd.length === 5 && [1, 2, 3, 4, 5].every((x) => wd.includes(x));
      const isWeekend = wd.length === 2 && wd.includes(0) && wd.includes(6);
      if (iv === 1 && isWork) s = 'По будням';
      else if (iv === 1 && isWeekend) s = 'По выходным';
      else {
        s = iv === 1 ? 'Каждую неделю' : `Каждые ${iv} ${plural(iv, 'неделю', 'недели', 'недель')}`;
        if (wd.length === 1) s = iv === 1 ? EVERY_WD[wd[0]] : `${s}: ${WD_SHORT[wd[0]]}`;
        else if (wd.length > 1) s += `: ${wd.map((x) => WD_SHORT[x]).join(', ')}`;
      }
      break;
    }
    case 'monthly':
      s = iv === 1 ? 'Каждый месяц' : `Каждые ${iv} ${plural(iv, 'месяц', 'месяца', 'месяцев')}`;
      if (r.monthWeek) s += ` (${NTH[r.monthWeek.n] ?? ''} ${WD_SHORT[r.monthWeek.wd].toLowerCase()})`;
      else if (r.lastDay) s += ' (последний день)';
      break;
    case 'yearly':
      s = iv === 1 ? 'Каждый год' : `Каждые ${iv} ${plural(iv, 'год', 'года', 'лет')}`;
      break;
  }
  if (r.fromCompletion) s += ', от даты выполнения';
  if (r.until) s += `, до ${fromYmd(r.until).toLocaleDateString('ru-RU')}`;
  if (r.count) s += `, ${r.count} ${plural(r.count, 'раз', 'раза', 'раз')}`;
  return s;
}

// ================= Подписи дат =================

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

export function dayLabel(date: string, today = todayYmd()): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  if (diff === 2) return 'Послезавтра';
  const d = fromYmd(date);
  if (diff > 2 && diff < 7) return WEEKDAYS[d.getDay()];
  const y = d.getFullYear() !== fromYmd(today).getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${y}`;
}

export function longDate(date: string): string {
  const d = fromYmd(date);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

export function shortDate(date: string): string {
  const d = fromYmd(date);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()].slice(0, 3)}`;
}

/** «Сегодня, 18:30–19:00» */
export function whenLabel(t: Pick<TaskItem, 'date' | 'time' | 'duration'>, today = todayYmd()): string {
  if (!t.date) return '';
  let s = dayLabel(t.date, today);
  if (t.time) {
    s += `, ${t.time}`;
    if (t.duration) s += `–${timeOf(minutesOf(t.time) + t.duration)}`;
  }
  return s;
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

// ================= Отбор и сортировка =================

export type SmartId = 'today' | 'tomorrow' | 'week' | 'inbox' | 'all' | 'completed' | 'trash' | 'nodate' | 'overdue' | 'maps';

export function isActive(t: TaskItem) {
  return !t.deleted && !t.done && !t.wontDo;
}

export function isOverdue(t: TaskItem, today = todayYmd(), now = Date.now()): boolean {
  if (!isActive(t) || !t.date) return false;
  if (t.date < today) return true;
  if (t.date === today && t.time) return startAt(t, t.date).getTime() + (t.duration ?? 0) * 60000 < now - 60000;
  return false;
}

export function matchesWhen(t: TaskItem, when: WhenFilter, today = todayYmd()): boolean {
  switch (when) {
    case 'any':
      return true;
    case 'overdue':
      return !!t.date && t.date < today;
    case 'today':
      return !!t.date && t.date <= today;
    case 'tomorrow':
      return t.date === addDaysYmd(today, 1);
    case 'week':
      return !!t.date && t.date <= addDaysYmd(today, 6);
    case 'nodate':
      return !t.date;
    case 'hasdate':
      return !!t.date;
  }
}

export function compareTasks(a: TaskItem, b: TaskItem, by: TaskPrefs['sortBy']): number {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  if (a.done !== b.done) return a.done ? 1 : -1;
  const pr = (p: number) => (p === 0 ? 9 : p);
  const dateKey = (t: TaskItem) => (t.date ?? '9999-99-99') + (t.time ?? '99:99');
  switch (by) {
    case 'priority':
      return pr(a.priority) - pr(b.priority) || dateKey(a).localeCompare(dateKey(b)) || a.order - b.order;
    case 'title':
      return a.title.localeCompare(b.title, 'ru');
    case 'created':
      return b.createdAt - a.createdAt;
    default:
      return dateKey(a).localeCompare(dateKey(b)) || pr(a.priority) - pr(b.priority) || a.order - b.order;
  }
}

/** Квадрант матрицы Эйзенхауэра (как в TickTick — по приоритету): 1 — высокий … 4 — без приоритета */
export function quadrantOf(t: TaskItem): 1 | 2 | 3 | 4 {
  return t.priority === 1 ? 1 : t.priority === 2 ? 2 : t.priority === 3 ? 3 : 4;
}

export const QUADRANTS: { q: 1 | 2 | 3 | 4; title: string; hint: string; color: string; priority: Priority }[] = [
  { q: 1, title: 'Срочно и важно', hint: 'Сделать сейчас', color: '#ef4444', priority: 1 },
  { q: 2, title: 'Важно, не срочно', hint: 'Запланировать', color: '#f97316', priority: 2 },
  { q: 3, title: 'Срочно, не важно', hint: 'Делегировать', color: '#3b82f6', priority: 3 },
  { q: 4, title: 'Не срочно и не важно', hint: 'Отложить или удалить', color: '#64748b', priority: 0 },
];
