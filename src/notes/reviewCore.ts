/**
 * Обзор мозга за неделю: что требует внимания (заметки без связей, забытые, но нужные сейчас, длинные — разбить)
 * и разбиение заметки по разделам. Модуль чистый — тесты гоняют его в Node.
 */
import { type Block, type NoteBody } from './model';

const DAY = 86400000;
/** «недавно» — менялась за столько дней */
export const RECENT_DAYS = 7;
/** «забыта» — не менялась столько дней */
export const FORGOTTEN_DAYS = 30;
/** заметка без связей интересна, если в ней хоть сколько-то текста */
export const ORPHAN_MIN_WORDS = 8;
/** длинная — можно разбить */
export const LONG_WORDS = 600;

export interface ReviewNote {
  id: string;
  title: string;
  updatedAt: number;
  wordCount: number;
}

export interface ReviewInput {
  notes: ReviewNote[];
  /** связи записи (id других записей мозга, по убыванию силы) */
  related: (id: string) => string[];
  /** у записи есть явные [[ссылки]] — на неё или из неё */
  wiki: (id: string) => boolean;
  /** записи мозга (заметки, карты, задачи, цели), менявшиеся недавно: id → когда */
  recent: Map<string, number>;
  now: number;
}

export interface Forgotten {
  id: string;
  /** с какой недавней записью связана */
  via: string;
  /** сколько дней не открывали */
  days: number;
}

export interface ReviewFindings {
  /** заметки с текстом, но без единой связи */
  orphans: string[];
  /** давно не менялись, но связаны с тем, над чем человек работает сейчас */
  forgotten: Forgotten[];
}

export function reviewFindings(inp: ReviewInput, max = 12): ReviewFindings {
  const orphans = inp.notes
    .filter((n) => n.wordCount >= ORPHAN_MIN_WORDS && !inp.wiki(n.id) && inp.related(n.id).length === 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max)
    .map((n) => n.id);
  const old = inp.now - FORGOTTEN_DAYS * DAY;
  const forgotten: Forgotten[] = [];
  for (const n of [...inp.notes].sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (n.updatedAt > old || forgotten.length >= max) continue;
    // самая сильная из недавних связей
    const via = inp.related(n.id).find((r) => inp.recent.has(r) && r !== n.id);
    if (via) forgotten.push({ id: n.id, via, days: Math.floor((inp.now - n.updatedAt) / DAY) });
  }
  // свежие связи — первыми: то, что нужно прямо сейчас
  forgotten.sort((a, b) => (inp.recent.get(b.via) ?? 0) - (inp.recent.get(a.via) ?? 0) || b.days - a.days);
  return { orphans, forgotten };
}

// ---------- Разбить заметку по разделам ----------

export interface SplitPart {
  title: string;
  blocks: Block[];
}

/** Уровень разделов: заголовки второго уровня, а если их меньше двух — первого */
function sectionType(blocks: Block[]): 'h1' | 'h2' | null {
  for (const t of ['h2', 'h1'] as const) if (blocks.filter((b) => b.type === t && b.text?.trim()).length >= 2) return t;
  return null;
}

const hasContent = (b: Block) => !!(b.text?.trim() || b.src || b.type === 'divider');

/**
 * Разделы заметки → отдельные заметки (название — заголовок раздела); в исходной остаются вступление
 * и список [[ссылок]] на разделы. null — разбивать нечего (меньше двух непустых разделов).
 */
export function splitByHeadings(body: NoteBody): { intro: Block[]; parts: SplitPart[] } | null {
  const level = sectionType(body.blocks);
  if (!level) return null;
  const intro: Block[] = [];
  const parts: SplitPart[] = [];
  let cur: SplitPart | null = null;
  for (const b of body.blocks) {
    if (b.type === level && b.text?.trim()) {
      cur = { title: b.text.trim(), blocks: [] };
      parts.push(cur);
    } else if (cur) cur.blocks.push(b);
    else intro.push(b);
  }
  // раздел без содержимого — остаётся заголовком в исходной заметке, а не пустой заметкой
  const full = parts.filter((p) => p.blocks.some(hasContent));
  if (full.length < 2) return null;
  for (const p of parts) if (!full.includes(p)) intro.push({ id: 'h-' + p.title, type: level, text: p.title });
  // разделитель в конце раздела — лишний
  for (const p of full) while (p.blocks.length && p.blocks[p.blocks.length - 1].type === 'divider') p.blocks.pop();
  return { intro, parts: full };
}

/** Название раздела годится для [[ссылки]] */
export const linkableTitle = (t: string) => t.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
