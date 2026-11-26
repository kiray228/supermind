/**
 * Черновики заранее: если включено, ИИ сам делает задачи, которые он умеет (презентация, текст, письмо…),
 * когда до срока остаётся меньше суток, а человек ещё не сделал. Не больше двух в день — чтобы не тратить лимит ИИ.
 */
import { addDays, aiCanDo, dueSoon } from './aiDo';
import type { TaskItem } from './model';
import { toast, useApp } from '../store/appStore';
import { t } from '../i18n/index';

const KEY = 'sm-ai-drafts';
const PER_DAY = 2;
let running = false;

function tried(today: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { day?: string; ids?: string[] };
    return v.day === today && Array.isArray(v.ids) ? v.ids : [];
  } catch {
    return [];
  }
}
function remember(today: string, ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ day: today, ids }));
  } catch {
    /* без памяти — просто не больше раза за запуск */
  }
}

/** Задачи, с которыми ИИ может помочь: срок сегодня/завтра (или прошёл), не сделаны */
export function helpable(tasks: TaskItem[], today: string): TaskItem[] {
  const tomorrow = addDays(today, 1);
  return tasks.filter((x) => dueSoon(x, today, tomorrow) && aiCanDo(x)).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : (a.time ?? '99') < (b.time ?? '99') ? -1 : 1));
}

export async function autoDrafts(tasks: TaskItem[], today: string) {
  if (running || !useApp.getState().settings.aiDrafts) return;
  // флаг — сразу, до первого await: второй вызов (быстрое переключение вкладок) не запустит те же черновики ещё раз
  running = true;
  try {
    const [{ hasOwnKey }, { aiConsentGiven }, { useCloud }] = await Promise.all([import('../ai/claude'), import('../ai/consent'), import('../store/cloud')]);
    // в фоне согласие не спрашиваем — его дали, когда включали черновики
    if (hasOwnKey() ? !aiConsentGiven('claude') : !aiConsentGiven('server') || !useCloud.getState().account) return;
    const done = tried(today);
    const todo = helpable(tasks, today)
      .filter((x) => !x.aiNoteId && !done.includes(x.id))
      .slice(0, Math.max(0, PER_DAY - done.length));
    if (!todo.length) return;
    const { doTaskWithAi, openAiNote, taskById } = await import('./aiRun');
    for (const old of todo) {
      // пока делался прошлый черновик, задачу могли сделать, удалить или уже сделать с ИИ
      const task = taskById(old.id);
      if (!task || task.done || task.deleted || task.aiNoteId || !useApp.getState().settings.aiDrafts) continue;
      done.push(task.id);
      remember(today, done);
      try {
        const r = await doTaskWithAi(task, '');
        toast(t('ИИ подготовил черновик: «{title}»', { title: task.title }), { label: t('Открыть'), run: () => void openAiNote(r.noteId) });
      } catch {
        /* нет сети или лимит — попробуем завтра */
      }
    }
  } finally {
    running = false;
  }
}
