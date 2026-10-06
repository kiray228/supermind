import { uid } from '../../utils/tree';
import { type Block, type BlockType, isTextBlock, LIST_TYPES } from '../model';

/** Быстрые сокращения в начале пустого абзаца: «# », «- », «[] »… */
const SHORTCUTS: { re: RegExp; type: BlockType; checked?: boolean }[] = [
  { re: /^###\s/, type: 'h3' },
  { re: /^##\s/, type: 'h2' },
  { re: /^#\s/, type: 'h1' },
  { re: /^[-*•–]\s/, type: 'bullet' },
  { re: /^1[.)]\s/, type: 'number' },
  { re: /^\[\s?\]\s/, type: 'todo' },
  { re: /^\[[xXхХ]\]\s/, type: 'todo', checked: true },
  { re: /^>\s/, type: 'quote' },
  { re: /^!>\s/, type: 'callout' },
  { re: /^(```|‘‘‘|ʼʼʼ)/, type: 'code' },
];

/** Превратить абзац по сокращению. null — сокращения нет */
export function detectShortcut(prev: string, next: string): { type: BlockType; text: string; checked?: boolean } | null {
  if (next.length <= prev.length) return null;
  // iOS превращает «--» в «—»
  const DIV = /^(---|—-|\*\*\*|___)$/;
  if (DIV.test(next) && !DIV.test(prev)) return { type: 'divider', text: '' };
  for (const s of SHORTCUTS) {
    const m = next.match(s.re);
    if (m && !s.re.test(prev)) return { type: s.type, text: next.slice(m[0].length), ...(s.checked !== undefined ? { checked: s.checked } : {}) };
  }
  return null;
}

/** Тип нового блока после Enter */
export const nextTypeAfter = (t: BlockType): BlockType => (LIST_TYPES.includes(t) ? t : 'p');

/** Сменить тип блока с сохранением текста */
export function convertBlock(b: Block, type: BlockType): Block {
  const next: Block = { id: b.id, type };
  if (isTextBlock({ id: '', type })) next.text = b.text ?? b.transcript ?? b.caption ?? '';
  if (type === 'todo') next.checked = b.type === 'todo' ? !!b.checked : false;
  return next;
}

/** Номера для нумерованных списков */
export function listNumbers(blocks: Block[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (const b of blocks) {
    n = b.type === 'number' ? n + 1 : 0;
    out.push(n);
  }
  return out;
}

/** Обернуть выделение маркерами (**…**). Без выделения — вставить пару и поставить курсор внутрь */
export function wrapSelection(text: string, start: number, end: number, open: string, close = open): { text: string; start: number; end: number } {
  const sel = text.slice(start, end);
  // уже обёрнуто — снять
  if (sel && text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
    return { text: text.slice(0, start - open.length) + sel + text.slice(end + close.length), start: start - open.length, end: end - open.length };
  }
  if (open === '[') {
    const label = sel || 'ссылка';
    const url = 'https://';
    const t = text.slice(0, start) + `[${label}](${url})` + text.slice(end);
    const p = start + label.length + 3;
    return { text: t, start: p, end: p + url.length };
  }
  const t = text.slice(0, start) + open + sel + close + text.slice(end);
  return { text: t, start: start + open.length, end: start + open.length + sel.length };
}

export function cloneBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => ({ ...b, id: uid() }));
}
