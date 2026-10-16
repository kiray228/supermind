/**
 * Шаблоны в приложении: заметки папки «Шаблоны» (или «Templates» из Obsidian). Новая заметка по шаблону,
 * вставка шаблона в открытую заметку, готовые шаблоны, шаблон заметки дня. Правила подстановок — templatesCore.ts.
 */
import { create } from 'zustand';
import type { ID } from '../types';
import { todayYmd } from '../utils/mapTasks';
import { type Block, type Folder, type NoteMeta, type NotesData } from './model';
import { normTitle } from './links';
import { DAILY_TEMPLATE, fillTemplate, fillTitle, isTemplateFolderName, type Skeleton, TEMPLATE_FOLDER, TEMPLATE_PRESETS, templateName, templateSkeleton, type TemplateVars } from './templatesCore';
import { addFolder, createNote, ensureNotes, loadNoteBody, openNote, useNotes } from './store';

/** Папки с шаблонами */
export function templateFolderIds(d: NotesData | null = useNotes.getState().data): Set<ID> {
  return new Set((d?.folders ?? []).filter((f) => isTemplateFolderName(f.name)).map((f) => f.id));
}

/** Заметка — шаблон (лежит в папке шаблонов) */
export function isTemplateNote(n: Pick<NoteMeta, 'folderId'>, folders: Set<ID> = templateFolderIds()): boolean {
  return !!n.folderId && folders.has(n.folderId);
}

/** Шаблоны по названию */
export function listTemplates(d: NotesData | null = useNotes.getState().data): NoteMeta[] {
  const folders = templateFolderIds(d);
  return (d?.notes ?? []).filter((n) => !n.trashed && isTemplateNote(n, folders)).sort((a, b) => templateName(a.title).localeCompare(templateName(b.title), 'ru'));
}

/** Шаблон заметки дня — шаблон с названием «Заметка дня» */
export function dailyTemplate(d: NotesData | null = useNotes.getState().data): NoteMeta | undefined {
  const k = normTitle(DAILY_TEMPLATE);
  return listTemplates(d).find((n) => normTitle(templateName(n.title)) === k);
}

const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Подстановки «сейчас» */
export const varsNow = (p: Partial<TemplateVars> = {}): TemplateVars => ({ ymd: todayYmd(), time: hhmm(), ...p });

/** Название и блоки новой заметки по шаблону */
export async function fromTemplate(tplId: ID, vars: TemplateVars): Promise<{ title: string; blocks: Block[] } | null> {
  const meta = useNotes.getState().data?.notes.find((n) => n.id === tplId && !n.trashed);
  if (!meta) return null;
  const body = await loadNoteBody(tplId);
  const title = vars.title ?? fillTitle(body.title || meta.title, vars);
  return { title, blocks: fillTemplate(body.blocks, { ...vars, title }) };
}

/** Новая заметка по шаблону (в папке folderId) — открыть её */
export async function createFromTemplate(tplId: ID, opts: { folderId?: ID; open?: boolean } = {}): Promise<NoteMeta | null> {
  await ensureNotes();
  const r = await fromTemplate(tplId, varsNow());
  if (!r) return null;
  // в папку шаблонов новые заметки не кладём
  const folderId = opts.folderId && !templateFolderIds().has(opts.folderId) ? opts.folderId : undefined;
  const m = createNote({ title: r.title, blocks: r.blocks, folderId, tpl: tplId });
  if (m && opts.open !== false) await openNote(m.id);
  return m;
}

async function ensureTemplateFolder(): Promise<Folder | null> {
  const d = await ensureNotes();
  return d.folders.find((f) => isTemplateFolderName(f.name)) ?? addFolder(TEMPLATE_FOLDER, '🧩');
}

/** Новый пустой шаблон — открыть для правки */
export async function newTemplate(): Promise<void> {
  const f = await ensureTemplateFolder();
  if (!f) return;
  const m = createNote({ title: 'Новый шаблон', folderId: f.id });
  if (m) await openNote(m.id);
}

/** Добавить готовые шаблоны, которых ещё нет (по названию). Возвращает, сколько добавлено */
export async function addPresetTemplates(): Promise<number> {
  const f = await ensureTemplateFolder();
  if (!f) return 0;
  const have = new Set(listTemplates().map((n) => normTitle(templateName(n.title))));
  let added = 0;
  for (const p of TEMPLATE_PRESETS) {
    if (have.has(normTitle(templateName(p.title)))) continue;
    if (createNote({ title: p.title, blocks: p.blocks(), folderId: f.id })) added++;
  }
  return added;
}

// ---------- Скелет шаблона для связей ----------

const skeletons = new Map<ID, { at: number; sk: Skeleton | null }>();

/** Скелет шаблона заметки (для связей): общий текст шаблона в связях не участвует */
export async function skeletonFor(tplId: ID | undefined): Promise<Skeleton | null> {
  if (!tplId) return null;
  const meta = useNotes.getState().data?.notes.find((n) => n.id === tplId);
  if (!meta) return null;
  const c = skeletons.get(tplId);
  if (c && c.at === meta.updatedAt) return c.sk;
  let sk: Skeleton | null = null;
  try {
    const body = await loadNoteBody(tplId);
    sk = templateSkeleton(body.blocks, body.title || meta.title);
    if (!sk.lines.length && !sk.title) sk = null;
  } catch {
    sk = null;
  }
  skeletons.set(tplId, { at: meta.updatedAt, sk });
  return sk;
}

// ---------- Окно выбора ----------

interface TemplatesUi {
  open: boolean;
  /** вставка в открытую заметку: куда отдать блоки (иначе — новая заметка) */
  insert: ((blocks: Block[]) => void) | null;
  /** папка новой заметки */
  folderId?: ID;
}

export const useTemplatesUi = create<TemplatesUi>(() => ({ open: false, insert: null }));
export const openTemplates = (p: { insert?: (blocks: Block[]) => void; folderId?: ID } = {}) => useTemplatesUi.setState({ open: true, insert: p.insert ?? null, folderId: p.folderId });
export const closeTemplates = () => useTemplatesUi.setState({ open: false, insert: null, folderId: undefined });
