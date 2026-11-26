/** «Сделать с ИИ»: встроенный ИИ выполняет задачу, результат сохраняется заметкой и привязывается к задаче */
import { DO_SYSTEM, resultBody, resultTitle, taskBrief } from './aiDo';
import { updateTask, useTasks } from './store';
import type { TaskItem } from './model';
import { useApp } from '../store/appStore';
import { t } from '../i18n/index';

export async function doTaskWithAi(task: TaskItem, wish: string, onText?: (s: string) => void, signal?: AbortSignal): Promise<{ noteId: string; text: string }> {
  const { streamText } = await import('../ai/claude');
  const text = await streamText({ system: DO_SYSTEM, messages: [{ role: 'user', content: taskBrief(task, wish) }], onText, signal, effort: 'medium' });
  if (!text.trim()) throw new Error(t('ИИ вернул пустой ответ — попробуйте ещё раз'));
  const [{ createNote, ensureNotes }, { markdownToBlocks }] = await Promise.all([import('../notes/store'), import('../notes/model')]);
  await ensureNotes();
  const n = createNote({ title: resultTitle(text, task.title), blocks: markdownToBlocks(resultBody(text)) });
  if (!n) throw new Error(t('Не удалось сохранить заметку'));
  updateTask(task.id, { aiNoteId: n.id });
  return { noteId: n.id, text };
}

/** Есть ли ещё заметка с результатом (её могли удалить) */
export async function aiNoteAlive(id: string | undefined): Promise<boolean> {
  if (!id) return false;
  const { ensureNotes } = await import('../notes/store');
  const d = await ensureNotes();
  return d.notes.some((n) => n.id === id && !n.trashed);
}

export async function openAiNote(id: string) {
  const { openTask } = await import('./store');
  openTask(null);
  useApp.getState().go('notes');
  const { openNote } = await import('../notes/store');
  void openNote(id);
}

export const taskById = (id: string) => useTasks.getState().data?.tasks.find((x) => x.id === id);
