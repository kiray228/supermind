import type { ID } from '../types';
import { uid } from '../utils/tree';

// ---------- Типы ----------

export type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'todo' | 'quote' | 'code' | 'divider' | 'image' | 'audio' | 'callout';

export interface Block {
  id: ID;
  type: BlockType;
  text?: string;
  checked?: boolean;
  /** data URL картинки или аудио */
  src?: string;
  caption?: string;
  /** расшифровка голосовой записи */
  transcript?: string;
  /** длительность записи, сек */
  duration?: number;
}

export interface NoteBody {
  title: string;
  blocks: Block[];
  updatedAt: number;
}

export interface NoteMeta {
  id: ID;
  title: string;
  /** начало текста для карточки */
  preview: string;
  folderId?: ID;
  pinned?: boolean;
  /** в корзине с этого момента */
  trashed?: number;
  createdAt: number;
  updatedAt: number;
  hasAudio?: boolean;
  hasImage?: boolean;
  hasTodo?: boolean;
  todoDone?: number;
  todoTotal?: number;
  wordCount?: number;
  /** примерный размер тела, байт */
  size?: number;
}

export interface Folder {
  id: ID;
  name: string;
  emoji?: string;
  color: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** Проверка ИИ важных слов заметки (id — id заметки) */
export interface AiTermsReview {
  id: ID;
  /** заметка на момент проверки (её updatedAt) — изменилась позже, значит, стоит проверить снова */
  at: number;
  /** ключи терминов, которые ИИ счёл неважными для темы */
  drop: string[];
  /** важные темы из текста, которые алгоритм пропустил (как написаны) */
  add: string[];
  checkedAt: number;
  updatedAt: number;
}

/** Решение по паре заметок (id — «a|b», a < b): связь верна или случайна */
export interface AiLinkReview {
  id: string;
  ok: boolean;
  /** коротко — почему */
  why?: string;
  /** кто решил: ИИ или сам человек (решение человека ИИ не меняет) */
  by: 'ai' | 'user';
  updatedAt: number;
}

export interface NotesData {
  version: 1;
  notes: NoteMeta[];
  folders: Folder[];
  /** удалённые сущности: id → когда (для синхронизации) */
  gone?: Record<string, number>;
  /** проверка связей ИИ */
  aiTerms?: AiTermsReview[];
  aiLinks?: AiLinkReview[];
}

export type NotesSort = 'updated' | 'created' | 'title';

// ---------- Константы ----------

export const FOLDER_COLORS = ['#ff4a2b', '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];
export const FOLDER_EMOJIS = ['📁', '💡', '📚', '💼', '🏠', '❤️', '✈️', '🎯', '🧠', '📝', '🎨', '🛒', '💰', '🏋️', '🍳', '🎵'];

export const TEXT_TYPES: BlockType[] = ['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'quote', 'code', 'callout'];
export const LIST_TYPES: BlockType[] = ['bullet', 'number', 'todo'];
export const isTextBlock = (b: Block) => TEXT_TYPES.includes(b.type);

export const BLOCK_LABELS: Record<BlockType, string> = {
  p: 'Текст',
  h1: 'Заголовок 1',
  h2: 'Заголовок 2',
  h3: 'Заголовок 3',
  bullet: 'Маркированный список',
  number: 'Нумерованный список',
  todo: 'Чек-лист',
  quote: 'Цитата',
  code: 'Код',
  callout: 'Выноска',
  divider: 'Разделитель',
  image: 'Изображение',
  audio: 'Голосовая запись',
};

export const MAX_AUDIO_SEC = 300;
export const BODY_WARN_BYTES = 6 * 1024 * 1024;

// ---------- Создание ----------

export function emptyNotesData(): NotesData {
  return { version: 1, notes: [], folders: [], gone: {} };
}

export function newBlock(type: BlockType = 'p', p: Partial<Block> = {}): Block {
  const b: Block = { id: uid(), type, ...p };
  if (TEXT_TYPES.includes(type) && b.text === undefined) b.text = '';
  if (type === 'todo' && b.checked === undefined) b.checked = false;
  return b;
}

export function emptyBody(): NoteBody {
  return { title: '', blocks: [newBlock('p')], updatedAt: Date.now() };
}

export function normalizeBody(raw: Partial<NoteBody> | undefined | null): NoteBody {
  const blocks = Array.isArray(raw?.blocks) ? raw!.blocks.filter((b) => b && b.id && b.type) : [];
  return { title: raw?.title ?? '', blocks: blocks.length ? blocks : [newBlock('p')], updatedAt: raw?.updatedAt ?? 0 };
}

// ---------- Текст ----------

/** Убрать Markdown-разметку из строки */
export function stripInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1$2');
}

/** Простой текст заметки (для поиска и ИИ) */
export function bodyPlainText(body: NoteBody): string {
  const out: string[] = [];
  for (const b of body.blocks) {
    if (b.text) out.push(stripInline(b.text));
    if (b.caption) out.push(b.caption);
    if (b.transcript) out.push(b.transcript);
  }
  return out.join('\n');
}

/** Поля метаданных, вычисляемые из тела */
export function metaFromBody(body: NoteBody, size: number): Partial<NoteMeta> {
  let hasAudio = false;
  let hasImage = false;
  let todoDone = 0;
  let todoTotal = 0;
  const parts: string[] = [];
  let words = 0;
  for (const b of body.blocks) {
    if (b.type === 'audio') hasAudio = true;
    if (b.type === 'image') hasImage = true;
    if (b.type === 'todo') {
      todoTotal++;
      if (b.checked) todoDone++;
    }
    const t = b.text ? stripInline(b.text).trim() : b.type === 'audio' ? (b.transcript ?? '').trim() : '';
    if (t) {
      words += t.split(/\s+/).length;
      if (parts.join(' ').length < 220) parts.push(b.type === 'todo' ? (b.checked ? '☑ ' : '☐ ') + t : t);
    }
  }
  return {
    title: body.title.trim(),
    preview: parts.join(' · ').replace(/\s+/g, ' ').slice(0, 220),
    hasAudio,
    hasImage,
    hasTodo: todoTotal > 0,
    todoDone,
    todoTotal,
    wordCount: words,
    size,
  };
}

export function isBodyEmpty(body: NoteBody): boolean {
  return !body.title.trim() && body.blocks.every((b) => isTextBlock(b) && !b.text?.trim());
}

export const fmtDuration = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** «Сегодня, 14:05», «Вчера», «12 окт.», «12 окт. 2024» */
export function noteDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return time;
  if (diff === 1) return 'Вчера';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('ru-RU', { weekday: 'long' });
  return d.toLocaleDateString('ru-RU', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- Markdown ----------

/** noTitle — без заголовка заметки, уровни заголовков как есть (для ИИ) */
export function noteToMarkdown(body: NoteBody, opts: { media?: boolean; noTitle?: boolean } = {}): string {
  const out: string[] = [];
  if (body.title.trim() && !opts.noTitle) out.push(`# ${body.title.trim()}`, '');
  const h = opts.noTitle ? '' : '#';
  let n = 0;
  let prevList = false;
  for (const b of body.blocks) {
    const t = b.text ?? '';
    const isList = LIST_TYPES.includes(b.type);
    if (prevList && !isList) out.push('');
    n = b.type === 'number' ? n + 1 : 0;
    switch (b.type) {
      case 'h1':
        out.push(`${h}# ${t}`, '');
        break;
      case 'h2':
        out.push(`${h}## ${t}`, '');
        break;
      case 'h3':
        out.push(`${h}### ${t}`, '');
        break;
      case 'bullet':
        out.push(`- ${t}`);
        break;
      case 'number':
        out.push(`${n}. ${t}`);
        break;
      case 'todo':
        out.push(`- [${b.checked ? 'x' : ' '}] ${t}`);
        break;
      case 'quote':
        out.push(...t.split('\n').map((l) => `> ${l}`), '');
        break;
      case 'callout':
        out.push(...t.split('\n').map((l, i) => `> ${i ? '' : '💡 '}${l}`), '');
        break;
      case 'code':
        out.push('```', t, '```', '');
        break;
      case 'divider':
        out.push('---', '');
        break;
      case 'image':
        out.push(opts.media && b.src ? `![${b.caption ?? ''}](${b.src})` : `*[Изображение${b.caption ? ': ' + b.caption : ''}]*`, '');
        break;
      case 'audio':
        out.push(`*[Голосовая запись ${fmtDuration(b.duration ?? 0)}]*`);
        if (b.transcript?.trim()) out.push(`> ${b.transcript.trim()}`);
        out.push('');
        break;
      default:
        out.push(t, '');
    }
    prevList = isList;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Markdown/простой текст → блоки (для вставки и ответов ИИ) */
export function markdownToBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let code: string[] | null = null;
  for (const raw of lines) {
    if (code) {
      if (/^\s*```/.test(raw)) {
        out.push(newBlock('code', { text: code.join('\n') }));
        code = null;
      } else code.push(raw);
      continue;
    }
    const line = raw.replace(/\s+$/, '');
    const s = line.trim();
    if (!s) continue;
    let m: RegExpMatchArray | null;
    if (/^```/.test(s)) code = [];
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) out.push(newBlock('divider'));
    else if ((m = s.match(/^(#{1,6})\s+(.*)$/))) out.push(newBlock(m[1].length === 1 ? 'h1' : m[1].length === 2 ? 'h2' : 'h3', { text: m[2] }));
    else if ((m = s.match(/^[-*+]\s+\[( |x|X)\]\s*(.*)$/))) out.push(newBlock('todo', { text: m[2], checked: m[1] !== ' ' }));
    else if ((m = s.match(/^\[( |x|X)?\]\s+(.*)$/))) out.push(newBlock('todo', { text: m[2], checked: !!m[1] && m[1] !== ' ' }));
    else if ((m = s.match(/^[-*+•]\s+(.*)$/))) out.push(newBlock('bullet', { text: m[1] }));
    else if ((m = s.match(/^\d+[.)]\s+(.*)$/))) out.push(newBlock('number', { text: m[1] }));
    else if ((m = s.match(/^>\s?(.*)$/))) {
      const prev = out[out.length - 1];
      if (prev?.type === 'quote') prev.text += '\n' + m[1];
      else out.push(newBlock('quote', { text: m[1] }));
    } else out.push(newBlock('p', { text: s }));
  }
  if (code) out.push(newBlock('code', { text: code.join('\n') }));
  return out;
}
