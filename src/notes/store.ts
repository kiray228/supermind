import { create } from 'zustand';
import { del, get, set } from '../store/kv';
import { blobSync } from '../store/blobSync';
import type { ID } from '../types';
import { uid } from '../utils/tree';
import { toast } from '../store/appStore';
import {
  type Block,
  BODY_WARN_BYTES,
  bodyPlainText,
  emptyBody,
  emptyNotesData,
  type Folder,
  FOLDER_COLORS,
  isBodyEmpty,
  metaFromBody,
  type NoteBody,
  type NoteMeta,
  type NotesData,
  normalizeBody,
} from './model';

const KEY = 'notes';
export const noteBodyKey = (id: ID) => 'note:' + id;

interface NotesState {
  data: NotesData | null;
  /** открытая в редакторе заметка */
  openId: ID | null;
  openBody: NoteBody | null;
  canUndo: boolean;
}

export const useNotes = create<NotesState>(() => ({ data: null, openId: null, openBody: null, canUndo: false }));

let loading: Promise<NotesData> | null = null;

function normalize(raw: Partial<NotesData> | undefined): NotesData {
  const base = emptyNotesData();
  if (!raw) return base;
  return {
    version: 1,
    notes: (raw.notes ?? []).filter((n) => n && n.id).map((n) => ({ ...n, title: n.title ?? '', preview: n.preview ?? '', createdAt: n.createdAt ?? n.updatedAt ?? 0, updatedAt: n.updatedAt ?? 0 })),
    folders: (raw.folders ?? []).filter((f) => f && f.id).map((f, i) => ({ ...f, name: f.name ?? 'Папка', color: f.color ?? FOLDER_COLORS[0], order: f.order ?? i, createdAt: f.createdAt ?? 0, updatedAt: f.updatedAt ?? 0 })),
    gone: raw.gone ?? {},
  };
}

/** Загрузить индекс заметок (один раз) */
export function ensureNotes(): Promise<NotesData> {
  const cur = useNotes.getState().data;
  if (cur) return Promise.resolve(cur);
  if (!loading) {
    loading = (async () => {
      const d = normalize(await get<NotesData>(KEY));
      useNotes.setState({ data: d });
      index.loaded();
      return d;
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

export const notesData = () => useNotes.getState().data;

// ---------- Сохранение индекса ----------

/** Запись индекса со слиянием: копия в памяти не перетирает пришедшее с другого устройства */
const index = blobSync<NotesData>({
  key: KEY,
  read: () => useNotes.getState().data,
  write: (data) => useNotes.setState({ data }),
  normalize: (raw) => normalize(raw),
  onError: () => toast('Не удалось сохранить заметки'),
});

function flushIndex(): Promise<void> {
  return index.flush();
}

/** Изменить индекс (заметки и папки): fn получает копию, сохранение — автоматически */
export function mutateNotes(fn: (d: NotesData) => void) {
  const cur = useNotes.getState().data;
  if (!cur) return;
  const d = structuredClone(cur);
  fn(d);
  useNotes.setState({ data: d });
  index.schedule();
}

// ---------- Тела заметок ----------

const pending = new Map<ID, { body: NoteBody; timer: ReturnType<typeof setTimeout> }>();
const warned = new Set<ID>();
/** Текст для поиска: без регистра, «ё» = «е» */
const searchNorm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
/** кэш простого текста для поиска */
const textCache = new Map<ID, { at: number; text: string }>();

export async function loadNoteBody(id: ID): Promise<NoteBody> {
  const p = pending.get(id);
  if (p) return p.body;
  return normalizeBody(await get<NoteBody>(noteBodyKey(id)));
}

/** Сохранить тело заметки (с задержкой 400 мс) и обновить её карточку */
export function saveNoteBody(id: ID, body: NoteBody) {
  const p = pending.get(id);
  if (p) clearTimeout(p.timer);
  pending.set(id, { body, timer: setTimeout(() => void writeBody(id), 400) });
}

/** Есть ли несохранённые изменения тела */
export const hasPendingBody = (id: ID) => pending.has(id);

async function writeBody(id: ID): Promise<void> {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  if (!useNotes.getState().data?.notes.some((n) => n.id === id)) return;
  const body: NoteBody = { ...p.body, updatedAt: Date.now() };
  const size = JSON.stringify(body).length;
  if (size > BODY_WARN_BYTES && !warned.has(id)) {
    warned.add(id);
    toast(`Заметка очень большая (${(size / 1048576).toFixed(1)} МБ) — синхронизация может быть медленной. Разделите её или уберите часть фото и записей.`);
  }
  try {
    await set(noteBodyKey(id), body);
  } catch {
    toast('Не удалось сохранить заметку');
    return;
  }
  textCache.set(id, { at: body.updatedAt, text: searchNorm(body.title + '\n' + bodyPlainText(body)) });
  mutateNotes((d) => {
    const m = d.notes.find((n) => n.id === id);
    if (m) {
      Object.assign(m, metaFromBody(body, size));
      m.updatedAt = body.updatedAt;
    }
  });
}

/** Сохранить всё несохранённое сразу */
export async function flushNotes(): Promise<void> {
  await Promise.all([...pending.keys()].map(writeBody));
  await flushIndex();
}

/** Перечитать индекс из базы (после синхронизации или восстановления копии) */
export async function reloadNotes(): Promise<void> {
  if (!useNotes.getState().data) {
    loading = null;
    return;
  }
  // несохранённые тела и индекс — сначала записать (со слиянием), потом перечитать
  await Promise.all([...pending.keys()].map(writeBody));
  await index.reload();
  const d = useNotes.getState().data!;
  loading = Promise.resolve(d);
  const { openId } = useNotes.getState();
  if (!openId) return;
  if (!d.notes.some((n) => n.id === openId)) {
    useNotes.setState({ openId: null, openBody: null, canUndo: false });
    undo = [];
    return;
  }
  if (pending.has(openId)) return;
  const disk = normalizeBody(await get<NoteBody>(noteBodyKey(openId)));
  const s = useNotes.getState();
  if (s.openId !== openId || pending.has(openId) || !s.openBody) return;
  const sig = (b: NoteBody) => JSON.stringify([b.title, b.blocks]);
  if (sig(disk) !== sig(s.openBody)) {
    undo = [];
    useNotes.setState({ openBody: disk, canUndo: false });
  }
}

if (typeof document !== 'undefined') {
  // телефон может выгрузить вкладку в фоне — сохраняем сразу
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushNotes();
  });
}

// ---------- Открытая заметка ----------

let undo: NoteBody[] = [];
let lastTypeAt = 0;

export async function openNote(id: ID | null) {
  const s = useNotes.getState();
  if (s.openId && s.openId !== id) closeCurrent();
  undo = [];
  lastTypeAt = 0;
  if (!id) {
    useNotes.setState({ openId: null, openBody: null, canUndo: false });
    return;
  }
  useNotes.setState({ openId: id, openBody: null, canUndo: false });
  const body = await loadNoteBody(id).catch(() => emptyBody());
  if (useNotes.getState().openId === id) useNotes.setState({ openBody: body });
}

/** Закрыть заметку: пустая удаляется без следа, иначе — сохраняется сразу */
function closeCurrent() {
  const { openId, openBody } = useNotes.getState();
  if (!openId) return;
  if (openBody && isBodyEmpty(openBody)) purgeNote(openId);
  else void writeBody(openId);
}

/**
 * Изменить тело открытой заметки. fn не должен менять блоки на месте — только заменять
 * (редактор перерисовывает блоки по ссылке). kind 'type' — набор текста: шаги отмены группируются.
 */
export function editOpenBody(fn: (b: NoteBody) => NoteBody | void, kind: 'struct' | 'type' = 'struct') {
  const s = useNotes.getState();
  if (!s.openId || !s.openBody) return;
  const now = Date.now();
  if (kind === 'struct' || now - lastTypeAt > 1500) {
    undo.push(s.openBody);
    if (undo.length > 100) undo.shift();
  }
  lastTypeAt = kind === 'type' ? now : 0;
  const draft: NoteBody = { ...s.openBody, blocks: [...s.openBody.blocks] };
  const next = fn(draft) ?? draft;
  useNotes.setState({ openBody: next, canUndo: true });
  saveNoteBody(s.openId, next);
}

export function undoOpenBody() {
  const s = useNotes.getState();
  const prev = undo.pop();
  if (!s.openId || !prev) return;
  lastTypeAt = 0;
  useNotes.setState({ openBody: prev, canUndo: undo.length > 0 });
  saveNoteBody(s.openId, prev);
}

// ---------- Заметки ----------

export function createNote(p: { folderId?: ID; title?: string; blocks?: Block[]; pinned?: boolean } = {}): NoteMeta | null {
  const d = useNotes.getState().data;
  if (!d) return null;
  const now = Date.now();
  const folderId = p.folderId && d.folders.some((f) => f.id === p.folderId) ? p.folderId : undefined;
  const meta: NoteMeta = { id: uid(), title: p.title ?? '', preview: '', createdAt: now, updatedAt: now, ...(folderId ? { folderId } : {}), ...(p.pinned ? { pinned: true } : {}) };
  mutateNotes((x) => void x.notes.unshift(meta));
  if (p.title || p.blocks?.length) {
    const body: NoteBody = { ...emptyBody(), title: p.title ?? '', ...(p.blocks?.length ? { blocks: p.blocks } : {}) };
    saveNoteBody(meta.id, body);
    void writeBody(meta.id);
  }
  return meta;
}

export function updateNoteMeta(id: ID, patch: Partial<Pick<NoteMeta, 'folderId' | 'pinned'>>) {
  mutateNotes((d) => {
    const m = d.notes.find((n) => n.id === id);
    if (!m) return;
    Object.assign(m, patch, { updatedAt: Date.now() });
    if (!m.folderId) delete m.folderId;
    if (!m.pinned) delete m.pinned;
  });
}

export const togglePin = (id: ID) => updateNoteMeta(id, { pinned: !useNotes.getState().data?.notes.find((n) => n.id === id)?.pinned });
export const moveNote = (id: ID, folderId: ID | undefined) => updateNoteMeta(id, { folderId });

export function trashNote(id: ID) {
  if (useNotes.getState().openId === id) {
    void writeBody(id);
    undo = [];
    useNotes.setState({ openId: null, openBody: null, canUndo: false });
  }
  mutateNotes((d) => {
    const m = d.notes.find((n) => n.id === id);
    if (m) Object.assign(m, { trashed: Date.now(), updatedAt: Date.now() });
  });
  toast('Заметка перемещена в корзину', { label: 'Отменить', run: () => restoreNote(id) });
}

export function restoreNote(id: ID) {
  mutateNotes((d) => {
    const m = d.notes.find((n) => n.id === id);
    if (!m) return;
    delete m.trashed;
    m.updatedAt = Date.now();
    if (m.folderId && !d.folders.some((f) => f.id === m.folderId)) delete m.folderId;
  });
}

/** Удалить навсегда */
export function purgeNote(id: ID) {
  const p = pending.get(id);
  if (p) clearTimeout(p.timer);
  pending.delete(id);
  textCache.delete(id);
  if (useNotes.getState().openId === id) {
    undo = [];
    useNotes.setState({ openId: null, openBody: null, canUndo: false });
  }
  mutateNotes((d) => {
    d.notes = d.notes.filter((n) => n.id !== id);
    (d.gone ??= {})[id] = Date.now();
  });
  void del(noteBodyKey(id)).catch(() => undefined);
}

export function emptyNotesTrash() {
  for (const n of useNotes.getState().data?.notes ?? []) if (n.trashed) purgeNote(n.id);
}

export async function duplicateNote(id: ID): Promise<NoteMeta | null> {
  const d = useNotes.getState().data;
  const src = d?.notes.find((n) => n.id === id);
  if (!d || !src) return null;
  const body = await loadNoteBody(id);
  const copy: NoteBody = { title: body.title ? body.title + ' (копия)' : '', blocks: body.blocks.map((b) => ({ ...b, id: uid() })), updatedAt: Date.now() };
  const now = Date.now();
  const meta: NoteMeta = { ...src, id: uid(), title: copy.title, createdAt: now, updatedAt: now };
  delete meta.pinned;
  delete meta.trashed;
  mutateNotes((x) => void x.notes.unshift(meta));
  saveNoteBody(meta.id, copy);
  await writeBody(meta.id);
  return meta;
}

/** Найти заметки по тексту (заголовок + содержимое). Тела читаются лениво и кэшируются */
export async function searchNotes(query: string, notes: NoteMeta[]): Promise<Set<ID>> {
  const q = searchNorm(query.trim());
  const res = new Set<ID>();
  if (!q) return res;
  const words = q.split(/\s+/);
  for (const n of notes) {
    let c = textCache.get(n.id);
    if (!c || c.at !== n.updatedAt) {
      const body = await loadNoteBody(n.id).catch(() => null);
      c = { at: n.updatedAt, text: searchNorm((body?.title ?? n.title) + '\n' + (body ? bodyPlainText(body) : n.preview)) };
      textCache.set(n.id, c);
    }
    if (words.every((w) => c.text.includes(w))) res.add(n.id);
  }
  return res;
}

// ---------- Папки ----------

export function addFolder(name: string, emoji?: string, color?: string): Folder | null {
  const d = useNotes.getState().data;
  if (!d) return null;
  const now = Date.now();
  const f: Folder = {
    id: uid(),
    name: name.trim() || 'Папка',
    color: color ?? FOLDER_COLORS[d.folders.length % FOLDER_COLORS.length],
    order: Math.max(0, ...d.folders.map((x) => x.order + 1)),
    createdAt: now,
    updatedAt: now,
    ...(emoji ? { emoji } : {}),
  };
  mutateNotes((x) => void x.folders.push(f));
  return f;
}

export function updateFolder(id: ID, patch: Partial<Pick<Folder, 'name' | 'emoji' | 'color'>>) {
  mutateNotes((d) => {
    const f = d.folders.find((x) => x.id === id);
    if (!f) return;
    Object.assign(f, patch, { updatedAt: Date.now() });
    if (!f.emoji) delete f.emoji;
  });
}

/** Удалить папку; её заметки остаются во «Всех заметках» */
export function deleteFolder(id: ID) {
  mutateNotes((d) => {
    const now = Date.now();
    d.folders = d.folders.filter((f) => f.id !== id);
    (d.gone ??= {})[id] = now;
    for (const n of d.notes)
      if (n.folderId === id) {
        delete n.folderId;
        n.updatedAt = now;
      }
  });
}

/** Сдвинуть папку вверх (-1) или вниз (1) */
export function moveFolder(id: ID, dir: -1 | 1) {
  mutateNotes((d) => {
    const list = [...d.folders].sort((a, b) => a.order - b.order);
    const i = list.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const now = Date.now();
    list.forEach((f, k) => {
      if (f.order !== k) {
        f.order = k;
        f.updatedAt = now;
      }
    });
  });
}

export const sortedFolders = (d: NotesData) => [...d.folders].sort((a, b) => a.order - b.order);
