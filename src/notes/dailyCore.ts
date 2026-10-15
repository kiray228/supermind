/**
 * Заметка дня: название и шаблон (задачи дня — [[ссылками]], мысли, итоги, ссылка на вчерашний день).
 * Модуль чистый — тесты гоняют его в Node; открытие и создание — daily.ts.
 */
import { type Block, newBlock } from './model';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

const parse = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** «15 октября 2026» — название заметки дня (одно на день) */
export function dailyTitle(ymd: string): string {
  const d = parse(ymd);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

/** «Четверг» */
export const weekdayOf = (ymd: string) => {
  const w = WEEKDAYS[parse(ymd).getDay()];
  return w[0].toUpperCase() + w.slice(1);
};

export const DAILY_FOLDER = 'Дневник';
export const DAILY_SECTIONS = { tasks: 'Задачи на день', thoughts: 'Мысли', results: 'Итоги дня' } as const;

/** Задача для заметки дня: [[ссылка]], если название её не сломает */
const taskLine = (t: string) => (/[[\]|\n]/.test(t) || !t.trim() ? t.replace(/\n/g, ' ').trim() : `[[${t.trim()}]]`);

export interface DailyInput {
  ymd: string;
  /** названия задач на этот день (и просроченных — для сегодняшнего) */
  tasks: string[];
  /** цели со сроком в этот день */
  goals?: string[];
  /** название прошлой заметки дня, если есть */
  prev?: string;
}

/** Шаблон заметки дня */
export function dailyBlocks(inp: DailyInput): Block[] {
  const out: Block[] = [];
  out.push(newBlock('p', { text: weekdayOf(inp.ymd) + (inp.prev ? ` · прошлая запись: [[${inp.prev}]]` : '') }));
  out.push(newBlock('h2', { text: DAILY_SECTIONS.tasks }));
  const tasks = [...new Set(inp.tasks.map(taskLine).filter(Boolean))];
  if (tasks.length) for (const t of tasks) out.push(newBlock('bullet', { text: t }));
  else out.push(newBlock('bullet', { text: '' }));
  for (const g of inp.goals ?? []) out.push(newBlock('bullet', { text: `🎯 срок: ${taskLine(g)}` }));
  out.push(newBlock('h2', { text: DAILY_SECTIONS.thoughts }));
  out.push(newBlock('p', { text: '' }));
  out.push(newBlock('h2', { text: DAILY_SECTIONS.results }));
  out.push(newBlock('p', { text: '' }));
  return out;
}

/** Прошлый день (YYYY-MM-DD) */
export function prevYmd(ymd: string, days = 1): string {
  const d = parse(ymd);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Дописать блоки в раздел заметки (после последнего непустого блока раздела, до следующего заголовка того же уровня).
 * Пустой абзац-заглушка раздела заменяется. Раздела нет — блоки в конец.
 */
export function insertIntoSection(blocks: Block[], heading: string, add: Block[]): Block[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const h = blocks.findIndex((b) => /^h[1-3]$/.test(b.type) && norm(b.text ?? '') === norm(heading));
  if (h < 0) {
    const out = [...blocks];
    // пустой последний абзац — заменить, а не оставлять «дырку»
    while (out.length && out[out.length - 1].type === 'p' && !out[out.length - 1].text?.trim()) out.pop();
    return [...out, ...add];
  }
  const level = blocks[h].type;
  let end = h + 1;
  while (end < blocks.length && !(/^h[1-3]$/.test(blocks[end].type) && blocks[end].type <= level)) end++;
  // раздел: убрать пустые абзацы-заглушки, дописать после содержимого
  const section = blocks.slice(h + 1, end).filter((b) => !(b.type === 'p' && !b.text?.trim()));
  return [...blocks.slice(0, h + 1), ...section, ...add, ...blocks.slice(end)];
}

/** «14:05 · текст» — запись в дневник с временем */
export function journalLine(text: string, at = new Date()): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} · ${text.trim()}`;
}
