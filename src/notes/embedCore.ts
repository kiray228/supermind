/**
 * Встраивание заметки: строка «![[Заметка]]» или «![[Заметка#Раздел]]» показывает её содержимое (или раздел)
 * прямо в другой заметке и обновляется само. Модуль чистый — тесты гоняют его в Node; показ — ui/NoteEmbed.tsx.
 */
import { parseWiki } from './links';
import { type Block, stripInline } from './model';

export interface EmbedRef {
  title: string;
  section?: string;
}

/** Встраивание — весь абзац целиком: «![[…]]» */
const EMBED_LINE = /^!\[\[([^[\]\n]{1,200}?)\]\]$/;

export function parseEmbed(text: string | undefined): EmbedRef | null {
  const m = EMBED_LINE.exec((text ?? '').trim());
  if (!m) return null;
  const { title, section } = parseWiki(m[1]);
  if (!title) return null;
  return section ? { title, section } : { title };
}

export const embedText = (title: string, section?: string) => `![[${title}${section ? `#${section}` : ''}]]`;

const isHead = (b: Block) => b.type === 'h1' || b.type === 'h2' || b.type === 'h3';
const level = (b: Block) => Number(b.type.slice(1));
const normHead = (s: string) => stripInline(s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Раздел заметки: заголовок и всё до следующего заголовка того же или старшего уровня. null — такого раздела нет */
export function sectionBlocks(blocks: Block[], section: string): Block[] | null {
  const k = normHead(section);
  const i = blocks.findIndex((b) => isHead(b) && normHead(b.text ?? '') === k);
  if (i < 0) return null;
  let end = i + 1;
  while (end < blocks.length && !(isHead(blocks[end]) && level(blocks[end]) <= level(blocks[i]))) end++;
  return blocks.slice(i, end);
}

/** Заголовки заметки (для подсказки «![[Заметка#…»): текст без разметки, без повторов */
export function headingsOf(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    const t = isHead(b) ? stripInline(b.text ?? '').trim() : '';
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Блоки для показа: без пустых абзацев по краям, не больше max */
export function embedBlocks(blocks: Block[], max = 60): { blocks: Block[]; more: number } {
  let a = 0;
  let b = blocks.length;
  const empty = (x: Block) => x.type === 'p' && !x.text?.trim();
  while (a < b && empty(blocks[a])) a++;
  while (b > a && empty(blocks[b - 1])) b--;
  const list = blocks.slice(a, b);
  return { blocks: list.slice(0, max), more: Math.max(0, list.length - max) };
}
