/**
 * «Поделиться → SuperMind»: сохранить присланный текст или ссылку как задачу, заметку
 * или тему в карте «Входящие».
 */
import { toast, useApp } from '../store/appStore';
import type { MindDoc } from '../types';

export interface SharedText {
  text: string;
  title?: string;
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

export async function shareToNote(s: SharedText) {
  const { ensureNotes, createNote, openNote } = await import('../notes/store');
  const { newBlock } = await import('../notes/model');
  await ensureNotes();
  const { head, rest } = split(s, 80);
  const blocks = (rest || (head ? '' : s.text)).split('\n').filter((l) => l.trim()).map((l) => newBlock('p', { text: l }));
  const m = createNote({ title: head, blocks });
  if (!m) return toast('Не удалось сохранить заметку');
  useApp.getState().go('notes');
  setTimeout(() => void openNote(m.id), 50);
  toast('Заметка сохранена');
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
