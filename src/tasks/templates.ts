/**
 * Шаблоны задач: «Сохранить как шаблон» в окне задачи, «Из шаблона…» в меню раздела «Задачи».
 * Шаблон хранит то, что повторяется из раза в раз: название, описание, чек-лист, теги, приоритет, список,
 * время и длительность. Дату задаёт место, где задачу создают (сегодня, завтра…). Синхронизируется с задачами.
 */
import type { ID } from '../types';
import { uid } from '../utils/tree';
import type { Priority, TaskItem, TaskTemplate } from './model';
import { addTask, getTask, mutateTasks, useTasks } from './store';

/** Шаблоны, новые сверху */
export const listTaskTemplates = (): TaskTemplate[] => [...(useTasks.getState().data?.templates ?? [])].sort((a, b) => b.createdAt - a.createdAt);

/** Сохранить задачу как шаблон (без отметок, дат и истории) */
export function saveTaskTemplate(taskId: ID, name?: string): TaskTemplate | null {
  const t = getTask(taskId);
  if (!t) return null;
  const now = Date.now();
  const tpl: TaskTemplate = {
    id: uid(),
    name: (name ?? t.title).trim() || 'Шаблон',
    title: t.title,
    priority: t.priority,
    tags: [...t.tags],
    listId: t.listId,
    checklist: t.checklist.map((c) => c.text).filter((x) => x.trim()),
    createdAt: now,
    updatedAt: now,
  };
  if (t.notes?.trim()) tpl.notes = t.notes;
  if (t.time) tpl.time = t.time;
  if (t.time && t.duration) tpl.duration = t.duration;
  mutateTasks((d) => void (d.templates = [...(d.templates ?? []), tpl]));
  return tpl;
}

export function renameTaskTemplate(id: ID, name: string) {
  mutateTasks((d) => {
    const x = d.templates?.find((y) => y.id === id);
    if (x && name.trim()) Object.assign(x, { name: name.trim(), updatedAt: Date.now() });
  });
}

export function deleteTaskTemplate(id: ID) {
  mutateTasks((d) => {
    d.templates = (d.templates ?? []).filter((x) => x.id !== id);
    (d.gone ??= {})[id] = Date.now();
  });
}

/** Новая задача по шаблону; preset — дата, список и т. п. от места, где её создают */
export function taskFromTemplate(id: ID, preset: Partial<TaskItem> = {}): TaskItem | null {
  const tpl = useTasks.getState().data?.templates?.find((x) => x.id === id);
  if (!tpl) return null;
  const date = preset.date;
  return addTask({
    title: tpl.title,
    ...(tpl.notes ? { notes: tpl.notes } : {}),
    priority: (tpl.priority ?? 0) as Priority,
    tags: [...new Set([...tpl.tags, ...(preset.tags ?? [])])],
    listId: preset.listId ?? tpl.listId,
    checklist: tpl.checklist.map((text) => ({ id: uid(), text, done: false })),
    ...(date ? { date, ...(tpl.time ? { time: tpl.time, ...(tpl.duration ? { duration: tpl.duration } : {}) } : {}) } : {}),
  });
}
