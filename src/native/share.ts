/**
 * «Поделиться → SuperMind»: сохранить присланный текст, ссылку или фото как задачу, заметку,
 * запись в заметке дня, дописать в существующую заметку или в карту «Входящие».
 */
import { toast, useApp } from '../store/appStore';
import type { MindDoc } from '../types';
import { sharedBlocks, sharedNoteBlocks, sharedTitle } from './shareCore';

/** Присланная картинка: файл в files/shared (Android) */
export interface SharedImage {
  path: string;
  type?: string;
}

export interface SharedText {
  text: string;
  title?: string;
  images?: SharedImage[];
}

/** Картинки → data URL (сжатые, как при вставке фото); не прочитанные — пропускаются */
export async function loadSharedImages(images: SharedImage[]): Promise<string[]> {
  if (!images.length) return [];
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { imageFileToDataUrl } = await import('../notes/media');
  const out: string[] = [];
  for (const im of images) {
    try {
      const r = await Filesystem.readFile({ path: im.path, directory: Directory.Data });
      const b64 = typeof r.data === 'string' ? r.data : await blobToBase64(r.data);
      const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: im.type || 'image/jpeg' });
      out.push(await imageFileToDataUrl(blob));
    } catch {
      /* не картинка или формат, который браузер не открывает (HEIC) */
    }
  }
  return out;
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Удалить копии присланных картинок (и забытые старше суток) */
export async function cleanupSharedImages(images: SharedImage[] = []): Promise<void> {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    for (const im of images) await Filesystem.deleteFile({ path: im.path, directory: Directory.Data }).catch(() => undefined);
    const dir = await Filesystem.readdir({ path: 'shared', directory: Directory.Data }).catch(() => null);
    const old = Date.now() - 86400000;
    for (const f of dir?.files ?? []) if ((f.mtime ?? 0) < old) await Filesystem.deleteFile({ path: 'shared/' + f.name, directory: Directory.Data }).catch(() => undefined);
  } catch {
    /* не Android — чистить нечего */
  }
}

const URL_RE = /https?:\/\/[^\s<>"']+/i;

/** Текст + заголовок + ссылка в одну строку-сообщение (без повторов) */
export function joinShared(p: { title?: string | null; text?: string | null; url?: string | null }): SharedText | null {
  const title = p.title?.trim() || undefined;
  let text = p.text?.trim() ?? '';
  const url = p.url?.trim();
  if (url && !text.includes(url)) text = text ? `${text}\n${url}` : url;
  if (!text && title) text = title;
  if (!text) return null;
  return { text, title: title && title !== text ? title : undefined };
}

/** Заголовок и остаток: первая строка (или тема письма/страницы, если прислана только ссылка) */
function split(s: SharedText, max: number): { head: string; rest: string; url?: string } {
  const lines = s.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const url = URL_RE.exec(s.text)?.[0];
  let head = lines[0] ?? '';
  let rest = lines.slice(1).join('\n');
  if (s.title && (head === url || !head)) {
    head = s.title;
    rest = lines.join('\n');
  }
  if (head.length > max) {
    rest = s.text.trim();
    head = head.slice(0, max - 1).trimEnd() + '…';
  }
  return { head, rest, url };
}

export async function shareToTask(s: SharedText) {
  const { ensureTasks, addTask, openTask } = await import('../tasks/store');
  await ensureTasks();
  const { head, rest } = split(s, 200);
  const t = addTask({ title: head, ...(rest ? { notes: rest } : {}) });
  if (!t) return toast('Не удалось добавить задачу');
  toast('Задача добавлена во «Входящие»', { label: 'Открыть', run: () => openTask(t.id) });
}

export async function shareToNote(s: SharedText, pics: string[] = []) {
  const { ensureNotes, createNote, openNote } = await import('../notes/store');
  await ensureNotes();
  const title = sharedTitle(s.text, s.title, pics.length);
  const m = createNote({ title, blocks: sharedNoteBlocks(s.text, title, pics) });
  if (!m) return toast('Не удалось сохранить заметку');
  useApp.getState().go('notes');
  setTimeout(() => void openNote(m.id), 50);
  toast('Заметка сохранена');
}

/** В заметку дня, в «Мысли» — с временем */
export async function shareToDaily(s: SharedText, pics: string[] = []) {
  const { appendToDaily, openDailyNote } = await import('../notes/daily');
  const r = await appendToDaily(s.text.replace(/\s*\n\s*/g, ' '), 'thoughts', undefined, sharedBlocks('', pics));
  if (!r) return toast('Не удалось записать');
  toast('Записано в заметку дня', { label: 'Открыть', run: () => void openDailyNote() });
}

/** Дописать в конец существующей заметки */
export async function shareAppend(noteId: string, s: SharedText, pics: string[] = []) {
  const { appendToNote } = await import('../notes/daily');
  const { openNote, useNotes } = await import('../notes/store');
  const ok = await appendToNote(noteId, sharedBlocks(s.text, pics));
  if (!ok) return toast('Не удалось дописать');
  const title = useNotes.getState().data?.notes.find((n) => n.id === noteId)?.title || 'заметку';
  toast(`Дописано в «${title}»`, {
    label: 'Открыть',
    run: () => {
      useApp.getState().go('notes');
      setTimeout(() => void openNote(noteId), 50);
    },
  });
}

/** Заметки, куда это подошло бы: по словам текста, а без текста — недавние */
export async function suggestNotes(text: string, limit = 3): Promise<{ id: string; title: string }[]> {
  const { ensureNotes, useNotes } = await import('../notes/store');
  await ensureNotes();
  const notes = (useNotes.getState().data?.notes ?? []).filter((n) => !n.trashed && !n.day && n.title.trim());
  const ok = new Set(notes.map((n) => n.id));
  const t = text.replace(/https?:\/\/\S+/g, ' ').trim();
  if (t.split(/\s+/).length >= 2) {
    try {
      const { ensureLinkIndex } = await import('../notes/related');
      const { searchIndex } = await import('../notes/links');
      const hits = searchIndex(await ensureLinkIndex(), t, { limit: 12 }).filter((h) => ok.has(h.id) && h.score >= 0.08);
      if (hits.length) return hits.slice(0, limit).map((h) => ({ id: h.id, title: notes.find((n) => n.id === h.id)!.title }));
    } catch {
      /* индекс ещё не готов — недавние */
    }
  }
  return [...notes]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((n) => ({ id: n.id, title: n.title }));
}

const INBOX_TITLE = 'Входящие';

/** Новая тема в карте «Входящие» (карта создаётся при первом использовании) */
export async function shareToMap(s: SharedText) {
  const [{ listDocs, loadDoc, saveDoc }, { flushSave, newDoc, newSheet }, { newTopic }, { openDoc }] = await Promise.all([
    import('../store/db'),
    import('../store/docStore'),
    import('../utils/tree'),
    import('../actions'),
  ]);
  // несохранённые правки открытой карты — сначала на диск, иначе они перезапишут новую тему
  await flushSave();
  const meta = (await listDocs()).find((m) => m.title === INBOX_TITLE && !m.trashed && !m.locked);
  let doc: MindDoc | undefined;
  if (meta) {
    const raw = await loadDoc(meta.id);
    if (raw && !('locked' in raw)) doc = raw;
  }
  doc ??= newDoc(INBOX_TITLE, newSheet('Лист 1', INBOX_TITLE));
  const sheet = doc.sheets[0];
  const { head, rest, url } = split(s, 200);
  const topic = newTopic(head);
  if (url) topic.link = url;
  if (rest && rest !== url) topic.note = rest;
  sheet.root.children.push(topic);
  doc.updatedAt = Date.now();
  await saveDoc(doc);
  useApp.setState({ docsVersion: Date.now() });
  toast('Добавлено в карту «Входящие»');
  await openDoc(doc.id, topic.id);
}
