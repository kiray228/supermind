/**
 * Заметка дня: одна на день, в папке «Дневник». Создаётся по шаблону с задачами и сроками целей этого дня;
 * связи с упомянутыми проектами находятся сами. Шаблон — dailyCore.ts.
 */
import type { ID } from '../types';
import { todayYmd } from '../utils/mapTasks';
import { DAILY_FOLDER, DAILY_SECTIONS, dailyBlocks, dailyTitle, insertIntoSection, journalLine } from './dailyCore';
import { type Block, newBlock } from './model';
import { addFolder, createNote, editOpenBody, ensureNotes, flushNotes, loadNoteBody, openNote, saveNoteBody, useNotes } from './store';

/** Заметка этого дня (последняя изменённая, если на двух устройствах создали по одной) */
export function dailyNoteOf(ymd: string): ID | undefined {
  const list = (useNotes.getState().data?.notes ?? []).filter((n) => n.day === ymd && !n.trashed);
  return list.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;
}

/** Дни с заметкой: YYYY-MM-DD → id */
export function dailyNotes(): Map<string, ID> {
  const out = new Map<string, ID>();
  for (const n of useNotes.getState().data?.notes ?? []) if (n.day && !n.trashed && !out.has(n.day)) out.set(n.day, dailyNoteOf(n.day)!);
  return out;
}

/** Задачи дня: на этот день, а для сегодняшнего — и просроченные */
async function tasksOf(ymd: string): Promise<string[]> {
  const { ensureTasks } = await import('../tasks/store');
  const { isActive } = await import('../tasks/model');
  const d = await ensureTasks();
  const today = todayYmd();
  return d.tasks
    .filter((t) => isActive(t) && t.date && (t.date === ymd || (ymd === today && t.date < today)))
    .sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99') || b.priority - a.priority)
    .map((t) => t.title)
    .filter((t) => t.trim());
}

async function goalsOf(ymd: string): Promise<string[]> {
  try {
    const { ensureGoals, goalsDueBetween } = await import('../goals/store');
    return goalsDueBetween(await ensureGoals(), ymd, ymd)
      .filter((g) => g.kind === 'goal')
      .map((g) => g.title);
  } catch {
    return [];
  }
}

/** Создать (если ещё нет) заметку дня и вернуть её id */
export async function ensureDailyNote(ymd = todayYmd()): Promise<ID | null> {
  const d = await ensureNotes();
  const have = dailyNoteOf(ymd);
  if (have) return have;
  let folder = d.folders.find((f) => f.name.trim().toLowerCase() === DAILY_FOLDER.toLowerCase());
  folder ??= addFolder(DAILY_FOLDER, '📔') ?? undefined;
  // прошлая заметка дня — ссылкой, чтобы листать дни
  const prev = (useNotes.getState().data?.notes ?? [])
    .filter((n) => n.day && n.day < ymd && !n.trashed)
    .sort((a, b) => (a.day! < b.day! ? 1 : -1))[0];
  const [tasks, goals] = await Promise.all([tasksOf(ymd).catch(() => []), goalsOf(ymd)]);
  // пока собирали задачи, заметку могли создать (двойное нажатие)
  const again = dailyNoteOf(ymd);
  if (again) return again;
  const m = createNote({ title: dailyTitle(ymd), day: ymd, folderId: folder?.id, blocks: dailyBlocks({ ymd, tasks, goals, prev: prev?.title || undefined }) });
  return m?.id ?? null;
}

/** Открыть заметку дня (создав её) — из любого раздела */
export async function openDailyNote(ymd = todayYmd()): Promise<void> {
  const id = await ensureDailyNote(ymd);
  if (!id) return;
  await openNote(id);
  const { nav } = await import('../search/sources');
  await nav('notes');
}

/** Раздел заметки дня, куда дописывать */
export type DailySection = 'thoughts' | 'results';

/**
 * Дописать запись в заметку дня (создав её): в «Мысли» или «Итоги дня», с временем.
 * Возвращает id заметки и блока — для «Отменить».
 */
export async function appendToDaily(text: string, section: DailySection = 'thoughts', ymd = todayYmd(), extra: Block[] = []): Promise<{ noteId: ID; blockIds: string[] } | null> {
  const t = text.trim();
  if (!t && !extra.length) return null;
  const id = await ensureDailyNote(ymd);
  if (!id) return null;
  await flushNotes();
  const add = [...(t ? [newBlock('p', { text: journalLine(t) })] : []), ...extra];
  const heading = DAILY_SECTIONS[section];
  const s = useNotes.getState();
  if (s.openId === id && s.openBody) editOpenBody((bd) => void (bd.blocks = insertIntoSection(bd.blocks, heading, add)));
  else {
    const body = await loadNoteBody(id);
    saveNoteBody(id, { ...body, blocks: insertIntoSection(body.blocks, heading, add) });
  }
  await flushNotes();
  return { noteId: id, blockIds: add.map((b) => b.id) };
}

/** Дописать блоки в конец заметки (открытой — через редактор) */
export async function appendToNote(noteId: ID, add: Block[]): Promise<boolean> {
  if (!add.length || !useNotes.getState().data?.notes.some((n) => n.id === noteId && !n.trashed)) return false;
  await flushNotes();
  const s = useNotes.getState();
  const withAdded = (bs: Block[]) => {
    const out = [...bs];
    // пустой абзац в конце — заменить, а не оставлять «дырку»
    while (out.length && out[out.length - 1].type === 'p' && !out[out.length - 1].text?.trim()) out.pop();
    return [...out, ...add];
  };
  if (s.openId === noteId && s.openBody) editOpenBody((bd) => void (bd.blocks = withAdded(bd.blocks)));
  else {
    const body = await loadNoteBody(noteId);
    saveNoteBody(noteId, { ...body, blocks: withAdded(body.blocks) });
  }
  await flushNotes();
  return true;
}

/** Убрать дописанное (отмена) */
export async function removeBlocks(noteId: ID, blockIds: string[]): Promise<void> {
  const drop = new Set(blockIds);
  const s = useNotes.getState();
  if (s.openId === noteId && s.openBody) editOpenBody((bd) => void (bd.blocks = bd.blocks.filter((b) => !drop.has(b.id))));
  else {
    const body = await loadNoteBody(noteId);
    saveNoteBody(noteId, { ...body, blocks: body.blocks.filter((b) => !drop.has(b.id)) });
  }
  await flushNotes();
}
