import { create } from 'zustand';
import { del, get, set } from '../store/kv';
import { getMany } from 'idb-keyval';
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
  canRedo?: boolean;
  /** текст открытой заметки ещё не пришёл на это устройство (или не прочитался) — редактор не показывается */
  openMissing?: boolean;
}

export const useNotes = create<NotesState>(() => ({ data: null, openId: null, openBody: null, canUndo: false }));

/** В карточке заметки есть содержимое — значит, пустое тело на диске не «новая пустая заметка», а не дошедший текст */
const metaHasContent = (m: NoteMeta | undefined) => !!m && !!(m.title?.trim() || m.preview?.trim() || m.wordCount || m.hasImage || m.hasAudio || m.hasTodo);

let loading: Promise<NotesData> | null = null;

function normalize(raw: Partial<NotesData> | undefined): NotesData {
  const base = emptyNotesData();
  if (!raw) return base;
  return {
    version: 1,
    notes: (raw.notes ?? []).filter((n) => n && n.id).map((n) => ({ ...n, title: n.title ?? '', preview: n.preview ?? '', createdAt: n.createdAt ?? n.updatedAt ?? 0, updatedAt: n.updatedAt ?? 0 })),
    folders: (raw.folders ?? []).filter((f) => f && f.id).map((f, i) => ({ ...f, name: f.name ?? 'Папка', color: f.color ?? FOLDER_COLORS[0], order: f.order ?? i, createdAt: f.createdAt ?? 0, updatedAt: f.updatedAt ?? 0 })),
    gone: raw.gone ?? {},
    aiTerms: (raw.aiTerms ?? []).filter((r) => r && r.id).map((r) => ({ ...r, drop: r.drop ?? [], add: r.add ?? [], at: r.at ?? 0, checkedAt: r.checkedAt ?? 0, updatedAt: r.updatedAt ?? 0 })),
    aiLinks: (raw.aiLinks ?? []).filter((r) => r && r.id && typeof r.ok === 'boolean').map((r) => ({ ...r, by: r.by === 'user' ? 'user' : 'ai', updatedAt: r.updatedAt ?? 0 })),
    notDup: (raw.notDup ?? []).filter((r) => r && r.id).map((r) => ({ id: r.id, updatedAt: r.updatedAt ?? 0 })),
    synonyms: (raw.synonyms ?? []).filter((r) => r && r.id && Array.isArray(r.words)).map((r) => ({ id: r.id, words: r.words.filter((w) => typeof w === 'string'), by: r.by === 'user' ? 'user' : 'ai', updatedAt: r.updatedAt ?? 0 })),
    synNo: (raw.synNo ?? []).filter((r) => r && r.id).map((r) => ({ id: r.id, updatedAt: r.updatedAt ?? 0 })),
    cards: (raw.cards ?? []).filter((c) => c && c.id && c.noteId && typeof c.q === 'string' && typeof c.a === 'string').map((c) => ({ ...c, due: c.due || '1970-01-01', interval: Math.max(0, c.interval || 0), ease: Math.min(3, Math.max(1.3, c.ease || 2.5)), reps: c.reps || 0, lapses: c.lapses || 0, by: c.by === 'user' ? 'user' : 'ai', createdAt: c.createdAt || 0, updatedAt: c.updatedAt || 0 })),
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
/** записи, которые идут прямо сейчас */
const writing = new Map<ID, { body: NoteBody; done: Promise<void> }>();
const warned = new Set<ID>();
/** Текст для поиска: без регистра, «ё» = «е» */
const searchNorm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
/** кэш простого текста для поиска */
const textCache = new Map<ID, { at: number; text: string }>();

export async function loadNoteBody(id: ID): Promise<NoteBody> {
  const p = pending.get(id);
  if (p) return p.body;
  // тело сейчас записывается (создали заметку и сразу открыли) — в базе его ещё нет
  const w = writing.get(id);
  if (w) return w.body;
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
  let finish = () => {};
  const entry = { body, done: new Promise<void>((r) => (finish = r)) };
  writing.set(id, entry);
  try {
    await writeNow(id, body);
  } finally {
    if (writing.get(id) === entry) writing.delete(id);
    finish();
  }
}

async function writeNow(id: ID, body: NoteBody): Promise<void> {
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
  // только эта карточка — без копирования всего индекса (на каждую паузу в наборе)
  const cur = useNotes.getState().data;
  const i = cur ? cur.notes.findIndex((n) => n.id === id) : -1;
  if (cur && i >= 0) {
    const notes = cur.notes.slice();
    notes[i] = { ...structuredClone(cur.notes[i]), ...metaFromBody(body, size), updatedAt: body.updatedAt };
    useNotes.setState({ data: { ...cur, notes } });
    index.schedule();
  }
}

/** Добавить блоки в конец заметки (открытой — через редактор, иначе — в сохранённый текст) */
export async function appendBlocksToNote(id: ID, blocks: Block[]) {
  const s = useNotes.getState();
  if (s.openId === id && s.openBody) {
    editOpenBody((bd) => void (bd.blocks = [...bd.blocks, ...blocks]));
    return;
  }
  if (!s.data?.notes.some((n) => n.id === id && !n.trashed)) return;
  const body = await loadNoteBody(id).catch(() => null);
  if (!body) return;
  saveNoteBody(id, { ...body, blocks: [...body.blocks, ...blocks] });
}

/** Сохранить всё несохранённое сразу */
export async function flushNotes(): Promise<void> {
  await Promise.all([...pending.keys()].map(writeBody));
  await Promise.all([...writing.values()].map((w) => w.done));
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
    redo = [];
    return;
  }
  if (pending.has(openId)) return;
  // текст заметки, которого ждали, мог прийти с этой синхронизацией
  if (useNotes.getState().openMissing) return void openNote(openId, true);
  const disk = normalizeBody(await get<NoteBody>(noteBodyKey(openId)));
  const s = useNotes.getState();
  if (s.openId !== openId || pending.has(openId) || !s.openBody) return;
  const sig = (b: NoteBody) => JSON.stringify([b.title, b.blocks]);
  if (sig(disk) !== sig(s.openBody)) {
    undo = [];
    redo = [];
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
/** отменённые шаги — для «Повторить» (Ctrl+Shift+Z / Ctrl+Y); любая новая правка их сбрасывает */
let redo: NoteBody[] = [];
let lastTypeAt = 0;
/** начало текущего шага набора: при непрерывном наборе новый шаг каждые 4 с (иначе одно «Отменить» стирало минуты) */
let groupAt = 0;
/** Цепочка переходов по связанным заметкам: «назад» возвращает к предыдущей, а не к списку */
let trail: ID[] = [];

/** keepTrail — переход по цепочке связей (иначе цепочка начинается заново) */
export async function openNote(id: ID | null, keepTrail = false) {
  if (!keepTrail) trail = [];
  const s = useNotes.getState();
  if (s.openId && s.openId !== id) closeCurrent();
  if (!id || id !== s.openId) useNotes.setState({ openMissing: false });
  undo = [];
  redo = [];
  lastTypeAt = 0;
  if (!id) {
    useNotes.setState({ openId: null, openBody: null, canUndo: false });
    return;
  }
  useNotes.setState({ openId: id, openBody: null, canUndo: false, openMissing: false });
  let failed = false;
  const body = await loadNoteBody(id).catch(() => ((failed = true), emptyBody()));
  if (useNotes.getState().openId !== id) return;
  // текста нет, а карточка говорит, что он есть: не открываем пустой редактор —
  // иначе закрытие удалило бы заметку на всех устройствах, а набранное затёрло бы настоящий текст
  const meta = useNotes.getState().data?.notes.find((n) => n.id === id);
  if (failed || (isBodyEmpty(body) && metaHasContent(meta))) useNotes.setState({ openMissing: true });
  else useNotes.setState({ openBody: body });
}

/** Открыть связанную заметку: текущая запоминается, «назад» вернёт к ней */
export function openLinkedNote(id: ID) {
  const cur = useNotes.getState().openId;
  if (cur === id) return;
  if (cur) trail.push(cur);
  if (trail.length > 50) trail.shift();
  void openNote(id, true);
}

/** Есть ли куда вернуться по цепочке связей */
export const hasNoteTrail = () => trail.length > 0;

/** Вернуться к предыдущей заметке цепочки. false — возвращаться некуда (заметки удалены или цепочки нет) */
export function backInTrail(): boolean {
  const notes = useNotes.getState().data?.notes ?? [];
  while (trail.length) {
    const id = trail.pop()!;
    if (notes.some((n) => n.id === id && !n.trashed)) {
      void openNote(id, true);
      return true;
    }
  }
  return false;
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
  if (kind === 'struct' || now - lastTypeAt > 1500 || now - groupAt > 4000) {
    undo.push(s.openBody);
    if (undo.length > 100) undo.shift();
    groupAt = now;
  }
  lastTypeAt = kind === 'type' ? now : 0;
  redo = [];
  const draft: NoteBody = { ...s.openBody, blocks: [...s.openBody.blocks] };
  const next = fn(draft) ?? draft;
  useNotes.setState({ openBody: next, canUndo: true, canRedo: false });
  saveNoteBody(s.openId, next);
}

export function undoOpenBody() {
  const s = useNotes.getState();
  const prev = undo.pop();
  if (!s.openId || !prev) return;
  lastTypeAt = 0;
  if (s.openBody) redo.push(s.openBody);
  useNotes.setState({ openBody: prev, canUndo: undo.length > 0, canRedo: redo.length > 0 });
  saveNoteBody(s.openId, prev);
}

/** Повторить отменённое */
export function redoOpenBody() {
  const s = useNotes.getState();
  const next = redo.pop();
  if (!s.openId || !next) return;
  lastTypeAt = 0;
  if (s.openBody) undo.push(s.openBody);
  useNotes.setState({ openBody: next, canUndo: true, canRedo: redo.length > 0 });
  saveNoteBody(s.openId, next);
}

// ---------- Заметки ----------

export function createNote(p: { folderId?: ID; title?: string; blocks?: Block[]; pinned?: boolean; day?: string; digest?: boolean; source?: string; tpl?: ID } = {}): NoteMeta | null {
  const d = useNotes.getState().data;
  if (!d) return null;
  const now = Date.now();
  const folderId = p.folderId && d.folders.some((f) => f.id === p.folderId) ? p.folderId : undefined;
  const meta: NoteMeta = { id: uid(), title: p.title ?? '', preview: '', createdAt: now, updatedAt: now, ...(folderId ? { folderId } : {}), ...(p.pinned ? { pinned: true } : {}), ...(p.day ? { day: p.day } : {}), ...(p.digest ? { digest: true } : {}), ...(p.source ? { source: p.source } : {}), ...(p.tpl ? { tpl: p.tpl } : {}) };
  mutateNotes((x) => void x.notes.unshift(meta));
  if (p.title || p.blocks?.length) {
    const body: NoteBody = { ...emptyBody(), title: p.title ?? '', ...(p.blocks?.length ? { blocks: p.blocks } : {}) };
    saveNoteBody(meta.id, body);
    void writeBody(meta.id);
  }
  return meta;
}

export function updateNoteMeta(id: ID, patch: Partial<Pick<NoteMeta, 'folderId' | 'pinned' | 'tpl'>>) {
  mutateNotes((d) => {
    const m = d.notes.find((n) => n.id === id);
    if (!m) return;
    Object.assign(m, patch, { updatedAt: Date.now() });
    if (!m.folderId) delete m.folderId;
    if (!m.pinned) delete m.pinned;
    if (!m.tpl) delete m.tpl;
  });
}

export const togglePin = (id: ID) => updateNoteMeta(id, { pinned: !useNotes.getState().data?.notes.find((n) => n.id === id)?.pinned });
export const moveNote = (id: ID, folderId: ID | undefined) => updateNoteMeta(id, { folderId });

export function trashNote(id: ID) {
  if (useNotes.getState().openId === id) {
    void writeBody(id);
    undo = [];
    redo = [];
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
    redo = [];
    useNotes.setState({ openId: null, openBody: null, canUndo: false });
  }
  mutateNotes((d) => {
    d.notes = d.notes.filter((n) => n.id !== id);
    (d.gone ??= {})[id] = Date.now();
    // карточки удалённой заметки — тоже
    for (const c of d.cards ?? []) if (c.noteId === id) d.gone[`card:${c.id}`] = Date.now();
    if (d.cards?.some((c) => c.noteId === id)) d.cards = d.cards.filter((c) => c.noteId !== id);
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
  delete meta.day;
  delete meta.digest;
  delete meta.pinned;
  delete meta.trashed;
  mutateNotes((x) => void x.notes.unshift(meta));
  saveNoteBody(meta.id, copy);
  await writeBody(meta.id);
  return meta;
}

/**
 * Найти заметки по тексту (заголовок + содержимое). Тела читаются лениво (пачками, одной транзакцией базы)
 * и кэшируются. alive() — false: запрос уже устарел (набрали дальше), чтение прекращается.
 */
export async function searchNotes(query: string, notes: NoteMeta[], alive: () => boolean = () => true): Promise<Set<ID>> {
  const q = searchNorm(query.trim());
  const res = new Set<ID>();
  if (!q) return res;
  const words = q.split(/\s+/);
  const stale = notes.filter((n) => textCache.get(n.id)?.at !== n.updatedAt);
  for (let i = 0; i < stale.length; i += 200) {
    if (!alive()) return res;
    const part = stale.slice(i, i + 200);
    // несохранённые и записываемые тела — из памяти, остальные — одним чтением
    const fromDisk = part.filter((n) => !pending.has(n.id) && !writing.has(n.id));
    const disk = fromDisk.length ? await getMany<NoteBody>(fromDisk.map((n) => noteBodyKey(n.id))).catch(() => fromDisk.map(() => undefined)) : [];
    const byId = new Map(fromDisk.map((n, j) => [n.id, disk[j]]));
    for (const n of part) {
      const raw = byId.has(n.id) ? byId.get(n.id) : await loadNoteBody(n.id).catch(() => undefined);
      const body = raw ? normalizeBody(raw) : null;
      textCache.set(n.id, { at: n.updatedAt, text: searchNorm((body?.title || n.title) + '\n' + (body ? bodyPlainText(body) : n.preview)) });
    }
  }
  for (const n of notes) {
    const c = textCache.get(n.id);
    if (c && words.every((w) => c.text.includes(w))) res.add(n.id);
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
