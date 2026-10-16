/**
 * «Доделать, когда появится связь»: работа ИИ, которая не получилась (нет сети, ИИ недоступен),
 * выполняется позже сама — при появлении сети, возвращении в приложение и раз в 10 минут.
 *  — статья без пересказа: страница читается заново, пересказ встаёт на место «Начала статьи»;
 *  — длинная голосовая мысль: слова уже в дневнике, ИИ раскладывает их на заметку и задачи.
 * Очередь — на этом устройстве (localStorage).
 */
import { create } from 'zustand';
import type { ID } from '../types';

export type QueueItem =
  | { id: string; kind: 'article'; noteId: ID; url: string; body: string; savedAt: number; tries: number; next: number }
  | { id: string; kind: 'dictation'; text: string; journal?: { noteId: ID; blockIds: string[] }; savedAt: number; tries: number; next: number };

const KEY = 'sm-ai-queue';
/** не больше стольких попыток и не дольше недели */
const MAX_TRIES = 6;
const MAX_AGE = 7 * 86400000;

export const useAiQueue = create<{ items: QueueItem[] }>(() => ({ items: read() }));

function read(): QueueItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && x.id && (x.kind === 'article' || x.kind === 'dictation')) : [];
  } catch {
    return [];
  }
}

function write(items: QueueItem[]) {
  useAiQueue.setState({ items });
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* хранилище недоступно — очередь проживёт до перезапуска */
  }
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** Снимок текста заметки — понять, правил ли её человек после сохранения */
export const bodyStamp = (blocks: { text?: string; type: string }[]) => blocks.map((b) => b.type + ':' + (b.text ?? '')).join('\n');

export function queueArticle(noteId: ID, url: string, body: string, now = Date.now()) {
  write([...useAiQueue.getState().items.filter((x) => !(x.kind === 'article' && x.noteId === noteId)), { id: newId(), kind: 'article', noteId, url, body, savedAt: now, tries: 0, next: now }]);
}

export function queueDictation(text: string, journal?: { noteId: ID; blockIds: string[] }, now = Date.now()) {
  write([...useAiQueue.getState().items, { id: newId(), kind: 'dictation', text, ...(journal ? { journal } : {}), savedAt: now, tries: 0, next: now }]);
}

/** Убрать из очереди (отменили то, что ждало ИИ) */
export function dropQueued(match: (x: QueueItem) => boolean) {
  const items = useAiQueue.getState().items;
  if (items.some(match)) write(items.filter((x) => !match(x)));
}

/** ИИ сейчас можно спросить: есть сеть и свой ключ или вход в аккаунт */
export async function aiReady(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const [{ hasOwnKey }, { useCloud }] = await Promise.all([import('../ai/claude'), import('../store/cloud')]);
  return hasOwnKey() || !!useCloud.getState().account;
}

/** Через сколько повторить: 1, 5, 15, 60 минут… */
const backoff = (tries: number) => [60_000, 300_000, 900_000, 3_600_000, 3 * 3_600_000, 12 * 3_600_000][Math.min(tries, 5)];

export interface QueueResult {
  done: number;
  messages: string[];
}

let running: Promise<QueueResult> | null = null;

/** Выполнить, что можно. Повторный вызов во время работы ждёт ту же работу */
export function processQueue(now = Date.now()): Promise<QueueResult> {
  running ??= run(now).finally(() => (running = null));
  return running;
}

async function run(now: number): Promise<QueueResult> {
  const res: QueueResult = { done: 0, messages: [] };
  const due = useAiQueue.getState().items.filter((x) => x.next <= now);
  if (!due.length || !(await aiReady())) return res;
  for (const it of due) {
    let outcome: 'done' | 'drop' | 'retry';
    try {
      const msg = it.kind === 'article' ? await doArticle(it) : await doDictation(it);
      outcome = msg === null ? 'drop' : 'done';
      if (msg) res.messages.push(msg);
    } catch {
      outcome = 'retry';
    }
    const items = useAiQueue.getState().items;
    if (outcome === 'retry' && it.tries + 1 < MAX_TRIES && now - it.savedAt < MAX_AGE) write(items.map((x) => (x.id === it.id ? { ...x, tries: x.tries + 1, next: now + backoff(x.tries) } : x)));
    else write(items.filter((x) => x.id !== it.id));
    if (outcome === 'done') res.done++;
  }
  return res;
}

/** Статья: пересказ на место «Начала статьи» (или в конец, если заметку уже правили). null — делать нечего */
async function doArticle(it: Extract<QueueItem, { kind: 'article' }>): Promise<string | null> {
  const { useNotes, loadNoteBody, saveNoteBody, editOpenBody, flushNotes } = await import('./store');
  const meta = useNotes.getState().data?.notes.find((n) => n.id === it.noteId && !n.trashed);
  if (!meta) return null;
  const { fetchPage } = await import('./article');
  const { extractArticle, articleMarkdown, ARTICLE_SYSTEM, buildArticlePrompt } = await import('./articleCore');
  const { streamText } = await import('../ai/claude');
  const { markdownToBlocks, newBlock } = await import('./model');
  const page = await fetchPage(it.url);
  const a = extractArticle(page.html, page.url);
  if (a.text.length <= 200) return null;
  const summary = (await streamText({ system: ARTICLE_SYSTEM, messages: [{ role: 'user', content: buildArticlePrompt(a) }], effort: 'low' })).trim();
  if (!summary) throw new Error('пустой ответ');
  const s = useNotes.getState();
  const open = s.openId === it.noteId && s.openBody;
  const body = open ? s.openBody! : await loadNoteBody(it.noteId);
  const untouched = bodyStamp(body.blocks) === it.body;
  const blocks = untouched ? markdownToBlocks(articleMarkdown(a, summary)) : [...body.blocks, newBlock('h2', { text: 'Главное от ИИ' }), ...markdownToBlocks(summary)];
  if (open) editOpenBody((bd) => void (bd.blocks = blocks));
  else saveNoteBody(it.noteId, { ...body, blocks });
  await flushNotes();
  return `Пересказ статьи «${meta.title || a.title}» готов`;
}

/** Голосовая мысль: заметка и задачи по ИИ; запись в дневнике — аккуратнее, если ИИ её предложил */
async function doDictation(it: Extract<QueueItem, { kind: 'dictation' }>): Promise<string | null> {
  const { SPLIT_SYSTEM, buildSplitPrompt, parseSplit } = await import('../voice/dictation');
  const { streamText } = await import('../ai/claude');
  const answer = await streamText({ system: SPLIT_SYSTEM, messages: [{ role: 'user', content: buildSplitPrompt(it.text, new Date(it.savedAt)) }], effort: 'low' });
  const acts = parseSplit(answer);
  if (!acts.length) return null;
  const { execute } = await import('../voice/run');
  const parts: string[] = [];
  for (const a of acts) {
    if (a.type === 'add_journal') {
      // слова уже в дневнике — заменить сырую расшифровку аккуратной записью
      if (it.journal) await replaceJournal(it.journal, a.text);
      continue;
    }
    const d = await execute(a);
    if (d.ok) parts.push(a.type === 'add_note' ? `заметка «${a.title}»` : a.type === 'add_task' ? 'задача' : '');
  }
  const tasks = parts.filter((p) => p === 'задача').length;
  const note = parts.find((p) => p.startsWith('заметка'));
  const what = [note, tasks ? `задач: ${tasks}` : ''].filter(Boolean).join(', ');
  return what ? `Голосовая запись разобрана: ${what}` : 'Голосовая запись разобрана';
}

async function replaceJournal(j: { noteId: ID; blockIds: string[] }, text: string) {
  const { useNotes, loadNoteBody, saveNoteBody, editOpenBody, flushNotes } = await import('./store');
  const { journalLine } = await import('./dailyCore');
  const s = useNotes.getState();
  const open = s.openId === j.noteId && s.openBody;
  const body = open ? s.openBody! : await loadNoteBody(j.noteId).catch(() => null);
  if (!body) return;
  const first = body.blocks.find((b) => b.id === j.blockIds[0]);
  if (!first?.text) return;
  // время записи — прежнее
  const time = /^\d\d:\d\d/.exec(first.text)?.[0];
  const line = time ? `${time} · ${text.trim()}` : journalLine(text);
  const blocks = body.blocks.map((b) => (b.id === first.id ? { ...b, text: line } : b));
  if (open) editOpenBody((bd) => void (bd.blocks = blocks));
  else saveNoteBody(j.noteId, { ...body, blocks });
  await flushNotes();
}

let started = false;

/** Обрабатывать очередь: при появлении сети, при возвращении в приложение, раз в 10 минут и вскоре после запуска */
export function initAiQueue() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const kick = () =>
    void processQueue()
      .then(async (r) => {
        if (!r.messages.length) return;
        const { toast } = await import('../store/appStore');
        toast(r.messages.length === 1 ? r.messages[0] : `Доделано с ИИ: ${r.messages.length} — ${r.messages.join('; ')}`);
      })
      .catch(() => undefined);
  window.addEventListener('online', () => setTimeout(kick, 3000));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && kick());
  setInterval(kick, 10 * 60_000);
  setTimeout(kick, 15_000);
}
