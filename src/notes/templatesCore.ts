/**
 * Свои шаблоны заметок: шаблон — обычная заметка в папке «Шаблоны». В тексте и названии шаблона можно писать
 * {{дата}}, {{время}}, {{день недели}}, {{название}}, {{задачи}}, {{цели}}, {{вчера}} — при создании заметки подставятся.
 * Шаблон «Заметка дня» оформляет заметку дня. Модуль чистый — тесты гоняют его в Node; хранение и окна — templates.ts.
 */
import { type Block, newBlock, stripInline } from './model';
import { uid } from '../utils/tree';

export const TEMPLATE_FOLDER = 'Шаблоны';
/** так папку с шаблонами называет Obsidian — тоже подходит */
const FOLDER_NAMES = new Set(['шаблоны', 'templates', 'template', 'шаблон']);
export const isTemplateFolderName = (name: string) => FOLDER_NAMES.has(name.trim().toLowerCase());

/** шаблон с таким названием оформляет заметку дня */
export const DAILY_TEMPLATE = 'Заметка дня';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export interface TemplateVars {
  /** день заметки (YYYY-MM-DD) */
  ymd: string;
  /** время создания «14:05» */
  time?: string;
  /** название новой заметки */
  title?: string;
  /** задачи дня (для заметки дня) */
  tasks?: string[];
  /** цели со сроком в этот день */
  goals?: string[];
  /** название прошлой заметки дня */
  prev?: string;
}

const VAR_RE = /\{\{\s*([^{}\n]{1,40}?)\s*\}\}/g;
export const hasVars = (s: string) => /\{\{\s*[^{}\n]{1,40}?\s*\}\}/.test(s);

/** Подстановки, которые понимает шаблон (для подсказки) */
export const TEMPLATE_VARS: { name: string; hint: string }[] = [
  { name: 'дата', hint: '16 октября 2026' },
  { name: 'время', hint: '14:05' },
  { name: 'день недели', hint: 'Пятница' },
  { name: 'название', hint: 'название новой заметки' },
  { name: 'задачи', hint: 'задачи на день — списком' },
  { name: 'цели', hint: 'сроки целей в этот день' },
  { name: 'вчера', hint: 'ссылка на прошлую заметку дня' },
];

const parse = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pad = (n: number) => String(n).padStart(2, '0');

/** {{дата:DD.MM.YYYY}} — свой формат: YYYY, YY, MMMM (октября), MM, M, DD, D, dddd (пятница) */
export function formatDate(ymd: string, fmt: string): string {
  const d = parse(ymd);
  return fmt.replace(/YYYY|YY|MMMM|MM|M|dddd|DD|D/g, (t) => {
    switch (t) {
      case 'YYYY':
        return String(d.getFullYear());
      case 'YY':
        return String(d.getFullYear()).slice(2);
      case 'MMMM':
        return MONTHS_GEN[d.getMonth()];
      case 'MM':
        return pad(d.getMonth() + 1);
      case 'M':
        return String(d.getMonth() + 1);
      case 'dddd':
        return WEEKDAYS[d.getDay()];
      case 'DD':
        return pad(d.getDate());
      default:
        return String(d.getDate());
    }
  });
}

/** Задача или цель — [[ссылкой]], если название её не сломает */
const asLink = (t: string) => (/[[\]|\n]/.test(t) || !t.trim() ? t.replace(/\n/g, ' ').trim() : `[[${t.trim()}]]`);
const goalLine = (g: string) => `🎯 срок: ${asLink(g)}`;

type VarKind = 'date' | 'time' | 'weekday' | 'title' | 'tasks' | 'goals' | 'prev';
const ALIASES: Record<string, VarKind> = {
  дата: 'date',
  date: 'date',
  время: 'time',
  time: 'time',
  'день недели': 'weekday',
  день: 'weekday',
  weekday: 'weekday',
  название: 'title',
  заголовок: 'title',
  title: 'title',
  задачи: 'tasks',
  tasks: 'tasks',
  цели: 'goals',
  goals: 'goals',
  вчера: 'prev',
  'прошлая запись': 'prev',
  prev: 'prev',
  yesterday: 'prev',
};

/** Имя подстановки → вид и формат («дата:DD.MM» → date + «DD.MM»). null — не подстановка (оставить как есть) */
function varOf(raw: string): { kind: VarKind; fmt?: string } | null {
  const colon = raw.indexOf(':');
  const name = (colon >= 0 ? raw.slice(0, colon) : raw).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  const kind = ALIASES[name];
  if (!kind) return null;
  const fmt = colon >= 0 ? raw.slice(colon + 1).trim() : '';
  return fmt && kind === 'date' ? { kind, fmt } : { kind };
}

function valueOf(v: { kind: VarKind; fmt?: string }, vars: TemplateVars): string {
  switch (v.kind) {
    case 'date':
      return v.fmt ? formatDate(vars.ymd, v.fmt) : formatDate(vars.ymd, 'D MMMM YYYY');
    case 'time':
      return vars.time ?? '';
    case 'weekday':
      return cap(WEEKDAYS[parse(vars.ymd).getDay()]);
    case 'title':
      return vars.title ?? '';
    case 'tasks':
      return (vars.tasks ?? []).map(asLink).join(', ');
    case 'goals':
      return (vars.goals ?? []).map(goalLine).join(', ');
    case 'prev':
      return vars.prev ? `[[${vars.prev}]]` : '';
  }
}

/**
 * Подставить значения в строку. Части через « · », где подстановка оказалась пустой, убираются целиком:
 * «{{день недели}} · прошлая запись: {{вчера}}» без прошлой записи → «Пятница».
 */
export function fillText(s: string, vars: TemplateVars): string {
  if (!hasVars(s)) return s;
  const parts = s.split(' · ').map((part) => {
    let empty = false;
    const out = part.replace(VAR_RE, (all, raw: string) => {
      const v = varOf(raw);
      if (!v) return all;
      const val = valueOf(v, vars);
      if (!val) empty = true;
      return val;
    });
    return empty ? null : out;
  });
  const kept = parts.filter((p): p is string => p !== null);
  return kept.join(' · ');
}

/** Название новой заметки: с подстановками — заполненное; без них — пустое (впишете сами) */
export const fillTitle = (title: string, vars: TemplateVars) => (hasVars(title) ? fillText(title, vars).replace(/\s+/g, ' ').trim() : '');

/** Название шаблона для списка: без подстановок («Встреча {{дата}}» → «Встреча») */
export const templateName = (title: string) =>
  title
    .replace(VAR_RE, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s·—–:,-]+$/, '')
    .replace(/^[\s·—–:,-]+/, '')
    .trim() || 'Без названия';

/** Абзац целиком из списка: «{{задачи}}» или «{{цели}}» */
function listVar(text: string | undefined): 'tasks' | 'goals' | null {
  const m = /^\{\{\s*([^{}\n]{1,40}?)\s*\}\}$/.exec((text ?? '').trim());
  const v = m ? varOf(m[1]) : null;
  return v?.kind === 'tasks' || v?.kind === 'goals' ? v.kind : null;
}

/**
 * Блоки новой заметки по шаблону: новые id, подстановки в тексте и подписях.
 * Абзац «{{задачи}}» — пунктами списка (по задаче на пункт; нет задач — пустой пункт), «{{цели}}» — пунктами со сроками.
 */
export function fillTemplate(blocks: Block[], vars: TemplateVars): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const list = listVar(b.text);
    if (list) {
      const type = b.type === 'todo' || b.type === 'number' ? b.type : 'bullet';
      const items = list === 'tasks' ? (vars.tasks ?? []).map(asLink) : (vars.goals ?? []).map(goalLine);
      const uniq = [...new Set(items.filter(Boolean))];
      if (uniq.length) for (const t of uniq) out.push(newBlock(type, { text: t }));
      else if (list === 'tasks') out.push(newBlock(type, { text: '' }));
      continue;
    }
    const c: Block = { ...b, id: uid() };
    if (c.text !== undefined) c.text = fillText(c.text, vars);
    if (c.caption) c.caption = fillText(c.caption, vars);
    out.push(c);
  }
  return out.length ? out : [newBlock('p')];
}

// ---------- Готовые шаблоны ----------

export interface TemplatePreset {
  title: string;
  blocks: () => Block[];
}

const h2 = (text: string) => newBlock('h2', { text });
const p = (text = '') => newBlock('p', { text });

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    title: 'Встреча {{дата}}',
    blocks: () => [p('{{время}} · Участники: '), h2('Повестка'), newBlock('bullet'), h2('Решения'), newBlock('bullet'), h2('Следующие шаги'), newBlock('todo')],
  },
  {
    title: 'Книга',
    blocks: () => [p('Автор: '), p('Прочитано: {{дата}}'), h2('Главные мысли'), newBlock('bullet'), h2('Цитаты'), newBlock('quote'), h2('Что применить'), newBlock('todo')],
  },
  {
    title: 'Проект',
    blocks: () => [p('Статус: идея · Начат: {{дата}}'), h2('Зачем'), p(), h2('Шаги'), newBlock('todo'), h2('Материалы'), newBlock('bullet')],
  },
  {
    title: DAILY_TEMPLATE,
    blocks: () => [p('{{день недели}} · прошлая запись: {{вчера}}'), h2('Задачи на день'), p('{{задачи}}'), p('{{цели}}'), h2('Мысли'), p(), h2('Итоги дня'), p()],
  },
];

// ---------- Скелет шаблона: его текст общий у всех заметок по нему — связей по нему нет ----------

export interface Skeleton {
  /** строка шаблона: совпадает с началом блока — это начало убирается; head — заголовок (убирается, только если совпал целиком) */
  lines: { re: RegExp; head: boolean }[];
  /** название, как его составил шаблон («Встреча 16 октября 2026»): такое название в связях не участвует */
  title?: RegExp;
}

/** Чем бывает подстановка в названии: дата — цифрами и словами, время — «14:05» */
function varPattern(raw: string): string {
  const v = varOf(raw);
  if (!v) return esc(`{{${raw}}}`);
  switch (v.kind) {
    case 'date':
      return (v.fmt ?? 'D MMMM YYYY')
        .split(/(YYYY|YY|MMMM|MM|M|dddd|DD|D)/)
        .map((t) => (t === 'YYYY' ? String.raw`\d{4}` : t === 'YY' ? String.raw`\d{2}` : t === 'MMMM' || t === 'dddd' ? String.raw`\p{L}+` : /^(MM|M|DD|D)$/.test(t) ? String.raw`\d{1,2}` : esc(t)))
        .join('');
    case 'time':
      return String.raw`\d{1,2}:\d{2}`;
    case 'weekday':
      return String.raw`\p{L}+`;
    default:
      return '.*?';
  }
}

/** Название по шаблону — как регулярное выражение (целиком), если в нём есть подстановки */
function titlePattern(title: string): RegExp | undefined {
  const t = title.trim();
  if (!hasVars(t)) return undefined;
  let src = '';
  let last = 0;
  for (const m of t.matchAll(VAR_RE)) {
    src += esc(t.slice(last, m.index)) + varPattern(m[1]);
    last = m.index! + m[0].length;
  }
  src += esc(t.slice(last));
  return new RegExp('^' + src.replace(/ +/g, String.raw`\s+`) + '$', 'iu');
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Скелет: строки шаблона без подстановок — как есть, с подстановками — с «чем угодно» на их месте
 * (подстановка в конце строки забирает строку до конца). Строки, где почти нет своего текста, не берутся.
 */
export function templateSkeleton(blocks: Block[], title = ''): Skeleton {
  const lines: Skeleton['lines'] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const t = (b.text ?? '').trim();
    if (!t || listVar(b.text)) continue;
    const staticText = stripInline(t.replace(VAR_RE, ''));
    if ((staticText.match(/[\p{L}\p{N}]/gu) ?? []).length < 3) continue;
    let src = '';
    let last = 0;
    let endsWithVar = false;
    for (const m of t.matchAll(VAR_RE)) {
      src += esc(t.slice(last, m.index)) + '.*?';
      last = m.index! + m[0].length;
    }
    if (last > 0 && last === t.length) endsWithVar = true;
    src += esc(t.slice(last));
    const re = '^' + src.replace(/ +/g, '\\s+') + (endsWithVar ? '.*$' : '(?![\\p{L}\\p{N}])');
    const head = /^h[123]$/.test(b.type);
    if (seen.has(head + re)) continue;
    seen.add(head + re);
    lines.push({ re: new RegExp(re.replace(/\.\*\?\.\*\$$/, '.*$'), 'iu'), head });
  }
  const tp = titlePattern(title);
  return tp ? { lines, title: tp } : { lines };
}

/** Текст блока без скелета шаблона: '' — блок целиком из шаблона. head — блок-заголовок */
export function stripSkeleton(text: string, sk: Skeleton, head = false): string {
  const t = text.trim();
  for (const l of sk.lines) {
    if (l.head !== head) continue;
    const m = l.re.exec(t);
    if (!m) continue;
    const rest = t.slice(m[0].length).replace(/^[\s:·—–,-]+/, '').trim();
    // заголовок шаблона — только целиком: «Решения по бюджету» — уже свой заголовок
    if (head && rest) continue;
    return rest;
  }
  return text;
}
