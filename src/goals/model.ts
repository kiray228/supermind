/**
 * Цели, сферы жизни и колесо баланса (как в MyLife).
 * Хранятся одним ключом 'goals'; у каждой сущности верхнего уровня есть id и updatedAt —
 * синхронизация сливает массивы по id, удалённые запоминаются в gone.
 */
import type { TaskItem } from '../tasks/model';
import { daysBetween, mondayOf, MONTHS, plural, shortDate } from '../tasks/model';
import { addDaysYmd, fromYmd, todayYmd, toYmd } from '../utils/mapTasks';
import { normalizeSavings, savingsInfo, savingsNext } from './savings';

export type GoalPeriod = 'year' | 'quarter' | 'month' | 'week' | 'custom';
export type GoalStatus = 'active' | 'done' | 'paused' | 'archived';
/** manual — ползунок, stages — этапы и шаги, target — числовая цель, tasks — связанные задачи, savings — копилка (остаток счёта в Финансах) */
export type ProgressMode = 'manual' | 'stages' | 'target' | 'tasks' | 'savings';
export type GoalPriority = 0 | 1 | 2 | 3;

export interface LifeArea {
  id: string;
  updatedAt: number;
  name: string;
  emoji: string;
  color: string;
  order: number;
}

export interface GoalStep {
  id: string;
  title: string;
  done: boolean;
  doneAt?: number;
  /** созданная из шага задача */
  taskId?: string;
}

export interface GoalStage {
  id: string;
  title: string;
  deadline?: string;
  steps: GoalStep[];
  /** задачи этапа (созданные или привязанные) */
  taskIds: string[];
  /** ручная отметка для этапа без шагов и задач */
  done?: boolean;
}

export interface GoalTarget {
  start: number;
  target: number;
  current: number;
  unit: string;
  /** шаг кнопок +/− */
  step: number;
}

/** Копилка: сколько накопить и на каком счёте лежат деньги */
export interface GoalSavings {
  /** счёт в Финансах */
  accountId: string;
  /** сколько накопить (в валюте цели) */
  amount: number;
  /** валюта цели (обычно — валюта счёта) */
  currency: string;
  /** остаток счёта при создании, который не засчитывается (нет — считается весь остаток) */
  base?: number;
}

export interface GoalHistoryEntry {
  id: string;
  at: number;
  text: string;
  /** изменение числовой цели */
  delta?: number;
  kind?: 'manual' | 'target' | 'step' | 'status' | 'info';
}

export interface Goal {
  id: string;
  updatedAt: number;
  createdAt: number;
  title: string;
  emoji: string;
  /** «зачем мне это» */
  why: string;
  notes: string;
  areaId?: string;
  period: GoalPeriod;
  start: string;
  deadline?: string;
  priority: GoalPriority;
  status: GoalStatus;
  mode: ProgressMode;
  /** процент для ручного режима */
  manual: number;
  target?: GoalTarget;
  /** режим «Копилка» (необязательное поле: старые версии его просто не знают) */
  savings?: GoalSavings;
  stages: GoalStage[];
  /** задачи, связанные с целью напрямую */
  taskIds: string[];
  history: GoalHistoryEntry[];
  completedAt?: number;
}

export interface WheelSnapshot {
  id: string;
  updatedAt: number;
  date: string;
  /** areaId → 1..10 */
  scores: Record<string, number>;
  note: string;
}

export type GoalsView = 'active' | 'areas' | 'done';

export interface GoalsPrefs {
  view: GoalsView;
  /** до какой даты (YYYY-MM) не напоминать оценить колесо */
  wheelSnooze?: string;
  updatedAt: number;
}

export interface GoalsData {
  version: 1;
  goals: Goal[];
  areas: LifeArea[];
  wheel: WheelSnapshot[];
  prefs: GoalsPrefs;
  gone?: Record<string, number>;
}

// ---------- Значения по умолчанию ----------

export const AREA_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#f97316', '#a855f7', '#14b8a6', '#6366f1', '#ef4444', '#64748b'];

/** Сферы по умолчанию. id постоянные — на разных устройствах не появятся дубликаты */
const DEFAULT_AREAS: [string, string, string, string][] = [
  ['area-health', 'Здоровье', '💪', '#22c55e'],
  ['area-career', 'Карьера', '💼', '#3b82f6'],
  ['area-finance', 'Финансы', '💰', '#f59e0b'],
  ['area-love', 'Отношения', '❤️', '#ec4899'],
  ['area-family', 'Семья', '👨‍👩‍👧', '#f97316'],
  ['area-growth', 'Саморазвитие', '📚', '#a855f7'],
  ['area-fun', 'Отдых и хобби', '🎨', '#14b8a6'],
  ['area-social', 'Окружение', '🤝', '#6366f1'],
];

export function defaultAreas(): LifeArea[] {
  // updatedAt = 1: любая правка пользователя на другом устройстве побеждает
  return DEFAULT_AREAS.map(([id, name, emoji, color], order) => ({ id, name, emoji, color, order, updatedAt: 1 }));
}

export const DEFAULT_GOALS_PREFS: GoalsPrefs = { view: 'active', updatedAt: 0 };

export function emptyGoalsData(): GoalsData {
  return { version: 1, goals: [], areas: defaultAreas(), wheel: [], prefs: { ...DEFAULT_GOALS_PREFS }, gone: {} };
}

export const GOAL_EMOJIS = ['🎯', '🏆', '🚀', '⭐', '💪', '🏃', '🧘', '🥗', '💼', '📈', '💰', '🏠', '🚗', '✈️', '❤️', '👨‍👩‍👧', '📚', '🎓', '🗣️', '🎨', '🎸', '📷', '🌱', '🤝'];

export const PERIODS: { v: GoalPeriod; label: string; group: string }[] = [
  { v: 'year', label: 'Год', group: 'Цели на год' },
  { v: 'quarter', label: 'Квартал', group: 'Цели на квартал' },
  { v: 'month', label: 'Месяц', group: 'Цели на месяц' },
  { v: 'week', label: 'Неделя', group: 'Цели на неделю' },
  { v: 'custom', label: 'Свой срок', group: 'Свой срок' },
];

export const STATUS_LABEL: Record<GoalStatus, string> = {
  active: 'Активна',
  done: 'Выполнена',
  paused: 'Отложена',
  archived: 'В архиве',
};

export const MODES: { v: ProgressMode; label: string; hint: string }[] = [
  { v: 'stages', label: 'Этапы', hint: 'Прогресс по выполненным шагам этапов' },
  { v: 'target', label: 'Число', hint: 'Например, 12 книг или 100 км' },
  { v: 'tasks', label: 'Задачи', hint: 'Прогресс по выполненным связанным задачам' },
  { v: 'manual', label: 'Вручную', hint: 'Процент выполнения задаёте сами' },
  { v: 'savings', label: 'Копилка', hint: 'Деньги на счёте в Финансах — прогресс по остатку' },
];

export const GOAL_PRIORITIES: { v: GoalPriority; label: string; color: string }[] = [
  { v: 0, label: 'Нет', color: 'var(--text-3)' },
  { v: 3, label: 'Низкий', color: '#3b82f6' },
  { v: 2, label: 'Средний', color: '#f97316' },
  { v: 1, label: 'Высокий', color: '#ef4444' },
];

// ---------- Нормализация ----------

export function normalizeGoal(g: Partial<Goal> & { id: string }): Goal {
  const now = Date.now();
  const savings = normalizeSavings(g.savings);
  const out: Goal = {
    updatedAt: now,
    createdAt: g.updatedAt ?? now,
    title: '',
    emoji: '🎯',
    why: '',
    notes: '',
    period: 'custom',
    start: todayYmd(),
    priority: 0,
    status: 'active',
    mode: 'stages',
    manual: 0,
    ...g,
    stages: (g.stages ?? []).map((s) => ({ ...s, steps: s.steps ?? [], taskIds: s.taskIds ?? [] })),
    taskIds: g.taskIds ?? [],
    history: g.history ?? [],
  };
  // битую копилку отбрасываем: цель покажет «выберите счёт»
  if (savings) out.savings = savings;
  else delete out.savings;
  return out;
}

export function normalizeGoalsData(raw: Partial<GoalsData> | undefined | null): GoalsData {
  if (!raw || typeof raw !== 'object') return emptyGoalsData();
  return {
    version: 1,
    goals: (raw.goals ?? []).filter((g) => g && g.id).map(normalizeGoal),
    areas: (raw.areas ?? []).filter((a) => a && a.id).map((a, i) => ({ ...a, order: a.order ?? i, updatedAt: a.updatedAt ?? 1 })),
    wheel: (raw.wheel ?? []).filter((w) => w && w.id).map((w) => ({ ...w, scores: w.scores ?? {}, note: w.note ?? '' })),
    prefs: { ...DEFAULT_GOALS_PREFS, ...(raw.prefs ?? {}) },
    gone: raw.gone ?? {},
  };
}

export const sortedAreas = (d: GoalsData) => [...d.areas].sort((a, b) => a.order - b.order);

// ---------- Периоды и сроки ----------

/** Границы периода, в который попадает ref (n — сдвиг на n периодов вперёд) */
export function periodRange(p: GoalPeriod, ref = todayYmd(), n = 0): { start: string; end: string } | null {
  const d = fromYmd(ref);
  const y = d.getFullYear();
  const m = d.getMonth();
  switch (p) {
    case 'year':
      return { start: `${y + n}-01-01`, end: `${y + n}-12-31` };
    case 'quarter': {
      const q = Math.floor(m / 3) + n;
      return { start: toYmd(new Date(y, q * 3, 1)), end: toYmd(new Date(y, q * 3 + 3, 0)) };
    }
    case 'month':
      return { start: toYmd(new Date(y, m + n, 1)), end: toYmd(new Date(y, m + n + 1, 0)) };
    case 'week': {
      const s = addDaysYmd(mondayOf(ref), n * 7);
      return { start: s, end: addDaysYmd(s, 6) };
    }
    default:
      return null;
  }
}

const QUARTERS = ['I', 'II', 'III', 'IV'];

export function periodLabel(g: Pick<Goal, 'period' | 'start' | 'deadline'>): string {
  const d = fromYmd(g.start);
  const y = d.getFullYear();
  switch (g.period) {
    case 'year':
      return `${y} год`;
    case 'quarter':
      return `${QUARTERS[Math.floor(d.getMonth() / 3)]} квартал ${y}`;
    case 'month':
      return `${MONTHS[d.getMonth()]} ${y}`;
    case 'week':
      return `Неделя ${shortDate(g.start)} – ${shortDate(g.deadline ?? addDaysYmd(g.start, 6))}`;
    default:
      return g.deadline ? `до ${fullDate(g.deadline)}` : 'Без срока';
  }
}

/** «5 окт 2026» */
export function fullDate(ymd: string): string {
  return `${shortDate(ymd)} ${fromYmd(ymd).getFullYear()}`;
}

export interface DeadlineInfo {
  text: string;
  state: 'overdue' | 'soon' | 'ok' | 'none' | 'done';
  days?: number;
}

export function deadlineInfo(g: Pick<Goal, 'deadline' | 'status' | 'completedAt'>, today = todayYmd()): DeadlineInfo {
  if (g.status === 'done') return { text: g.completedAt ? `выполнена ${shortDate(toYmd(new Date(g.completedAt)))}` : 'выполнена', state: 'done' };
  if (!g.deadline) return { text: 'без срока', state: 'none' };
  const n = daysBetween(today, g.deadline);
  if (n < 0) return { text: `просрочена на ${-n} ${plural(-n, 'день', 'дня', 'дней')}`, state: 'overdue', days: n };
  if (n === 0) return { text: 'последний день', state: 'soon', days: 0 };
  return { text: `${plural(n, 'остался', 'осталось', 'осталось')} ${n} ${plural(n, 'день', 'дня', 'дней')}`, state: n <= 7 ? 'soon' : 'ok', days: n };
}

/** Какая доля срока уже прошла (0..100) */
export function timeElapsed(g: Pick<Goal, 'start' | 'deadline'>, today = todayYmd()): number | null {
  if (!g.deadline) return null;
  const total = daysBetween(g.start, g.deadline) + 1;
  if (total <= 0) return 100;
  return clamp(Math.round(((daysBetween(g.start, today) + 1) / total) * 100), 0, 100);
}

// ---------- Прогресс ----------

export type TaskLookup = (id: string) => TaskItem | undefined;

export function makeTaskLookup(tasks: TaskItem[] | undefined): TaskLookup {
  const m = new Map<string, TaskItem>();
  for (const t of tasks ?? []) if (!t.deleted) m.set(t.id, t);
  return (id) => m.get(id);
}

export const taskClosed = (t: TaskItem) => t.done || !!t.wontDo;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Шаг выполнен: отмечен вручную или выполнена созданная из него задача */
export function stepDone(s: GoalStep, look: TaskLookup): boolean {
  if (s.done) return true;
  const t = s.taskId ? look(s.taskId) : undefined;
  return !!t && taskClosed(t);
}

export function stageUnits(st: GoalStage, look: TaskLookup): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const s of st.steps) {
    total++;
    if (stepDone(s, look)) done++;
  }
  for (const id of st.taskIds) {
    const t = look(id);
    if (!t) continue;
    total++;
    if (taskClosed(t)) done++;
  }
  if (!total) return { done: st.done ? 1 : 0, total: 1 };
  return { done, total };
}

export function stageDone(st: GoalStage, look: TaskLookup): boolean {
  const u = stageUnits(st, look);
  return u.done === u.total;
}

/** Все задачи цели: прямые, этапов и шагов (без повторов) */
export function linkedTaskIds(g: Goal): string[] {
  const s = new Set(g.taskIds);
  for (const st of g.stages) {
    for (const id of st.taskIds) s.add(id);
    for (const sp of st.steps) if (sp.taskId) s.add(sp.taskId);
  }
  return [...s];
}

export function targetPercent(t: GoalTarget | undefined): number {
  if (!t || t.target === t.start) return 0;
  return clamp(((t.current - t.start) / (t.target - t.start)) * 100, 0, 100);
}

export interface ProgressInfo {
  pct: number;
  done: number;
  total: number;
}

export function goalProgressInfo(g: Goal, look: TaskLookup): ProgressInfo {
  switch (g.mode) {
    case 'manual':
      return { pct: clamp(g.manual, 0, 100), done: 0, total: 0 };
    case 'target':
      return { pct: targetPercent(g.target), done: g.target?.current ?? 0, total: g.target?.target ?? 0 };
    case 'savings': {
      const s = savingsInfo(g);
      return { pct: s.pct, done: s.saved, total: s.amount };
    }
    case 'tasks': {
      let done = 0;
      let total = 0;
      for (const id of linkedTaskIds(g)) {
        const t = look(id);
        if (!t) continue;
        total++;
        if (taskClosed(t)) done++;
      }
      return { pct: total ? (done / total) * 100 : 0, done, total };
    }
    default: {
      let done = 0;
      let total = 0;
      for (const st of g.stages) {
        const u = stageUnits(st, look);
        done += u.done;
        total += u.total;
      }
      return { pct: total ? (done / total) * 100 : 0, done, total };
    }
  }
}

/** Прогресс цели 0..100 (выполненная — всегда 100) */
export function goalProgress(g: Goal, look: TaskLookup): number {
  if (g.status === 'done') return 100;
  return Math.round(goalProgressInfo(g, look).pct);
}

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

/** Следующий шаг для карточки цели */
export function nextStep(g: Goal, look: TaskLookup): string | null {
  if (g.status === 'done') return null;
  if (g.mode === 'savings') return savingsNext(g);
  if (g.mode === 'target' && g.target) {
    const left = g.target.target - g.target.current;
    if ((g.target.target >= g.target.start && left > 0) || (g.target.target < g.target.start && left < 0))
      return `Осталось ${fmtNum(Math.abs(left))}${g.target.unit ? ' ' + g.target.unit : ''}`;
    return 'Цель по числу достигнута';
  }
  if (g.mode === 'tasks') {
    for (const id of linkedTaskIds(g)) {
      const t = look(id);
      if (t && !taskClosed(t)) return t.title;
    }
  }
  for (const st of g.stages) {
    const s = st.steps.find((x) => !stepDone(x, look));
    if (s) return s.title;
    const t = st.taskIds.map(look).find((x) => x && !taskClosed(x));
    if (t) return t.title;
    if (!st.steps.length && !st.taskIds.length && !st.done) return st.title;
  }
  return null;
}

/** Ближайший невыполненный этап со сроком */
export function currentStage(g: Goal, look: TaskLookup): GoalStage | undefined {
  return g.stages.find((s) => !stageDone(s, look));
}

/** Сортировка: сначала со сроком (ближайшие), затем по важности */
export function compareGoals(a: Goal, b: Goal): number {
  const da = a.deadline ?? '9999';
  const db = b.deadline ?? '9999';
  if (da !== db) return da < db ? -1 : 1;
  const pa = a.priority || 9;
  const pb = b.priority || 9;
  if (pa !== pb) return pa - pb;
  return a.createdAt - b.createdAt;
}

// ---------- Для календаря ----------

export interface GoalDue {
  id: string;
  goalId: string;
  title: string;
  date: string;
  emoji: string;
  kind: 'goal' | 'stage';
}

/** Сроки целей и их этапов в диапазоне [fromYmd, toYmd] (только активные цели) */
export function goalsDueBetween(data: GoalsData | null | undefined, fromYmd: string, toYmd: string): GoalDue[] {
  const out: GoalDue[] = [];
  if (!data) return out;
  for (const g of data.goals) {
    if (g.status !== 'active') continue;
    if (g.deadline && g.deadline >= fromYmd && g.deadline <= toYmd)
      out.push({ id: g.id, goalId: g.id, title: g.title, date: g.deadline, emoji: g.emoji, kind: 'goal' });
    for (const st of g.stages) {
      if (!st.deadline || st.deadline < fromYmd || st.deadline > toYmd) continue;
      // этап считаем выполненным, только если отмечены все его шаги (задачи здесь не учитываются)
      if (st.steps.length ? st.steps.every((s) => s.done) : st.done) continue;
      out.push({ id: `${g.id}:${st.id}`, goalId: g.id, title: `${g.title}: ${st.title}`, date: st.deadline, emoji: g.emoji, kind: 'stage' });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------- Колесо баланса ----------

export function wheelSorted(d: GoalsData): WheelSnapshot[] {
  return [...d.wheel].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.updatedAt - a.updatedAt));
}

export function wheelAverage(s: WheelSnapshot, areas: LifeArea[]): number | null {
  const v = areas.map((a) => s.scores[a.id]).filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((p, c) => p + c, 0) / v.length : null;
}

/** Самые слабые сферы (с наименьшей оценкой, до двух) */
export function weakestAreas(s: WheelSnapshot, areas: LifeArea[]): LifeArea[] {
  const rated = areas.filter((a) => typeof s.scores[a.id] === 'number');
  if (!rated.length) return [];
  const min = Math.min(...rated.map((a) => s.scores[a.id]));
  if (rated.every((a) => s.scores[a.id] === min)) return [];
  return rated.filter((a) => s.scores[a.id] === min).slice(0, 2);
}

/** Пора ли снова оценить колесо (нет оценок или последней больше 30 дней) */
export function wheelDue(d: GoalsData, today = todayYmd()): boolean {
  if (d.prefs.wheelSnooze && d.prefs.wheelSnooze >= today.slice(0, 7)) return false;
  const last = wheelSorted(d)[0];
  return !last || daysBetween(last.date, today) >= 30;
}
