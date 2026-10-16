/**
 * «Второй мозг» — не только заметки: карты, задачи и цели тоже связываются по смыслу.
 * Здесь — как превратить каждую из них в текст для анализа и как отличать их id в общем индексе.
 * Модуль без браузерных зависимостей — тесты гоняют его в Node.
 */
import type { Goal } from '../goals/model';
import type { TaskItem } from '../tasks/model';
import type { MindDoc, Topic } from '../types';
import type { NoteDoc } from './links';
import type { NoteBody } from './model';
import { type Skeleton, stripSkeleton } from './templatesCore';

export type BrainKind = 'note' | 'map' | 'task' | 'goal';

/** id в общем индексе: у заметок — как есть, у остальных — с приставкой («map:…») */
export const itemId = (kind: BrainKind, raw: string) => (kind === 'note' ? raw : `${kind}:${raw}`);

export function parseItemId(id: string): { kind: BrainKind; raw: string } {
  const m = /^(map|task|goal):(.+)$/.exec(id);
  return m ? { kind: m[1] as BrainKind, raw: m[2] } : { kind: 'note', raw: id };
}

export const KIND_LABEL: Record<BrainKind, string> = { note: 'Заметка', map: 'Карта', task: 'Задача', goal: 'Цель' };

/**
 * Заметка: заголовки блоков отдельно (весят больше), код не учитывается.
 * Текст — как написан: разметку уберёт разбор, а [[ссылки]] нужны ему целыми.
 */
/** Заголовки шаблона заметки дня и строка «Четверг · прошлая запись: [[…]]» — общие у всех дней, связей по ним нет */
const DAILY_HEAD = new Set(['задачи на день', 'мысли', 'итоги дня']);
const DAILY_LINE = /^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)( · прошлая запись: \[\[[^\]]*\]\])?$/i;

/** Заголовки шаблона сохранённой статьи и строка «Источник: …» — общие у всех статей */
const ARTICLE_HEAD = new Set(['главные мысли', 'цифры и факты', 'что применить', 'начало статьи']);
const ARTICLE_LINE = /^Источник: \[[^\]]*\]\([^)]*\)$/;

/** Какая заметка: обычная, заметка дня или сохранённая статья (у двух последних — свой шаблон) */
export type NoteKind = 'plain' | 'daily' | 'article';

/**
 * Заметка: заголовки — отдельно (весомее), текст блоков. Заметка дня — без даты в названии; у дня и статьи — без шаблона.
 * sk — скелет своего шаблона, по которому создана заметка: его общий текст тоже не учитывается.
 */
export function noteDoc(body: NoteBody, kind: NoteKind | boolean = 'plain', sk: Skeleton | null = null): NoteDoc {
  const k: NoteKind = kind === true ? 'daily' : kind === false ? 'plain' : kind;
  const daily = k === 'daily';
  const heads = daily ? DAILY_HEAD : k === 'article' ? ARTICLE_HEAD : null;
  const line = daily ? DAILY_LINE : k === 'article' ? ARTICLE_LINE : null;
  const headings: string[] = [];
  const text: string[] = [];
  for (const b of body.blocks) {
    if (b.type === 'code') continue;
    if (heads && line && b.text && ((b.type.startsWith('h') && heads.has(b.text.trim().toLowerCase())) || line.test(b.text.trim()))) continue;
    const head = b.type === 'h1' || b.type === 'h2' || b.type === 'h3';
    const t = b.text && sk ? stripSkeleton(b.text, sk, head) : b.text;
    if (t) (head ? headings : text).push(t);
    if (b.caption) text.push(b.caption);
    if (b.transcript) text.push(b.transcript);
  }
  // название, составленное шаблоном («Встреча 16 октября 2026»), — тоже шаблон
  const title = daily || sk?.title?.test(body.title.trim()) ? '' : body.title;
  return { title, headings, text: text.join('\n') };
}

/** Текст без HTML (темы карт могут быть с оформлением) */
export const plainText = (s: string) => (s.includes('<') ? s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ') : s).replace(/&nbsp;/g, ' ');

/** не больше стольких тем из одной карты */
const MAX_TOPICS = 3000;

/** Карта: название, темы первых двух уровней — как подзаголовки, остальное и заметки к темам — текст */
export function mapDoc(doc: MindDoc): NoteDoc {
  const headings: string[] = [];
  const text: string[] = [];
  let n = 0;
  for (const sheet of doc.sheets ?? []) {
    const stack: [Topic, number][] = [[sheet.root, 0], ...(sheet.floating ?? []).map((t) => [t, 1] as [Topic, number])];
    while (stack.length && n < MAX_TOPICS) {
      const [t, depth] = stack.pop()!;
      n++;
      for (let i = (t.children?.length ?? 0) - 1; i >= 0; i--) stack.push([t.children[i], depth + 1]);
      const s = plainText(t.text ?? '').trim();
      if (s && !(depth === 0 && s === doc.title)) (depth <= 1 ? headings : text).push(s);
      if (t.note) text.push(plainText(t.note));
      if (t.labels?.length) text.push(t.labels.join(', '));
    }
  }
  return { title: doc.title ?? '', headings, text: text.join('\n') };
}

/** Задача: название, описание, пункты чек-листа, метки */
export function taskDoc(t: TaskItem): NoteDoc {
  return { title: t.title ?? '', text: [t.notes ?? '', ...(t.checklist ?? []).map((c) => c.text), (t.tags ?? []).join(' ')].filter(Boolean).join('\n') };
}

/** Цель: название, «зачем», заметки; этапы — как подзаголовки, шаги — текст */
export function goalDoc(g: Goal): NoteDoc {
  const stages = g.stages ?? [];
  return {
    title: g.title ?? '',
    headings: stages.map((s) => s.title).filter(Boolean),
    text: [g.why ?? '', g.notes ?? '', ...stages.flatMap((s) => (s.steps ?? []).map((x) => x.title))].filter(Boolean).join('\n'),
  };
}
