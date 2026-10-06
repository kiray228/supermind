import { create } from 'zustand';
import { get, set } from '../store/kv';
import type { ID, PlannerData } from '../types';
import { uid } from '../utils/tree';
import { todayYmd, updateMapTask } from '../utils/mapTasks';
import { toast } from '../store/appStore';
import { focusQuickInput } from '../ui/keyboard';
import {
  advanceRepeat,
  pinRule,
  type ChecklistItem,
  DEFAULT_PREFS,
  dayLabel,
  emptyTasksData,
  INBOX,
  LIST_COLORS,
  type Countdown,
  type FocusSession,
  type TaskFilter,
  type TaskItem,
  type TaskList,
  type TaskPrefs,
  type TasksData,
} from './model';

const KEY = 'tasks';

interface TasksState {
  data: TasksData | null;
  /** открытая карточка задачи (окно подробностей поверх любого раздела) */
  openTaskId: ID | null;
  /** быстрое добавление: окно с предзаполненными полями */
  quickAdd: Partial<TaskItem> | null;
}

export const useTasks = create<TasksState>(() => ({ data: null, openTaskId: null, quickAdd: null }));

let loading: Promise<TasksData> | null = null;

function normalize(raw: Partial<TasksData> | undefined): TasksData {
  const base = emptyTasksData();
  if (!raw) return base;
  const d: TasksData = {
    ...base,
    ...raw,
    lists: raw.lists?.length ? raw.lists : base.lists,
    tasks: (raw.tasks ?? []).map((t) => ({
      ...t,
      tags: t.tags ?? [],
      reminders: t.reminders ?? [],
      checklist: t.checklist ?? [],
      priority: t.priority ?? 0,
      ...(t.repeat && t.date ? { repeat: pinRule(t.repeat, t.date) } : {}),
    })),
    filters: raw.filters ?? [],
    tagColors: raw.tagColors ?? {},
    log: raw.log ?? [],
    focus: raw.focus ?? [],
    countdowns: raw.countdowns ?? [],
    prefs: { ...DEFAULT_PREFS, ...(raw.prefs ?? {}), pomo: { ...DEFAULT_PREFS.pomo, ...(raw.prefs?.pomo ?? {}) } },
  };
  if (!d.lists.some((l) => l.id === INBOX)) d.lists.unshift(base.lists[0]);
  return d;
}

/** Загрузить задачи (один раз). Заодно переносит старые задачи ежедневника в общий список задач */
export function ensureTasks(): Promise<TasksData> {
  if (useTasks.getState().data) return Promise.resolve(useTasks.getState().data!);
  if (!loading) {
    loading = (async () => {
      const d = normalize(await get<TasksData>(KEY));
      await absorbPlanner(d);
      useTasks.setState({ data: d });
      return d;
    })().catch((e) => {
      // следующая попытка загрузки начнётся заново
      loading = null;
      throw e;
    });
  }
  return loading;
}

/** Перезагрузить из базы (после восстановления резервной копии) */
export async function reloadTasks() {
  loading = null;
  useTasks.setState({ data: null });
  await ensureTasks();
}

/** Задачи дня из ежедневника (версии до 1.4) переезжают в общий список задач */
async function absorbPlanner(d: TasksData) {
  const p = await get<PlannerData>('planner');
  if (!p?.days) return;
  let moved = 0;
  for (const [ymd, day] of Object.entries(p.days)) {
    if (!day.tasks?.length) continue;
    for (const pt of day.tasks) {
      d.tasks.push(
        makeTask(d, {
          title: pt.text,
          date: ymd,
          time: pt.time,
          priority: (pt.priority ?? 0) as TaskItem['priority'],
          done: pt.done,
          completedAt: pt.done ? Date.now() : undefined,
          reminders: [],
        }),
      );
      moved++;
    }
    day.tasks = [];
  }
  if (!moved) return;
  await set(KEY, d);
  await set('planner', p);
}

// ---------- Сохранение ----------

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function flushTasks(): Promise<void> {
  // сохраняем только несохранённые изменения: иначе вкладка со старыми данными перезапишет свежие
  if (!saveTimer) return Promise.resolve();
  clearTimeout(saveTimer);
  saveTimer = null;
  const d = useTasks.getState().data;
  return d ? set(KEY, d).catch(() => toast('Не удалось сохранить задачи')) : Promise.resolve();
}

/** Изменить данные задач: fn получает копию, изменения сохраняются автоматически */
export function mutateTasks(fn: (d: TasksData) => void) {
  const cur = useTasks.getState().data;
  if (!cur) return;
  const d = structuredClone(cur);
  fn(d);
  useTasks.setState({ data: d });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushTasks(), 250);
}

export const tasksData = () => useTasks.getState().data;

// ---------- Задачи ----------

export function defaultReminders(d: TasksData, timed: boolean): number[] {
  return [...(timed ? d.prefs.timedReminders : d.prefs.allDayReminders)];
}

function makeTask(d: TasksData, p: Partial<TaskItem>): TaskItem {
  const now = Date.now();
  const listId = p.listId && d.lists.some((l) => l.id === p.listId) ? p.listId : INBOX;
  return {
    id: uid(),
    title: '',
    listId,
    done: false,
    createdAt: now,
    updatedAt: now,
    priority: 0,
    tags: [],
    checklist: [],
    order: -now,
    ...p,
    reminders: p.reminders ?? (p.date ? defaultReminders(d, !!p.time) : []),
  } as TaskItem;
}

export function addTask(p: Partial<TaskItem>): TaskItem | null {
  const d = useTasks.getState().data;
  if (!d) return null;
  const t = makeTask(d, p);
  t.listId = p.listId && d.lists.some((l) => l.id === p.listId) ? p.listId : INBOX;
  if (t.repeat && t.date) t.repeat = pinRule(t.repeat, t.date);
  mutateTasks((x) => void x.tasks.unshift(t));
  return t;
}

export function updateTask(id: ID, patch: Partial<TaskItem>) {
  mutateTasks((d) => {
    const i = d.tasks.findIndex((t) => t.id === id);
    if (i < 0) return;
    const old = d.tasks[i];
    const next: TaskItem = { ...old, ...patch, updatedAt: Date.now() };
    // как в TickTick: при появлении даты/времени — напоминания по умолчанию
    if (('date' in patch || 'time' in patch) && !('reminders' in patch) && next.date) {
      if (!old.date || !!old.time !== !!next.time) next.reminders = defaultReminders(d, !!next.time);
    }
    if (!next.time) delete next.duration;
    // новое правило повтора закрепляем по дате; перенос задачи расписание не меняет
    if ('repeat' in patch && next.repeat && next.date) next.repeat = pinRule(next.repeat, next.date);
    for (const k of Object.keys(next) as (keyof TaskItem)[]) if (next[k] === undefined) delete next[k];
    d.tasks[i] = next;
  });
}

export function getTask(id: ID): TaskItem | undefined {
  return useTasks.getState().data?.tasks.find((t) => t.id === id);
}

type Snapshot = Pick<TaskItem, 'date' | 'repeatDone' | 'checklist' | 'done' | 'completedAt' | 'wontDo'> & { logged: boolean };

function snapshotOf(t: TaskItem, logged: boolean): Snapshot {
  return { date: t.date, repeatDone: t.repeatDone, checklist: t.checklist, done: t.done, completedAt: t.completedAt, wontDo: t.wontDo, logged };
}

/** Вернуть задачу в состояние до выполнения (кнопка «Отменить») */
function restore(id: ID, snap: Snapshot) {
  mutateTasks((d) => {
    const x = d.tasks.find((y) => y.id === id);
    if (!x) return;
    x.date = snap.date;
    x.repeatDone = snap.repeatDone;
    x.checklist = snap.checklist;
    x.done = snap.done;
    x.completedAt = snap.completedAt;
    x.wontDo = snap.wontDo;
    for (const k of ['date', 'repeatDone', 'completedAt', 'wontDo'] as const) if (x[k] === undefined) delete x[k];
    x.updatedAt = Date.now();
    if (snap.logged) {
      const li = d.log.map((l) => l.taskId).lastIndexOf(id);
      if (li >= 0) d.log.splice(li, 1);
    }
  });
}

/** Отметить выполненной / снять отметку. Для повторяющихся — перенос на следующий повтор (с кнопкой «Отменить») */
export function toggleDone(id: ID) {
  const t = getTask(id);
  if (!t) return;
  if (t.done || t.wontDo) {
    const wasDone = t.done;
    mutateTasks((d) => {
      const x = d.tasks.find((y) => y.id === id)!;
      x.done = false;
      delete x.wontDo;
      delete x.completedAt;
      x.updatedAt = Date.now();
      // запись в статистике есть только у выполненных (не у «Не буду делать»)
      if (wasDone) {
        const li = d.log.map((l) => l.taskId).lastIndexOf(id);
        if (li >= 0) d.log.splice(li, 1);
      }
    });
    if (t.source) void updateMapTask(t.source.docId, t.source.topicId, { status: 'todo' }).catch(() => {});
    return;
  }
  const snap = snapshotOf(t, true);
  const next = t.repeat ? advanceRepeat(t, todayYmd()) : null;
  mutateTasks((d) => {
    const x = d.tasks.find((y) => y.id === id)!;
    d.log.push({ taskId: x.id, title: x.title, listId: x.listId, at: Date.now(), date: x.date });
    if (d.log.length > 5000) d.log.splice(0, d.log.length - 5000);
    if (next) {
      x.date = next;
      x.repeatDone = (x.repeatDone ?? 0) + 1;
      x.checklist = x.checklist.map((c) => ({ ...c, done: false }));
    } else {
      x.done = true;
      x.completedAt = Date.now();
    }
    x.updatedAt = Date.now();
  });
  const undo = {
    label: 'Отменить',
    run: () => {
      restore(id, snap);
      if (t.source && !next) void updateMapTask(t.source.docId, t.source.topicId, { status: 'todo' }).catch(() => {});
    },
  };
  toast(next ? `Готово! Следующий — ${dayLabel(next).toLowerCase()}` : 'Задача выполнена', undo);
  if (t.source && !next) void updateMapTask(t.source.docId, t.source.topicId, { status: 'done', progress: 100 }).catch(() => {});
}

/**
 * Выполнить конкретный повтор (из уведомления). false — если этот повтор уже выполнен.
 */
export function completeOccurrence(id: ID, date?: string): boolean {
  const t = getTask(id);
  if (!t || t.done || t.wontDo || t.deleted) return false;
  if (t.repeat && date && t.date && date < t.date) return false;
  toggleDone(id);
  return true;
}

/** «Не буду делать»: у повторяющейся задачи пропускается только этот повтор */
export function setWontDo(id: ID) {
  const t = getTask(id);
  if (!t) return;
  const snap = snapshotOf(t, false);
  const next = t.repeat ? advanceRepeat(t, todayYmd()) : null;
  mutateTasks((d) => {
    const x = d.tasks.find((y) => y.id === id);
    if (!x) return;
    if (next) {
      x.date = next;
      x.repeatDone = (x.repeatDone ?? 0) + 1;
      x.checklist = x.checklist.map((c) => ({ ...c, done: false }));
    } else {
      x.wontDo = true;
      x.completedAt = Date.now();
    }
    x.updatedAt = Date.now();
  });
  toast(next ? `Пропущено. Следующий — ${dayLabel(next).toLowerCase()}` : 'Отмечено «Не буду делать»', { label: 'Отменить', run: () => restore(id, snap) });
}

/** Изменить подзадачи по самому свежему состоянию задачи (правки подряд не перетирают друг друга) */
export function updateChecklist(id: ID, fn: (c: ChecklistItem[]) => ChecklistItem[]) {
  mutateTasks((d) => {
    const x = d.tasks.find((y) => y.id === id);
    if (!x) return;
    x.checklist = fn(x.checklist);
    x.updatedAt = Date.now();
  });
}

export function trashTask(id: ID) {
  updateTask(id, { deleted: Date.now() });
}
export function restoreTask(id: ID) {
  mutateTasks((d) => {
    const x = d.tasks.find((y) => y.id === id);
    if (x) delete x.deleted;
  });
}
/** Отметка «удалено навсегда» для синхронизации */
function bury(d: TasksData, ...ids: string[]) {
  const now = Date.now();
  d.gone ??= {};
  for (const id of ids) d.gone[id] = now;
}

export function purgeTask(id: ID) {
  mutateTasks((d) => {
    d.tasks = d.tasks.filter((t) => t.id !== id);
    bury(d, id);
  });
}
export function emptyTrash() {
  mutateTasks((d) => {
    bury(d, ...d.tasks.filter((t) => t.deleted).map((t) => t.id));
    d.tasks = d.tasks.filter((t) => !t.deleted);
  });
}

/** Данные задач изменились на другом устройстве: перечитать (если нет несохранённых правок) */
export async function reloadTasksFromSync(): Promise<boolean> {
  if (saveTimer) return false;
  const d = normalize(await get<TasksData>(KEY));
  useTasks.setState({ data: d });
  return true;
}

export function duplicateTask(id: ID): TaskItem | null {
  const t = getTask(id);
  if (!t) return null;
  const copy: Partial<TaskItem> = { ...structuredClone(t), title: t.title + ' (копия)', done: false };
  delete copy.id;
  delete copy.cal;
  delete copy.completedAt;
  copy.checklist = (copy.checklist ?? []).map((c) => ({ ...c, id: uid() }));
  return addTask(copy);
}

// ---------- Списки, фильтры, теги ----------

export function addList(name: string, color?: string, emoji?: string): TaskList | null {
  const d = useTasks.getState().data;
  if (!d) return null;
  const l: TaskList = { id: uid(), name, color: color ?? LIST_COLORS[d.lists.length % LIST_COLORS.length], emoji, order: d.lists.length };
  mutateTasks((x) => void x.lists.push(l));
  return l;
}
export function updateList(id: ID, patch: Partial<TaskList>) {
  mutateTasks((d) => {
    const i = d.lists.findIndex((l) => l.id === id);
    if (i >= 0) d.lists[i] = { ...d.lists[i], ...patch };
  });
}
/** Удалить список: его задачи уходят в корзину */
export function deleteList(id: ID) {
  if (id === INBOX) return;
  mutateTasks((d) => {
    d.lists = d.lists.filter((l) => l.id !== id);
    bury(d, id);
    const now = Date.now();
    for (const t of d.tasks) if (t.listId === id) {
      t.listId = INBOX;
      t.deleted ??= now;
    }
    for (const f of d.filters) if (f.lists) f.lists = f.lists.filter((x) => x !== id);
  });
}

export function saveFilter(f: TaskFilter) {
  mutateTasks((d) => {
    const i = d.filters.findIndex((x) => x.id === f.id);
    if (i >= 0) d.filters[i] = f;
    else d.filters.push(f);
  });
}
export function deleteFilter(id: ID) {
  mutateTasks((d) => {
    d.filters = d.filters.filter((f) => f.id !== id);
    bury(d, id);
  });
}

export function allTags(d: TasksData): string[] {
  const s = new Set<string>();
  for (const t of d.tasks) if (!t.deleted) for (const g of t.tags) s.add(g);
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
}
export function renameTag(from: string, to: string) {
  mutateTasks((d) => {
    for (const t of d.tasks) if (t.tags.includes(from)) t.tags = [...new Set(t.tags.map((g) => (g === from ? to : g)))];
    if (d.tagColors[from]) {
      d.tagColors[to] = d.tagColors[from];
      delete d.tagColors[from];
    }
    for (const f of d.filters) if (f.tags) f.tags = f.tags.map((g) => (g === from ? to : g));
  });
}
export function deleteTag(tag: string) {
  mutateTasks((d) => {
    for (const t of d.tasks) t.tags = t.tags.filter((g) => g !== tag);
    delete d.tagColors[tag];
    for (const f of d.filters) if (f.tags) f.tags = f.tags.filter((g) => g !== tag);
  });
}

// ---------- Фокус, отсчёты, настройки ----------

export function addFocusSession(s: Omit<FocusSession, 'id'>) {
  mutateTasks((d) => {
    d.focus.push({ ...s, id: uid() });
    if (d.focus.length > 5000) d.focus.splice(0, d.focus.length - 5000);
    if (s.taskId) {
      const t = d.tasks.find((x) => x.id === s.taskId);
      if (t) t.focusMinutes = (t.focusMinutes ?? 0) + s.minutes;
    }
  });
}

export function saveCountdown(c: Countdown) {
  mutateTasks((d) => {
    const i = d.countdowns.findIndex((x) => x.id === c.id);
    if (i >= 0) d.countdowns[i] = c;
    else d.countdowns.push(c);
  });
}
export function deleteCountdown(id: ID) {
  mutateTasks((d) => {
    d.countdowns = d.countdowns.filter((c) => c.id !== id);
    bury(d, id);
  });
}

export function setPrefs(patch: Partial<TaskPrefs>) {
  mutateTasks((d) => void (d.prefs = { ...d.prefs, ...patch }));
}

// ---------- Окна ----------

export function openTask(id: ID | null) {
  useTasks.setState({ openTaskId: id });
}
export function openQuickAdd(p: Partial<TaskItem> = {}) {
  // iOS открывает клавиатуру только при фокусе прямо в обработчике касания:
  // поле ввода уже есть на странице (скрыто), курсор ставится сразу
  focusQuickInput();
  useTasks.setState({ quickAdd: p });
}
