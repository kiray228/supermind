import { create } from 'zustand';
import { get } from '../store/kv';
import { blobSync } from '../store/blobSync';
import { toast } from '../store/appStore';
import { uid } from '../utils/tree';
import { todayYmd } from '../utils/mapTasks';
import { addTask, ensureTasks, getTask, openTask, toggleDone, useTasks } from '../tasks/store';
import { addTransaction, deleteTransaction, ensureFinance, useFinance } from '../finance/store';
import { fmtMoney } from '../finance/model';
import { savingsInfo, setSavingsSource } from './savings';
import {
  AREA_COLORS,
  fmtNum,
  goalProgress,
  makeTaskLookup,
  normalizeGoal,
  normalizeGoalsData,
  sortedAreas,
  taskClosed,
  type Goal,
  type GoalHistoryEntry,
  type GoalsData,
  type GoalsPrefs,
  type GoalStage,
  type GoalStatus,
  type GoalStep,
  type LifeArea,
  type WheelSnapshot,
} from './model';

export { goalsDueBetween } from './model';
export type { GoalDue } from './model';

const KEY = 'goals';
const HISTORY_MAX = 300;

// копилки считают прогресс по остатку счёта в Финансах
setSavingsSource(() => useFinance.getState().data);

interface GoalsState {
  data: GoalsData | null;
  /** открытая карточка цели */
  openGoalId: string | null;
  /** праздничная анимация после выполнения цели */
  celebrate: { emoji: string; title: string; at: number } | null;
}

export const useGoals = create<GoalsState>(() => ({ data: null, openGoalId: null, celebrate: null }));

export const goalsData = () => useGoals.getState().data;

let loading: Promise<GoalsData> | null = null;

/** Загрузить цели (один раз). При первом запуске — сферы жизни по умолчанию */
export function ensureGoals(): Promise<GoalsData> {
  const cur = useGoals.getState().data;
  if (cur) return Promise.resolve(cur);
  if (!loading) {
    loading = (async () => {
      const d = normalizeGoalsData(await get<GoalsData>(KEY));
      useGoals.setState({ data: d });
      store.loaded();
      // есть копилки — подгружаем финансы, иначе прогресс будет 0%
      if (d.goals.some((g) => g.mode === 'savings')) void ensureFinance().catch(() => undefined);
      return d;
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

/** Перечитать из базы и заменить состояние (после синхронизации / восстановления копии) */
export async function reloadGoals(): Promise<void> {
  if (!useGoals.getState().data) {
    // ещё не загружали — загрузится свежее при открытии
    loading = null;
    return;
  }
  await store.reload();
  loading = Promise.resolve(useGoals.getState().data!);
}

// ---------- Сохранение ----------

/** Запись со слиянием: копия в памяти не перетирает пришедшее с другого устройства */
const store = blobSync<GoalsData>({
  key: KEY,
  read: () => useGoals.getState().data,
  write: (data) => useGoals.setState({ data }),
  normalize: (raw) => normalizeGoalsData(raw),
  onError: () => toast('Не удалось сохранить цели'),
});

/** Сохранить отложенные изменения (только если они есть) */
export function flushGoals(): Promise<void> {
  return store.flush();
}

/** Изменить данные целей: fn получает копию, сохранение — автоматически */
export function mutateGoals(fn: (d: GoalsData) => void) {
  const cur = useGoals.getState().data;
  if (!cur) return;
  const d = structuredClone(cur);
  fn(d);
  useGoals.setState({ data: d });
  store.schedule();
}

function markGone(d: GoalsData, id: string) {
  (d.gone ??= {})[id] = Date.now();
}

/** Изменить одну цель (с отметкой времени) */
function editGoal(id: string, fn: (g: Goal, d: GoalsData) => void) {
  mutateGoals((d) => {
    const g = d.goals.find((x) => x.id === id);
    if (!g) return;
    fn(g, d);
    g.updatedAt = Date.now();
  });
}

function log(g: Goal, text: string, extra: Partial<GoalHistoryEntry> = {}) {
  g.history.push({ id: uid(), at: Date.now(), text, ...extra });
  if (g.history.length > HISTORY_MAX) g.history.splice(0, g.history.length - HISTORY_MAX);
}

export function getGoal(id: string): Goal | undefined {
  return useGoals.getState().data?.goals.find((g) => g.id === id);
}

const lookup = () => makeTaskLookup(useTasks.getState().data?.tasks);

// ---------- Окна ----------

export function openGoal(id: string | null) {
  useGoals.setState({ openGoalId: id });
}

export function clearCelebration() {
  useGoals.setState({ celebrate: null });
}

// ---------- Сферы жизни ----------

export function addArea(name: string, emoji = '⭐', color?: string): LifeArea | null {
  const d = useGoals.getState().data;
  if (!d) return null;
  const a: LifeArea = {
    id: uid(),
    updatedAt: Date.now(),
    name,
    emoji,
    color: color ?? AREA_COLORS[d.areas.length % AREA_COLORS.length],
    order: d.areas.reduce((m, x) => Math.max(m, x.order), -1) + 1,
  };
  mutateGoals((x) => void x.areas.push(a));
  return a;
}

export function updateArea(id: string, patch: Partial<Omit<LifeArea, 'id'>>) {
  mutateGoals((d) => {
    const a = d.areas.find((x) => x.id === id);
    if (a) Object.assign(a, patch, { updatedAt: Date.now() });
  });
}

/** Удалить сферу: цели остаются без сферы, оценки колеса сохраняются в истории */
export function deleteArea(id: string) {
  mutateGoals((d) => {
    d.areas = d.areas.filter((a) => a.id !== id);
    markGone(d, id);
    const now = Date.now();
    for (const g of d.goals)
      if (g.areaId === id) {
        delete g.areaId;
        g.updatedAt = now;
      }
  });
}

export function moveArea(id: string, dir: -1 | 1) {
  mutateGoals((d) => {
    const list = sortedAreas(d);
    const i = list.findIndex((a) => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const now = Date.now();
    list.forEach((a, k) => {
      const x = d.areas.find((y) => y.id === a.id)!;
      if (x.order !== k) {
        x.order = k;
        x.updatedAt = now;
      }
    });
  });
}

// ---------- Цели ----------

export function addGoal(p: Partial<Goal>): Goal | null {
  if (!useGoals.getState().data) return null;
  const now = Date.now();
  const g = normalizeGoal({ ...p, id: uid(), createdAt: now, updatedAt: now });
  log(g, 'Цель создана', { kind: 'info' });
  mutateGoals((d) => void d.goals.unshift(g));
  return g;
}

export function updateGoal(id: string, patch: Partial<Omit<Goal, 'id'>>) {
  editGoal(id, (g) => {
    if (patch.mode && patch.mode !== g.mode && patch.mode === 'target' && !g.target && !patch.target)
      g.target = { start: 0, target: 10, current: 0, unit: '', step: 1 };
    Object.assign(g, patch);
    for (const k of Object.keys(g) as (keyof Goal)[]) if (g[k] === undefined) delete g[k];
  });
}

export function deleteGoal(id: string) {
  const g = getGoal(id);
  if (!g) return;
  const copy = structuredClone(g);
  mutateGoals((d) => {
    d.goals = d.goals.filter((x) => x.id !== id);
    markGone(d, id);
  });
  if (useGoals.getState().openGoalId === id) openGoal(null);
  toast('Цель удалена', {
    label: 'Отменить',
    run: () =>
      mutateGoals((d) => {
        if (d.gone) delete d.gone[id];
        d.goals.unshift({ ...copy, updatedAt: Date.now() });
      }),
  });
}

const STATUS_LOG: Record<GoalStatus, string> = {
  active: 'Цель снова активна',
  done: 'Цель выполнена 🎉',
  paused: 'Цель отложена',
  archived: 'Цель в архиве',
};

export function setGoalStatus(id: string, status: GoalStatus) {
  const g = getGoal(id);
  if (!g || g.status === status) return;
  const prev = g.status;
  editGoal(id, (x) => {
    x.status = status;
    if (status === 'done') x.completedAt = Date.now();
    else delete x.completedAt;
    log(x, STATUS_LOG[status], { kind: 'status' });
  });
  if (status === 'done') {
    useGoals.setState({ celebrate: { emoji: g.emoji, title: g.title, at: Date.now() } });
    toast('Цель достигнута! Поздравляем 🎉', { label: 'Отменить', run: () => setGoalStatus(id, prev) });
  } else if (status === 'paused') toast('Цель отложена');
  else if (status === 'archived') toast('Цель перенесена в архив');
}

/** Предложить завершить цель, когда прогресс дошёл до 100% */
function offerComplete(id: string, before: number) {
  const g = getGoal(id);
  if (!g || g.status !== 'active') return;
  const after = goalProgress(g, lookup());
  if (after >= 100 && before < 100) toast('Прогресс 100%! Завершить цель?', { label: 'Завершить', run: () => setGoalStatus(id, 'done') });
}

function withOffer(id: string, fn: () => void) {
  const g = getGoal(id);
  const before = g ? goalProgress(g, lookup()) : 0;
  fn();
  offerComplete(id, before);
}

/** Ручной процент. Подряд идущие изменения ползунка — одна запись в истории */
export function setManualProgress(id: string, pct: number) {
  withOffer(id, () =>
    editGoal(id, (g) => {
      g.manual = Math.round(pct);
      const last = g.history[g.history.length - 1];
      const text = `Прогресс: ${g.manual}%`;
      if (last?.kind === 'manual' && Date.now() - last.at < 60_000) {
        last.text = text;
        last.at = Date.now();
      } else log(g, text, { kind: 'manual' });
    }),
  );
}

/** Числовая цель: прибавить (или убавить) значение */
export function bumpTarget(id: string, delta: number, note?: string) {
  if (!delta) return;
  withOffer(id, () =>
    editGoal(id, (g) => {
      if (!g.target) return;
      g.target.current = Math.round((g.target.current + delta) * 1000) / 1000;
      const unit = g.target.unit ? ' ' + g.target.unit : '';
      log(g, `${delta > 0 ? '+' : '−'}${fmtNum(Math.abs(delta))}${unit} → ${fmtNum(g.target.current)}${note ? ` · ${note}` : ''}`, { kind: 'target', delta });
    }),
  );
}

/**
 * Пополнить копилку: перевод с другого счёта на счёт-копилку (операция в Финансах).
 * toAmount — сумма зачисления, если валюты счетов разные.
 */
export function depositToSavings(goalId: string, fromAccountId: string, amount: number, toAmount?: number): boolean {
  const g = getGoal(goalId);
  const sv = g?.savings;
  const fin = useFinance.getState().data;
  if (!g || !sv || !fin || !(amount > 0)) return false;
  const to = fin.accounts.find((a) => a.id === sv.accountId);
  if (!to) {
    toast('Счёт-копилка удалён');
    return false;
  }
  if (fromAccountId === to.id) return false;
  const before = goalProgress(g, lookup());
  const t = addTransaction(
    { type: 'transfer', amount, accountId: fromAccountId, toAccountId: to.id, ...(toAmount && toAmount > 0 ? { toAmount } : {}), date: todayYmd(), note: `Копилка: ${g.title}` },
    { silent: true },
  );
  if (!t) return false;
  const got = toAmount && toAmount > 0 ? toAmount : amount;
  let hid = '';
  editGoal(goalId, (x) => {
    log(x, `+${fmtMoney(got, to.currency)} в копилку`, { kind: 'target', delta: got });
    hid = x.history[x.history.length - 1].id;
  });
  const after = getGoal(goalId);
  const s = after ? savingsInfo(after) : null;
  if (s?.reached && before < 100 && after?.status === 'active') toast('Копилка собрана! 🎉 Завершить цель?', { label: 'Завершить', run: () => setGoalStatus(goalId, 'done') });
  else
    toast(`+${fmtMoney(got, to.currency)} в копилку`, {
      label: 'Отменить',
      run: () => {
        deleteTransaction(t.id, false);
        editGoal(goalId, (x) => void (x.history = x.history.filter((h) => h.id !== hid)));
      },
    });
  return true;
}

// ---------- Этапы и шаги ----------

function findStage(g: Goal, stageId: string): GoalStage | undefined {
  return g.stages.find((s) => s.id === stageId);
}

export function addStage(goalId: string, title: string, deadline?: string): GoalStage {
  const st: GoalStage = { id: uid(), title, steps: [], taskIds: [], ...(deadline ? { deadline } : {}) };
  editGoal(goalId, (g) => void g.stages.push(st));
  return st;
}

/** Добавить сразу несколько этапов с шагами (ИИ-разбивка). Возвращает id новых этапов */
export function addStages(goalId: string, items: { title: string; deadline?: string; steps: string[] }[]): string[] {
  const stages: GoalStage[] = items.map((it) => ({
    id: uid(),
    title: it.title,
    ...(it.deadline ? { deadline: it.deadline } : {}),
    steps: it.steps.map((t) => ({ id: uid(), title: t, done: false })),
    taskIds: [],
  }));
  editGoal(goalId, (g) => {
    g.stages.push(...stages);
    if (g.mode === 'manual' && g.manual === 0) g.mode = 'stages';
    log(g, `Добавлено этапов: ${stages.length}`, { kind: 'info' });
  });
  return stages.map((s) => s.id);
}

/** Удалить несколько этапов (отмена ИИ-разбивки) */
export function removeStages(goalId: string, ids: string[]) {
  editGoal(goalId, (g) => void (g.stages = g.stages.filter((s) => !ids.includes(s.id))));
}

export function updateStage(goalId: string, stageId: string, patch: Partial<Omit<GoalStage, 'id'>>) {
  editGoal(goalId, (g) => {
    const st = findStage(g, stageId);
    if (!st) return;
    Object.assign(st, patch);
    if (!st.deadline) delete st.deadline;
  });
}

export function deleteStage(goalId: string, stageId: string) {
  editGoal(goalId, (g) => void (g.stages = g.stages.filter((s) => s.id !== stageId)));
}

export function moveStage(goalId: string, stageId: string, dir: -1 | 1) {
  editGoal(goalId, (g) => {
    const i = g.stages.findIndex((s) => s.id === stageId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= g.stages.length) return;
    [g.stages[i], g.stages[j]] = [g.stages[j], g.stages[i]];
  });
}

/** Отметка этапа без шагов и задач */
export function toggleStageDone(goalId: string, stageId: string) {
  withOffer(goalId, () =>
    editGoal(goalId, (g) => {
      const st = findStage(g, stageId);
      if (!st) return;
      st.done = !st.done;
      if (st.done) log(g, `Этап выполнен: ${st.title}`, { kind: 'step' });
    }),
  );
}

export function addStep(goalId: string, stageId: string, title: string) {
  editGoal(goalId, (g) => void findStage(g, stageId)?.steps.push({ id: uid(), title, done: false }));
}

export function updateStep(goalId: string, stageId: string, stepId: string, patch: Partial<Omit<GoalStep, 'id'>>) {
  editGoal(goalId, (g) => {
    const s = findStage(g, stageId)?.steps.find((x) => x.id === stepId);
    if (s) Object.assign(s, patch);
  });
}

export function deleteStep(goalId: string, stageId: string, stepId: string) {
  editGoal(goalId, (g) => {
    const st = findStage(g, stageId);
    if (st) st.steps = st.steps.filter((s) => s.id !== stepId);
  });
}

/** Отметить шаг. Если из шага создана задача — она отмечается вместе с ним */
export function toggleStep(goalId: string, stageId: string, stepId: string) {
  const g = getGoal(goalId);
  const s = g && findStage(g, stageId)?.steps.find((x) => x.id === stepId);
  if (!g || !s) return;
  const task = s.taskId ? getTask(s.taskId) : undefined;
  const live = task && !task.deleted ? task : undefined;
  const wasDone = s.done || (!!live && taskClosed(live));
  withOffer(goalId, () => {
    editGoal(goalId, (x) => {
      const st = findStage(x, stageId);
      const sp = st?.steps.find((y) => y.id === stepId);
      if (!st || !sp) return;
      sp.done = !wasDone;
      if (sp.done) {
        sp.doneAt = Date.now();
        log(x, `Шаг выполнен: ${sp.title}`, { kind: 'step' });
      } else delete sp.doneAt;
    });
    if (live && (wasDone ? taskClosed(live) : !live.repeat && !taskClosed(live))) toggleDone(live.id);
  });
}

// ---------- Задачи ----------

/**
 * Создать настоящую задачу для цели, этапа или шага (тег «цель»).
 * Возвращает id задачи или null.
 */
export async function createGoalTask(goalId: string, title: string, opts: { stageId?: string; stepId?: string; date?: string } = {}): Promise<string | null> {
  await ensureTasks();
  const g = getGoal(goalId);
  if (!g || !title.trim()) return null;
  const t = addTask({
    title: title.trim(),
    ...(opts.date ? { date: opts.date } : {}),
    tags: ['цель'],
    notes: `Цель: ${g.emoji} ${g.title}`,
  });
  if (!t) return null;
  editGoal(goalId, (x) => {
    const st = opts.stageId ? findStage(x, opts.stageId) : undefined;
    const sp = st && opts.stepId ? st.steps.find((s) => s.id === opts.stepId) : undefined;
    if (sp) sp.taskId = t.id;
    else if (st) st.taskIds.push(t.id);
    else x.taskIds.push(t.id);
  });
  toast('Задача создана', { label: 'Открыть', run: () => openTask(t.id) });
  return t.id;
}

/** Привязать существующую задачу к цели (или к этапу) */
export function linkTask(goalId: string, taskId: string, stageId?: string) {
  editGoal(goalId, (g) => {
    const st = stageId ? findStage(g, stageId) : undefined;
    const list = st ? st.taskIds : g.taskIds;
    if (!list.includes(taskId)) list.push(taskId);
  });
}

/** Отвязать задачу от цели (сама задача остаётся) */
export function unlinkTask(goalId: string, taskId: string) {
  editGoal(goalId, (g) => {
    g.taskIds = g.taskIds.filter((x) => x !== taskId);
    for (const st of g.stages) {
      st.taskIds = st.taskIds.filter((x) => x !== taskId);
      for (const s of st.steps) if (s.taskId === taskId) delete s.taskId;
    }
  });
}

// ---------- Колесо баланса ----------

/** Сохранить оценку сфер. Повторная оценка в тот же день заменяет предыдущую */
export function saveWheel(scores: Record<string, number>, note: string, date = todayYmd()): WheelSnapshot | null {
  if (!useGoals.getState().data) return null;
  let saved: WheelSnapshot | null = null;
  mutateGoals((d) => {
    const now = Date.now();
    const same = d.wheel.find((w) => w.date === date);
    if (same) {
      same.scores = { ...scores };
      same.note = note;
      same.updatedAt = now;
      saved = same;
    } else {
      saved = { id: uid(), updatedAt: now, date, scores: { ...scores }, note };
      d.wheel.push(saved);
    }
  });
  return saved;
}

export function deleteWheel(id: string) {
  mutateGoals((d) => {
    d.wheel = d.wheel.filter((w) => w.id !== id);
    markGone(d, id);
  });
}

// ---------- Настройки ----------

export function setGoalsPrefs(patch: Partial<Omit<GoalsPrefs, 'updatedAt'>>) {
  mutateGoals((d) => void (d.prefs = { ...d.prefs, ...patch, updatedAt: Date.now() }));
}
