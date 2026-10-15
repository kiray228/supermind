/**
 * Источники «второго мозга»: заметки, карты, задачи и цели — общий список для связей и графа.
 * Каждая единица — с версией (updatedAt): важные слова пересчитываются только у изменённых.
 */
import { listDocs, loadDoc } from '../store/db';
import { ensureGoals } from '../goals/store';
import { ensureTasks } from '../tasks/store';
import { type BrainKind, goalDoc, itemId, mapDoc, noteDoc, parseItemId, taskDoc } from './brainDocs';
import type { NoteDoc } from './links';
import { ensureNotes, loadNoteBody, useNotes } from './store';

export interface BrainItem {
  /** id в общем индексе (у заметок — как есть, у остальных — с приставкой) */
  id: string;
  kind: BrainKind;
  title: string;
  /** версия: изменилась — признаки пересчитываются */
  at: number;
  /** начало текста или пояснение */
  preview: string;
  /** выполнена (задача, цель) */
  done?: boolean;
  /** папка заметки */
  folderId?: string;
}

/** Все единицы мозга (без корзины, удалённых, архивных целей и защищённых паролем карт) */
export async function collectItems(): Promise<BrainItem[]> {
  const out: BrainItem[] = [];
  const notes = useNotes.getState().data ?? (await ensureNotes());
  for (const n of notes.notes)
    if (!n.trashed) out.push({ id: n.id, kind: 'note', title: n.title, at: n.updatedAt, preview: n.preview, ...(n.folderId ? { folderId: n.folderId } : {}) });
  // остальные разделы — по возможности: не загрузился один, связи остальных всё равно работают
  const [maps, tasks, goals] = await Promise.all([listDocs().catch(() => []), ensureTasks().catch(() => null), ensureGoals().catch(() => null)]);
  for (const m of maps) if (!m.trashed && !m.locked) out.push({ id: itemId('map', m.id), kind: 'map', title: m.title || 'Без названия', at: m.updatedAt, preview: m.topicCount ? `Карта · ${m.topicCount} тем` : 'Карта' });
  for (const t of tasks?.tasks ?? []) {
    if (t.deleted || !t.title?.trim()) continue;
    out.push({ id: itemId('task', t.id), kind: 'task', title: t.title.trim(), at: t.updatedAt, preview: (t.notes ?? '').replace(/\s+/g, ' ').trim().slice(0, 160), done: t.done || !!t.wontDo });
  }
  for (const g of goals?.goals ?? []) {
    if (g.status === 'archived' || !g.title?.trim()) continue;
    out.push({ id: itemId('goal', g.id), kind: 'goal', title: g.title.trim(), at: g.updatedAt, preview: (g.why || g.notes || '').replace(/\s+/g, ' ').trim().slice(0, 160), done: g.status === 'done' });
  }
  return out;
}

/** Текст единицы для анализа. null — прочитать не удалось (или карта защищена паролем) */
export async function itemText(id: string): Promise<NoteDoc | null> {
  const { kind, raw } = parseItemId(id);
  if (kind === 'note') return noteDoc(await loadNoteBody(raw), !!useNotes.getState().data?.notes.find((n) => n.id === raw)?.day);
  if (kind === 'map') {
    const doc = await loadDoc(raw);
    return doc && !('locked' in doc && doc.locked) && 'sheets' in doc ? mapDoc(doc) : null;
  }
  if (kind === 'task') {
    const t = (await ensureTasks()).tasks.find((x) => x.id === raw);
    return t ? taskDoc(t) : null;
  }
  const g = (await ensureGoals()).goals.find((x) => x.id === raw);
  return g ? goalDoc(g) : null;
}

/** Открыть единицу. Заметку из другой заметки — по цепочке («Назад» вернёт обратно) */
export async function openItem(id: string, opts: { fromNote?: boolean } = {}): Promise<void> {
  const { kind, raw } = parseItemId(id);
  const tasks = await import('../tasks/store');
  if (kind === 'task') {
    tasks.openTask(raw);
    return;
  }
  // из окна задачи — сначала закрыть его
  if (tasks.useTasks.getState().openTaskId) tasks.openTask(null);
  const { nav, whenShown } = await import('../search/sources');
  if (kind === 'note') {
    const { openLinkedNote, openNote } = await import('./store');
    if (opts.fromNote) openLinkedNote(raw);
    else {
      await openNote(raw);
      await nav('notes');
    }
    return;
  }
  if (kind === 'map') {
    await (await import('../actions')).openDoc(raw);
    return;
  }
  const { openGoal } = await import('../goals/store');
  await nav('goals');
  whenShown('.gl-page', () => openGoal(raw));
}
