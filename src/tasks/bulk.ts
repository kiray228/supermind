/**
 * Несколько задач сразу: выбор (долгое нажатие → «Выбрать несколько», Ctrl/⌘ + щелчок, меню «Ещё»)
 * и действия над выбранными — выполнить, дата, список, приоритет, тег, удалить. Всё одной кнопкой «Отменить».
 */
import { create } from 'zustand';
import type { ID } from '../types';
import type { TaskItem } from './model';
import { toast } from '../store/appStore';
import { updateMapTask } from '../utils/mapTasks';
import { getTask, mutateTasks, restoreSnapshot, snapshotOf, toggleDone, updateTask } from './store';

interface BulkState {
  /** выбранные задачи; null — режим выбора выключен */
  ids: ID[] | null;
}

export const useBulk = create<BulkState>(() => ({ ids: null }));

export const selecting = () => useBulk.getState().ids !== null;

export function startSelect(id?: ID) {
  useBulk.setState({ ids: id ? [id] : [] });
}
export function toggleSelect(id: ID) {
  const ids = useBulk.getState().ids ?? [];
  useBulk.setState({ ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
}
export function selectAll(ids: ID[]) {
  const cur = useBulk.getState().ids ?? [];
  // все уже выбраны — снять выбор
  useBulk.setState({ ids: ids.every((x) => cur.includes(x)) ? [] : [...new Set([...cur, ...ids])] });
}
export function endSelect() {
  useBulk.setState({ ids: null });
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
export const tasksWord = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`;

/** Существующие (не удалённые навсегда) задачи из списка */
const alive = (ids: ID[]) => ids.map(getTask).filter((t): t is TaskItem => !!t);

/** Изменить задачи с возможностью вернуть: прежние версии ставятся обратно со свежей отметкой времени */
function undoable(list: TaskItem[], run: () => void, msg: string) {
  const before = list.map((t) => structuredClone(t));
  run();
  toast(msg, {
    label: 'Отменить',
    run: () =>
      mutateTasks((d) => {
        const now = Date.now();
        for (const b of before) {
          const i = d.tasks.findIndex((t) => t.id === b.id);
          if (i >= 0) d.tasks[i] = { ...b, updatedAt: now };
        }
      }),
  });
}

/** Выполнить выбранные (повторяющиеся — переходят на следующий повтор) */
export function bulkComplete(ids: ID[]): number {
  const list = alive(ids).filter((t) => !t.done && !t.wontDo && !t.deleted);
  if (!list.length) return 0;
  const snaps = list.map((t) => [t.id, snapshotOf(t, true)] as const);
  for (const t of list) toggleDone(t.id);
  toast(`Выполнено: ${tasksWord(list.length)}`, {
    label: 'Отменить',
    run: () => {
      for (const [id, s] of snaps) restoreSnapshot(id, s);
      // темы карт, отмеченные выполненными вместе с задачами, — обратно
      for (const t of list) if (t.source && !t.repeat) void updateMapTask(t.source.docId, t.source.topicId, { status: 'todo' }).catch(() => {});
    },
  });
  return list.length;
}

/** Одно и то же изменение для всех выбранных (дата, список, приоритет…) */
export function bulkUpdate(ids: ID[], patch: Partial<TaskItem> | ((t: TaskItem) => Partial<TaskItem> | null), msg: string): number {
  const list = alive(ids).filter((t) => !t.deleted);
  if (!list.length) return 0;
  undoable(
    list,
    () => {
      for (const t of list) {
        const p = typeof patch === 'function' ? patch(t) : patch;
        if (p) updateTask(t.id, p);
      }
    },
    `${msg}: ${tasksWord(list.length)}`,
  );
  return list.length;
}

/** Добавить тег всем выбранным */
export const bulkTag = (ids: ID[], tag: string) =>
  bulkUpdate(ids, (t) => (t.tags.includes(tag) ? null : { tags: [...t.tags, tag] }), `Тег #${tag}`);

/** В корзину */
export function bulkTrash(ids: ID[]): number {
  const list = alive(ids).filter((t) => !t.deleted);
  if (!list.length) return 0;
  undoable(list, () => mutateTasks((d) => {
    const now = Date.now();
    for (const t of d.tasks) if (ids.includes(t.id) && !t.deleted) Object.assign(t, { deleted: now, updatedAt: now });
  }), `Удалено: ${tasksWord(list.length)}`);
  return list.length;
}
