/**
 * Markdown ⇄ карта. Также разбор обычного текста с отступами (вставка из буфера).
 */
import type { Sheet, TaskStatus, Topic } from '../types';
import { newTopic } from '../utils/tree';
import { DEFAULT_ROOT_TEXT, oneLine } from './common';

// =====================================================================
// Экспорт
// =====================================================================

function labelToken(l: string): string {
  return '#' + l.trim().replace(/\s+/g, '_').replace(/#/g, '');
}

function inlineTopic(t: Topic): string {
  let s = '';
  if (t.task) s += t.task.status === 'done' ? '[x] ' : '[ ] ';
  const text = oneLine(t.text) || (t.link ? '' : '…');
  if (t.link) {
    const label = (text || t.link).replace(/([[\]])/g, '\\$1');
    s += `[${label}](${t.link.replace(/\s/g, '%20').replace(/\)/g, '%29')})`;
  } else s += text;
  if (t.labels?.length) s += ' ' + t.labels.filter((l) => l.trim()).map(labelToken).join(' ');
  return s;
}

function noteLines(note: string | undefined, indent: string): string[] {
  if (!note || !note.trim()) return [];
  return note
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+|\n+$/g, '')
    .split('\n')
    .map((l) => (l.trim() ? `${indent}> ${l.trimEnd()}` : `${indent}>`));
}

function bullets(t: Topic, depth: number, out: string[]) {
  const ind = '  '.repeat(depth);
  out.push(`${ind}- ${inlineTopic(t)}`);
  out.push(...noteLines(t.note, ind + '  '));
  for (const c of t.children) bullets(c, depth + 1, out);
}

function section(t: Topic, out: string[]) {
  out.push('', `## ${inlineTopic(t)}`);
  const n = noteLines(t.note, '');
  if (n.length) out.push('', ...n);
  if (t.children.length) out.push('');
  for (const c of t.children) bullets(c, 0, out);
}

export function sheetToMarkdown(sheet: Sheet): string {
  const out: string[] = [`# ${inlineTopic(sheet.root)}`];
  const n = noteLines(sheet.root.note, '');
  if (n.length) out.push('', ...n);
  for (const c of sheet.root.children) section(c, out);
  // плавающие темы — отдельными разделами в конце
  for (const f of sheet.floating) section(f, out);
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// =====================================================================
// Импорт
// =====================================================================

interface Inline {
  text: string;
  link?: string;
  labels?: string[];
  status?: TaskStatus;
}

const RE_CHECK = /^\[([ xX\-~/])\]\s*/;
const RE_IMG = /!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+["'][^"']*["'])?\s*\)/g;
const RE_LINK = /\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
const RE_AUTOLINK = /<((?:https?|ftp|mailto):[^>\s]+)>/gi;

function stripEmphasis(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|[\s(])\*(?=\S)([^*]*?\S)\*(?=$|[\s).,!?:;])/g, '$1$2')
    .replace(/(^|[\s(])_(?=\S)([^_]*?\S)_(?=$|[\s).,!?:;])/g, '$1$2');
}

function unescapeMd(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1');
}

function parseInline(raw: string): Inline {
  let s = raw.trim();
  const res: Inline = { text: '' };
  const cm = RE_CHECK.exec(s);
  if (cm) {
    const c = cm[1];
    res.status = c === 'x' || c === 'X' ? 'done' : c === ' ' ? 'todo' : 'doing';
    s = s.slice(cm[0].length);
  }
  // метки в конце строки: " #метка"
  const labels: string[] = [];
  for (;;) {
    const m = /\s#([^\s#()[\]]+)\s*$/.exec(s);
    if (!m || /^\d+$/.test(m[1])) break;
    labels.unshift(m[1].replace(/_/g, ' '));
    s = s.slice(0, m.index);
  }
  if (labels.length) res.labels = labels;
  s = s.replace(RE_IMG, (_m, alt: string) => alt);
  s = s.replace(RE_LINK, (_m, text: string, url: string) => {
    if (!res.link) res.link = url;
    return text;
  });
  s = s.replace(RE_AUTOLINK, (_m, url: string) => {
    if (!res.link) res.link = url;
    return url;
  });
  s = unescapeMd(stripEmphasis(s)).replace(/\s+/g, ' ').trim();
  res.text = s || res.link || '';
  return res;
}

function topicFrom(raw: string): Topic {
  const p = parseInline(raw);
  const t = newTopic(p.text);
  if (p.link) t.link = p.link;
  if (p.labels) t.labels = p.labels;
  if (p.status) t.task = { status: p.status };
  return t;
}

type Tok =
  | { k: 'h'; level: number; text: string }
  | { k: 'li'; indent: number; text: string }
  | { k: 'txt'; indent: number; text: string }
  | { k: 'blank' };

function indentWidth(ws: string): number {
  let n = 0;
  for (const ch of ws) n = ch === '\t' ? n + 4 - (n % 4) : n + 1;
  return n;
}

const RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RE_ITEM = /^([ \t]*)(?:[-*+•–]|\d{1,9}[.)])[ \t]+(.*)$/;
const RE_EMPTY_ITEM = /^([ \t]*)(?:[-*+•]|\d{1,9}[.)])[ \t]*$/;
const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_FENCE = /^[ \t]*(```|~~~)/;
const RE_QUOTE = /^([ \t]*)>[ \t]?(.*)$/;

function tokenize(md: string): Tok[] {
  const lines = md.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const toks: Tok[] = [];
  let i = 0;
  // YAML front matter
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (line.trim().startsWith(fence)) fence = null;
      else toks.push({ k: 'txt', indent: 0, text: line });
      continue;
    }
    const fm = RE_FENCE.exec(line);
    if (fm) {
      fence = fm[1];
      continue;
    }
    if (!line.trim()) {
      toks.push({ k: 'blank' });
      continue;
    }
    // Setext-заголовки (Текст\n=== / Текст\n---)
    const prev = toks[toks.length - 1];
    if (prev && prev.k === 'txt' && prev.indent < 4 && /^ {0,3}(=+|-+)[ \t]*$/.test(line)) {
      toks[toks.length - 1] = { k: 'h', level: line.trim()[0] === '=' ? 1 : 2, text: prev.text.trim() };
      continue;
    }
    const h = RE_HEADING.exec(line);
    if (h && (h[2] ?? '').trim()) {
      toks.push({ k: 'h', level: h[1].length, text: h[2] });
      continue;
    }
    if (RE_HR.test(line)) continue;
    if (/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/.test(line) && line.includes('|')) continue;
    const it = RE_ITEM.exec(line);
    if (it) {
      toks.push({ k: 'li', indent: indentWidth(it[1]), text: it[2] });
      continue;
    }
    if (RE_EMPTY_ITEM.test(line)) continue;
    const q = RE_QUOTE.exec(line);
    if (q) {
      toks.push({ k: 'txt', indent: indentWidth(q[1]), text: q[2] });
      continue;
    }
    const ws = /^[ \t]*/.exec(line)![0];
    toks.push({ k: 'txt', indent: indentWidth(ws), text: line.slice(ws.length) });
  }
  return toks;
}

/** Заметки собираются построчно, затем склеиваются */
class Notes {
  private map = new Map<Topic, string[]>();
  add(t: Topic, line: string) {
    let arr = this.map.get(t);
    if (!arr) this.map.set(t, (arr = []));
    arr.push(line);
  }
  blank(t: Topic | null) {
    if (!t) return;
    const arr = this.map.get(t);
    if (arr && arr.length && arr[arr.length - 1] !== '') arr.push('');
  }
  apply() {
    for (const [t, arr] of this.map) {
      const s = arr.join('\n').replace(/^\n+|\n+$/g, '');
      if (s.trim()) t.note = t.note ? `${t.note}\n${s}` : s;
    }
  }
}

/**
 * Разбор Markdown в дерево тем. Заголовки, вложенные списки (-, *, +, 1.) с любыми отступами,
 * чекбоксы → задачи, [текст](url) → ссылка, абзацы/цитаты → заметки предыдущей темы.
 */
export function markdownToTopic(md: string): Topic {
  const toks = tokenize(md);
  const hasStructure = toks.some((t) => t.k === 'h' || t.k === 'li');
  if (!hasStructure) return textToTopic(md);

  const top = newTopic('');
  const fromHeading = new Set<Topic>();
  const notes = new Notes();
  const hStack: { level: number; topic: Topic }[] = [];
  let iStack: { indent: number; topic: Topic }[] = [];
  let last: Topic | null = null;
  /** текст до первой темы */
  const preamble: string[] = [];

  for (const tok of toks) {
    if (tok.k === 'blank') {
      notes.blank(last);
      if (!last && preamble.length && preamble[preamble.length - 1] !== '') preamble.push('');
      continue;
    }
    if (tok.k === 'txt') {
      const line = tok.text.trimEnd();
      if (last) notes.add(last, line);
      else preamble.push(line);
      continue;
    }
    if (tok.k === 'h') {
      while (hStack.length && hStack[hStack.length - 1].level >= tok.level) hStack.pop();
      const parent = hStack.length ? hStack[hStack.length - 1].topic : top;
      const t = topicFrom(tok.text);
      parent.children.push(t);
      fromHeading.add(t);
      hStack.push({ level: tok.level, topic: t });
      iStack = [];
      last = t;
      continue;
    }
    // пункт списка
    const base = hStack.length ? hStack[hStack.length - 1].topic : top;
    while (iStack.length && iStack[iStack.length - 1].indent >= tok.indent) iStack.pop();
    const parent = iStack.length ? iStack[iStack.length - 1].topic : base;
    const t = topicFrom(tok.text);
    parent.children.push(t);
    iStack.push({ indent: tok.indent, topic: t });
    last = t;
  }

  while (preamble.length && !preamble[preamble.length - 1].trim()) preamble.pop();
  notes.apply();

  const kids = top.children;
  let root: Topic;
  if (kids.length && fromHeading.has(kids[0])) {
    // первый заголовок верхнего уровня — центральная тема, прочие верхние — её ветви
    root = kids[0];
    root.children.push(...kids.slice(1));
    if (preamble.length) root.note = [preamble.join('\n'), root.note].filter(Boolean).join('\n\n');
  } else if (kids.length === 1 && !preamble.length) {
    root = kids[0];
  } else if (preamble.length) {
    // первая строка — центральная тема
    const first = preamble.shift()!;
    root = topicFrom(first);
    const rest = preamble.join('\n').replace(/^\n+/, '');
    if (rest.trim()) root.note = rest;
    root.children = kids;
  } else {
    root = newTopic(DEFAULT_ROOT_TEXT, kids);
  }
  if (!root.text.trim()) root.text = DEFAULT_ROOT_TEXT;
  return root;
}

// =====================================================================
// Простой текст с отступами
// =====================================================================

const RE_PLAIN_BULLET = /^(?:[-*+•–·▪◦]|\d{1,9}[.)])[ \t]+/;

/** Список тем верхнего уровня из текста с отступами (табы или пробелы, маркеры списков допустимы) */
export function textToTopics(text: string): Topic[] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const out: Topic[] = [];
  const stack: { indent: number; topic: Topic }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const ws = /^[ \t]*/.exec(line)![0];
    const indent = indentWidth(ws);
    let body = line.slice(ws.length).trim();
    const hm = /^(#{1,6})[ \t]+(.*)$/.exec(body);
    if (hm) body = hm[2];
    body = body.replace(RE_PLAIN_BULLET, '');
    if (!body.trim()) continue;
    const t = topicFrom(body);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].topic.children.push(t);
    else out.push(t);
    stack.push({ indent, topic: t });
  }
  return out;
}

/** Дерево из текста с отступами: одна строка верхнего уровня → корень, иначе «Центральная тема» */
export function textToTopic(text: string): Topic {
  const list = textToTopics(text);
  if (list.length === 1) return list[0];
  return newTopic(DEFAULT_ROOT_TEXT, list);
}
