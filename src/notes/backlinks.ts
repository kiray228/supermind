/**
 * «Упоминается в» и дубли: где в тексте встречается название записи (без ссылки),
 * как сделать такое место ссылкой, как слить две заметки в одну.
 * Модуль без браузерных зависимостей — тесты гоняют его в Node.
 */
import { buildMentionIndex, findMentions, normTitle, parseWiki } from './links';
import type { Block, NoteBody } from './model';
import { uid } from '../utils/tree';

export interface Occurrence {
  start: number;
  end: number;
}

/** Части текста, где упоминание не ищем: [[ссылки]], [текст](адрес), `код` */
function protectedRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const re of [/\[\[[^[\]\n]*?\]\]/g, /\[[^\]\n]+\]\([^)\s]+\)/g, /`[^`\n]+`/g]) for (const m of text.matchAll(re)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

/**
 * Где в тексте упомянуто название (в любой форме слова), кроме мест внутри ссылок и кода.
 * canon — слияние форм, как в индексе связей.
 */
export function titleMentions(text: string, title: string, canon?: (k: string) => string): Occurrence[] {
  if (!text || !title.trim()) return [];
  const mx = buildMentionIndex([{ id: 't', title }], { canon, isRare: () => true });
  const skip = protectedRanges(text);
  return findMentions(text, mx)
    .filter((m) => !skip.some(([a, b]) => m.start < b && m.end > a))
    .map(({ start, end }) => ({ start, end }));
}

/** Есть ли в тексте явная [[ссылка]] на это название */
export function hasWikiTo(text: string, title: string): boolean {
  const k = normTitle(title);
  for (const m of text.matchAll(/\[\[([^[\]\n]+?)\]\]/g)) if (normTitle(parseWiki(m[1]).title) === k) return true;
  return false;
}

/** Сделать упоминание ссылкой: «подушку безопасности» → [[Подушка безопасности|подушку безопасности]] */
export function linkOccurrence(text: string, occ: Occurrence, title: string): string {
  const shown = text.slice(occ.start, occ.end);
  const link = normTitle(shown) === normTitle(title) ? `[[${title}]]` : `[[${title}|${shown}]]`;
  return text.slice(0, occ.start) + link + text.slice(occ.end);
}

/** Фрагмент вокруг упоминания: до, само упоминание, после (с «…», если обрезано) */
export function snippetAround(text: string, occ: Occurrence, radius = 60): { before: string; match: string; after: string } {
  const flat = (s: string) => s.replace(/\s+/g, ' ');
  let a = Math.max(0, occ.start - radius);
  let b = Math.min(text.length, occ.end + radius);
  // не резать слово пополам
  while (a > 0 && /\S/.test(text[a - 1]) && occ.start - a < radius + 15) a--;
  while (b < text.length && /\S/.test(text[b]) && b - occ.end < radius + 15) b++;
  return {
    before: (a > 0 ? '…' : '') + flat(text.slice(a, occ.start)).trimStart(),
    match: text.slice(occ.start, occ.end),
    after: flat(text.slice(occ.end, b)).trimEnd() + (b < text.length ? '…' : ''),
  };
}

/** [[Старое название]] и [[Старое название|подпись]] → ссылки на новое название (подпись сохраняется) */
export function retargetWiki(text: string, fromTitle: string, toTitle: string): string {
  const from = normTitle(fromTitle);
  return text.replace(/\[\[([^[\]\n]+?)\]\]/g, (all, inner: string) => {
    const { title, label, section } = parseWiki(inner);
    if (normTitle(title) !== from) return all;
    const to = section ? `${toTitle}#${section}` : toTitle;
    const shown = inner.includes('|') ? label : title;
    return normTitle(shown) === normTitle(toTitle) ? `[[${to}]]` : `[[${to}|${shown}]]`;
  });
}

/**
 * Слить заметку from в заметку into: содержимое from — в конец, под разделителем и её названием.
 * Пустой первый абзац into не остаётся. Блоки получают новые id.
 */
export function mergeBodies(into: NoteBody, from: NoteBody): NoteBody {
  const empty = (b: Block) => (b.type === 'p' || b.type === 'h1' || b.type === 'h2' || b.type === 'h3') && !b.text?.trim();
  const head = into.blocks.filter((b) => !empty(b));
  const tail = from.blocks.filter((b) => !empty(b)).map((b) => ({ ...b, id: uid() }));
  const added: Block[] = [];
  if (tail.length || from.title.trim()) {
    if (head.length) added.push({ id: uid(), type: 'divider' });
    if (from.title.trim() && normTitle(from.title) !== normTitle(into.title)) added.push({ id: uid(), type: 'h2', text: from.title.trim() });
  }
  const blocks = [...head, ...added, ...tail];
  return { ...into, blocks: blocks.length ? blocks : into.blocks };
}
