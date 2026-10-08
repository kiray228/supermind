/**
 * Опыт, уровни и достижения (как в MyLife).
 * Опыт не хранится — он ВЫЧИСЛЯЕТСЯ из уже существующих данных (задачи, привычки, дневник, фокус,
 * цели, финансы, заметки и карты). Поэтому он одинаков на всех устройствах и не может «разъехаться».
 */
import type { DocMeta, PlannerData } from '../types';
import type { TasksData } from '../tasks/model';
import type { GoalsData } from '../goals/model';
import type { FinanceData } from '../finance/model';
import { accountMap, txMain } from '../finance/model';
import type { NotesData } from '../notes/model';
import { addDaysYmd, fromYmd, toYmd } from '../utils/mapTasks';

// ================= Сферы =================

export type AreaId = 'tasks' | 'habits' | 'goals' | 'focus' | 'journal' | 'finance' | 'knowledge';
export const AREA_IDS: AreaId[] = ['tasks', 'habits', 'goals', 'focus', 'journal', 'finance', 'knowledge'];
const AREA_INDEX: Record<AreaId, number> = { tasks: 0, habits: 1, goals: 2, focus: 3, journal: 4, finance: 5, knowledge: 6 };

// ================= Таблица опыта =================

export const XP = {
  task: 10,
  taskHigh: 5,
  taskMedium: 2,
  checkItem: 2,
  habit: 5,
  journal: 10,
  journalLong: 5,
  /** длина записи, после которой начисляется бонус */
  journalLongChars: 280,
  mood: 3,
  focusPerMin: 1,
  /** не больше стольких XP за фокус в день */
  focusDayCap: 240,
  goalCreated: 10,
  goalDone: 100,
  step: 15,
  stage: 25,
  /** обновление прогресса цели — раз в день на цель */
  goalUpdate: 5,
  wheel: 20,
  financeDay: 5,
  financeTx: 1,
  financeTxCap: 5,
  budgetMonth: 30,
  debtClosed: 25,
  note: 5,
  notesDayCap: 5,
  map: 15,
  mapsDayCap: 3,
} as const;

// ================= Уровни =================

/** Сколько всего опыта нужно для уровня n: 2 → 50, 3 → 150, 5 → 460, 10 → 1680, 20 → 5560, 50 → 25 350 */
export function xpForLevel(n: number): number {
  if (n <= 1) return 0;
  return Math.round((50 * Math.pow(n - 1, 1.6)) / 5) * 5;
}

export const LEVEL_TITLES: [number, string][] = [
  [1, 'Новичок'],
  [3, 'Ученик'],
  [5, 'Исследователь'],
  [8, 'Практик'],
  [11, 'Целеустремлённый'],
  [15, 'Стратег'],
  [20, 'Эксперт'],
  [25, 'Наставник'],
  [30, 'Мудрец'],
  [40, 'Легенда'],
  [50, 'Мастер жизни'],
];

export function levelTitle(level: number): string {
  let t = LEVEL_TITLES[0][1];
  for (const [from, name] of LEVEL_TITLES) if (level >= from) t = name;
  return t;
}

export interface LevelInfo {
  level: number;
  title: string;
  /** весь опыт */
  xp: number;
  /** опыт внутри текущего уровня */
  cur: number;
  /** сколько опыта в текущем уровне всего */
  need: number;
  /** 0..1 */
  pct: number;
  /** сколько всего опыта нужно для следующего уровня */
  nextAt: number;
}

export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  while (level < 999 && xpForLevel(level + 1) <= xp) level++;
  const base = xpForLevel(level);
  const nextAt = xpForLevel(level + 1);
  const need = nextAt - base;
  const cur = xp - base;
  return { level, title: levelTitle(level), xp, cur, need, pct: need > 0 ? Math.min(1, cur / need) : 1, nextAt };
}

// ================= Подсчёт =================

export interface Counters {
  activeDays: number;
  streak: number;
  bestStreak: number;
  tasksDone: number;
  highTasks: number;
  earlyTasks: number;
  lateTasks: number;
  bestTaskDay: number;
  checkItems: number;
  habitChecks: number;
  bestHabitStreak: number;
  journalEntries: number;
  journalStreak: number;
  bestJournalStreak: number;
  moodDays: number;
  focusSessions: number;
  focusMinutes: number;
  bestFocusDay: number;
  goalsCreated: number;
  goalsDone: number;
  stepsDone: number;
  stagesDone: number;
  wheelCount: number;
  financeDays: number;
  budgetMonths: number;
  debtsClosed: number;
  notes: number;
  maps: number;
  /** в скольких сферах есть опыт */
  areasTouched: number;
  /** наибольшее число сфер с опытом за один день */
  bestAreasDay: number;
  level: number;
}

export interface ProgressStats {
  total: number;
  byArea: Record<AreaId, number>;
  /** день → опыт по сферам (в порядке AREA_IDS) */
  byDay: Map<string, number[]>;
  /** день → всего опыта */
  dayTotal: Map<string, number>;
  today: string;
  todayXp: number;
  weekXp: number;
  level: LevelInfo;
  counters: Counters;
}

export interface ProgressInput {
  tasks: TasksData | null;
  goals: GoalsData | null;
  finance: FinanceData | null;
  notes: NotesData | null;
  planner: PlannerData | null;
  docs: DocMeta[] | null;
}

const dayOf = (ms: number) => toYmd(new Date(ms));

/**
 * Серии подряд идущих дней: лучшая и текущая (текущая может закончиться вчера).
 * `bridge` — дни-мостики (пропуск, пауза привычки): серию не рвут и не продлевают.
 */
export function streaks(days: Iterable<string>, today: string, bridge?: (ymd: string) => boolean): { best: number; current: number } {
  const sorted = [...new Set(days)].filter((d) => d <= today).sort();
  // между a и b (не включая) только мостики
  const linked = (a: string, b: string) => {
    let x = addDaysYmd(a, 1);
    for (let i = 0; x < b && i < 400; i++, x = addDaysYmd(x, 1)) if (!bridge?.(x)) return false;
    return x === b;
  };
  let best = 0;
  let run = 0;
  let prev = '';
  for (const d of sorted) {
    run = prev && linked(prev, d) ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  const last = sorted[sorted.length - 1];
  const current = last && (last === today || linked(last, today)) ? run : 0;
  return { best, current };
}

export function computeProgress(src: ProgressInput, today: string): ProgressStats {
  const byDay = new Map<string, number[]>();
  const byArea = Object.fromEntries(AREA_IDS.map((a) => [a, 0])) as Record<AreaId, number>;
  const add = (area: AreaId, day: string, xp: number) => {
    if (xp <= 0 || !day) return;
    let row = byDay.get(day);
    if (!row) byDay.set(day, (row = [0, 0, 0, 0, 0, 0, 0]));
    row[AREA_INDEX[area]] += xp;
    byArea[area] += xp;
  };
  const c: Counters = {
    activeDays: 0, streak: 0, bestStreak: 0, tasksDone: 0, highTasks: 0, earlyTasks: 0, lateTasks: 0, bestTaskDay: 0,
    checkItems: 0, habitChecks: 0, bestHabitStreak: 0, journalEntries: 0, journalStreak: 0, bestJournalStreak: 0,
    moodDays: 0, focusSessions: 0, focusMinutes: 0, bestFocusDay: 0, goalsCreated: 0, goalsDone: 0, stepsDone: 0,
    stagesDone: 0, wheelCount: 0, financeDays: 0, budgetMonths: 0, debtsClosed: 0, notes: 0, maps: 0,
    areasTouched: 0, bestAreasDay: 0, level: 1,
  };

  // ---------- Дела ----------
  const t = src.tasks;
  if (t) {
    const byId = new Map(t.tasks.map((x) => [x.id, x]));
    const logged = new Set<string>();
    const perDay = new Map<string, number>();
    const doneAt = (at: number, priority: number | undefined) => {
      const day = dayOf(at);
      let xp = XP.task;
      if (priority === 1) {
        xp += XP.taskHigh;
        c.highTasks++;
      } else if (priority === 2) xp += XP.taskMedium;
      add('tasks', day, xp);
      c.tasksDone++;
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      const h = new Date(at).getHours();
      if (h >= 4 && h < 9) c.earlyTasks++;
      else if (h >= 23 || h < 4) c.lateTasks++;
    };
    for (const l of t.log) {
      logged.add(l.taskId);
      doneAt(l.at, byId.get(l.taskId)?.priority);
    }
    for (const x of t.tasks) {
      // выполненные без записи в журнале (старые задачи ежедневника, обрезанный журнал)
      if (x.done && x.completedAt && !logged.has(x.id)) doneAt(x.completedAt, x.priority);
      if (x.deleted) continue;
      let n = 0;
      for (const ci of x.checklist ?? []) if (ci.done) n++;
      if (n) {
        c.checkItems += n;
        add('tasks', dayOf(x.completedAt ?? x.updatedAt), n * XP.checkItem);
      }
    }
    for (const n of perDay.values()) if (n > c.bestTaskDay) c.bestTaskDay = n;

    // ---------- Фокус ----------
    const focusDay = new Map<string, number>();
    for (const s of t.focus) {
      if (!(s.minutes > 0)) continue;
      c.focusSessions++;
      c.focusMinutes += s.minutes;
      const day = dayOf(s.start);
      focusDay.set(day, (focusDay.get(day) ?? 0) + s.minutes);
    }
    for (const [day, min] of focusDay) {
      if (min > c.bestFocusDay) c.bestFocusDay = min;
      add('focus', day, Math.min(XP.focusDayCap, Math.round(min * XP.focusPerMin)));
    }
  }

  // ---------- Привычки и дневник ----------
  const p = src.planner;
  if (p?.days) {
    const habitDays = new Map<string, string[]>();
    const journalDays: string[] = [];
    for (const [day, d] of Object.entries(p.days)) {
      if (!d || day > today) continue;
      const hs = Array.isArray(d.habits) ? new Set(d.habits) : null;
      if (hs?.size) {
        c.habitChecks += hs.size;
        add('habits', day, hs.size * XP.habit);
        for (const id of hs) {
          let arr = habitDays.get(id);
          if (!arr) habitDays.set(id, (arr = []));
          arr.push(day);
        }
      }
      const text = typeof d.journal === 'string' ? d.journal.trim() : '';
      if (text) {
        c.journalEntries++;
        journalDays.push(day);
        add('journal', day, XP.journal + (text.length >= XP.journalLongChars ? XP.journalLong : 0));
      }
      if (d.mood) {
        c.moodDays++;
        add('journal', day, XP.mood);
      }
    }
    // пропуск дня и пауза привычки — мостик в серии (без опыта, но и без штрафа)
    const pausesOf = new Map<string, { from: string; to: string }[]>();
    for (const h of Array.isArray(p.habits) ? p.habits : []) if (h && Array.isArray(h.pauses) && h.pauses.length) pausesOf.set(h.id, h.pauses);
    for (const [id, days] of habitDays) {
      const pauses = pausesOf.get(id);
      const bridge = (d: string) => !!p.days[d]?.skipped?.includes(id) || !!pauses?.some((x) => x.from <= d && d <= x.to);
      const s = streaks(days, today, bridge);
      if (s.best > c.bestHabitStreak) c.bestHabitStreak = s.best;
    }
    const js = streaks(journalDays, today);
    c.journalStreak = js.current;
    c.bestJournalStreak = js.best;
  }

  // ---------- Цели ----------
  const g = src.goals;
  if (g) {
    for (const goal of g.goals) {
      c.goalsCreated++;
      add('goals', dayOf(goal.createdAt), XP.goalCreated);
      if (goal.status === 'done' && goal.completedAt) {
        c.goalsDone++;
        add('goals', dayOf(goal.completedAt), XP.goalDone);
      }
      for (const st of goal.stages ?? []) {
        let last = 0;
        let doneSteps = 0;
        for (const sp of st.steps ?? []) {
          if (!sp.done) continue;
          doneSteps++;
          c.stepsDone++;
          const at = sp.doneAt ?? goal.updatedAt;
          if (at > last) last = at;
          add('goals', dayOf(at), XP.step);
        }
        const stageDone = st.done || (st.steps?.length > 0 && doneSteps === st.steps.length);
        if (stageDone) {
          c.stagesDone++;
          add('goals', dayOf(last || goal.updatedAt), XP.stage);
        }
      }
      const updDays = new Set<string>();
      for (const h of goal.history ?? []) if (h.kind === 'target' || h.kind === 'manual') updDays.add(dayOf(h.at));
      for (const day of updDays) add('goals', day, XP.goalUpdate);
    }
    for (const w of g.wheel ?? []) {
      c.wheelCount++;
      add('goals', w.date, XP.wheel);
    }
  }

  // ---------- Финансы ----------
  const f = src.finance;
  if (f) {
    const txPerDay = new Map<string, number>();
    const accs = accountMap(f);
    const spent = new Map<string, number>();
    const expenseMonths = new Set<string>();
    for (const tx of f.transactions) {
      if (tx.date > today) continue;
      txPerDay.set(tx.date, (txPerDay.get(tx.date) ?? 0) + 1);
      if (tx.type === 'expense') {
        const m = tx.date.slice(0, 7);
        const v = txMain(f, tx, accs);
        expenseMonths.add(m);
        spent.set(m, (spent.get(m) ?? 0) + v);
        if (tx.categoryId) spent.set(m + '|' + tx.categoryId, (spent.get(m + '|' + tx.categoryId) ?? 0) + v);
      }
    }
    for (const [day, n] of txPerDay) {
      c.financeDays++;
      add('finance', day, XP.financeDay + Math.min(XP.financeTxCap, n * XP.financeTx));
    }
    // бюджет соблюдён: завершённые месяцы после установки бюджета, траты не превысили лимит
    const curMonth = today.slice(0, 7);
    for (const b of f.budgets) {
      if (!(b.limit > 0)) continue;
      const from = dayOf(b.updatedAt || 0).slice(0, 7);
      for (const m of expenseMonths) {
        if (m <= from || m >= curMonth) continue;
        const v = spent.get(b.categoryId ? m + '|' + b.categoryId : m) ?? 0;
        if (v <= b.limit) {
          c.budgetMonths++;
          add('finance', lastDayOfMonth(m), XP.budgetMonth);
        }
      }
    }
    for (const dbt of f.debts ?? []) {
      if (!dbt.closed) continue;
      c.debtsClosed++;
      add('finance', dayOf(dbt.updatedAt), XP.debtClosed);
    }
  }

  // ---------- Заметки и карты ----------
  const capped = (dates: number[], cap: number, xp: number) => {
    const per = new Map<string, number>();
    for (const at of dates) {
      const day = dayOf(at);
      const n = per.get(day) ?? 0;
      per.set(day, n + 1);
      if (n < cap) add('knowledge', day, xp);
    }
  };
  if (src.notes) {
    const list = src.notes.notes.filter((n) => !n.trashed);
    c.notes = list.length;
    capped(list.map((n) => n.createdAt), XP.notesDayCap, XP.note);
  }
  if (src.docs) {
    const list = src.docs.filter((d) => !d.trashed);
    c.maps = list.length;
    capped(list.map((d) => d.createdAt), XP.mapsDayCap, XP.map);
  }

  // ---------- Итоги ----------
  const dayTotal = new Map<string, number>();
  let total = 0;
  for (const [day, row] of byDay) {
    let s = 0;
    let areas = 0;
    for (const v of row) {
      s += v;
      if (v > 0) areas++;
    }
    dayTotal.set(day, s);
    total += s;
    if (areas > c.bestAreasDay) c.bestAreasDay = areas;
  }
  const active = [...dayTotal.keys()].filter((d) => d <= today);
  c.activeDays = active.length;
  const st = streaks(active, today);
  c.streak = st.current;
  c.bestStreak = st.best;
  c.areasTouched = AREA_IDS.filter((a) => byArea[a] > 0).length;

  const level = levelInfo(total);
  c.level = level.level;

  const monday = addDaysYmd(today, -((fromYmd(today).getDay() + 6) % 7));
  let weekXp = 0;
  for (let d = monday; d <= today; d = addDaysYmd(d, 1)) weekXp += dayTotal.get(d) ?? 0;

  return { total, byArea, byDay, dayTotal, today, todayXp: dayTotal.get(today) ?? 0, weekXp, level, counters: c };
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return toYmd(new Date(y, m, 0));
}

// одна общая «память» на все компоненты: пересчёт только при изменении данных
let cache: { src: ProgressInput; today: string; out: ProgressStats } | null = null;

export function computeProgressCached(src: ProgressInput, today: string): ProgressStats {
  if (
    cache &&
    cache.today === today &&
    cache.src.tasks === src.tasks &&
    cache.src.goals === src.goals &&
    cache.src.finance === src.finance &&
    cache.src.notes === src.notes &&
    cache.src.planner === src.planner &&
    cache.src.docs === src.docs
  )
    return cache.out;
  const out = computeProgress(src, today);
  cache = { src, today, out };
  return out;
}
