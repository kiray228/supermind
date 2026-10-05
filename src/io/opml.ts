/**
 * OPML 2.0 ⇄ карта.
 */
import type { Sheet, Topic } from '../types';
import { newTopic } from '../utils/tree';
import { DEFAULT_ROOT_TEXT, escAttr, escXml, oneLine } from './common';

function outline(t: Topic, depth: number): string {
  const pad = '  '.repeat(depth + 2);
  let attrs = ` text="${escAttr(oneLine(t.text))}"`;
  if (t.note?.trim()) attrs += ` _note="${escAttr(t.note)}"`;
  if (t.link) attrs += ` type="link" url="${escAttr(t.link)}"`;
  if (t.task) attrs += ` _status="${t.task.status === 'done' ? 'checked' : 'unchecked'}"`;
  if (t.labels?.length) attrs += ` category="${escAttr(t.labels.join(','))}"`;
  if (!t.children.length) return `${pad}<outline${attrs}/>`;
  return `${pad}<outline${attrs}>\n${t.children.map((c) => outline(c, depth + 1)).join('\n')}\n${pad}</outline>`;
}

export function sheetToOpml(sheet: Sheet, title: string): string {
  const roots = [sheet.root, ...sheet.floating];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<opml version="2.0">\n' +
    '  <head>\n' +
    `    <title>${escXml(title || oneLine(sheet.root.text))}</title>\n` +
    `    <dateCreated>${escXml(new Date().toUTCString())}</dateCreated>\n` +
    '  </head>\n' +
    '  <body>\n' +
    roots.map((r) => outline(r, 0)).join('\n') +
    '\n  </body>\n' +
    '</opml>\n'
  );
}

function childEls(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName.toLowerCase() === name);
}

function fromOutline(el: Element): Topic {
  const text = el.getAttribute('text') ?? el.getAttribute('title') ?? '';
  const t = newTopic(text.replace(/<[^>]+>/g, '').trim());
  const note = el.getAttribute('_note');
  if (note && note.trim()) t.note = note.replace(/\r\n?/g, '\n');
  const link = el.getAttribute('url') || el.getAttribute('htmlUrl') || el.getAttribute('xmlUrl');
  if (link) t.link = link;
  const st = el.getAttribute('_status');
  if (st === 'checked') t.task = { status: 'done' };
  else if (st === 'unchecked' || st === 'indeterminate') t.task = { status: st === 'indeterminate' ? 'doing' : 'todo' };
  const cat = el.getAttribute('category');
  if (cat) {
    const labels = cat
      .split(',')
      .map((s) => s.trim().replace(/^\//, ''))
      .filter(Boolean);
    if (labels.length) t.labels = labels;
  }
  if (el.getAttribute('_collapsed') === 'true') t.collapsed = true;
  t.children = childEls(el, 'outline').map(fromOutline);
  if (!t.children.length) delete t.collapsed;
  return t;
}

export function opmlToTopic(xml: string): Topic {
  const dom = new DOMParser().parseFromString(xml.replace(/^﻿/, ''), 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('Не удалось прочитать OPML: файл повреждён');
  const opml = dom.documentElement;
  const body = childEls(opml, 'body')[0];
  if (!body) throw new Error('В OPML нет раздела body');
  const tops = childEls(body, 'outline').map(fromOutline);
  const head = childEls(opml, 'head')[0];
  const title = head ? childEls(head, 'title')[0]?.textContent?.trim() : '';
  if (tops.length === 1) return tops[0];
  return newTopic(title || DEFAULT_ROOT_TEXT, tops);
}
