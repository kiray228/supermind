/**
 * FreeMind / Freeplane (.mm) ⇄ карта.
 * Импорт: текст (в том числе richcontent HTML), заметки, ссылки, свёрнутость, сторона, цвета, жирный/курсив,
 * значки (full-1…7 → приоритет, button_ok → ✅ …) и стрелки-связи (arrowlink).
 * Экспорт — FreeMind 1.0.1: его открывают и FreeMind, и Freeplane.
 */
import type { MindDoc, Relationship, Sheet, Topic, TopicStyle } from '../types';
import { newTopic, uid } from '../utils/tree';
import { DEFAULT_ROOT_TEXT, escAttr, escXml, makeDoc, makeSheet, stripExt } from './common';
import { safeUrl } from '../utils/url';

/** Значки FreeMind → маркеры SuperMind */
const ICONS: Record<string, string> = {
  button_ok: 'task-0',
  button_cancel: 'task-1',
  hourglass: 'task-2',
  help: 'task-3',
  messagebox_warning: 'task-4',
  yes: 'task-5',
  idea: 'symbol-0',
  attach: 'symbol-2',
  calendar: 'symbol-5',
  password: 'symbol-8',
  ksmiletris: 'smile-0',
  'smiley-neutral': 'smile-2',
  'smily_bad': 'smile-3',
  'smiley-angry': 'smile-4',
  male1: 'people-0',
  group: 'people-1',
  'flag': 'flag-red',
  'flag-blue': 'flag-blue',
  'go': 'flag-check',
  bookmark: 'star-0',
  'very_good': 'symbol-10',
  'very_negative': 'symbol-11',
  launch: 'symbol-12',
  up: 'arrow-0',
  down: 'arrow-1',
  back: 'arrow-2',
  forward: 'arrow-3',
};
for (let i = 1; i <= 7; i++) ICONS[`full-${i}`] = `priority-${i}`;
const MARKER_ICON: Record<string, string> = Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [v, k]));

const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName.toLowerCase() === name);
const color = (v: string | null) => (v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined);

/** HTML из richcontent → обычный текст с переносами строк */
function htmlText(el: Element): string {
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) parts.push((n.textContent ?? '').replace(/\s+/g, ' '));
    else if (n.nodeType === 1) {
      const tag = (n as Element).localName.toLowerCase();
      if (tag === 'head' || tag === 'style' || tag === 'script') return;
      if (tag === 'br') parts.push('\n');
      for (const c of Array.from(n.childNodes)) walk(c);
      if (/^(p|div|li|h\d|tr)$/.test(tag)) parts.push('\n');
    }
  };
  walk(el);
  return parts
    .join('')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Ctx {
  /** ID узла FreeMind → id темы */
  ids: Map<string, string>;
  arrows: { from: string; to: string; color?: string }[];
}

function fromNode(el: Element, ctx: Ctx, depth: number): Topic {
  let text = el.getAttribute('TEXT') ?? el.getAttribute('LOCALIZED_TEXT') ?? '';
  let note = '';
  for (const rc of kids(el, 'richcontent')) {
    const type = (rc.getAttribute('TYPE') ?? '').toUpperCase();
    if (type === 'NODE' && !text) text = htmlText(rc);
    else if (type === 'NOTE' || type === 'DETAILS') note = [note, htmlText(rc)].filter(Boolean).join('\n\n');
  }
  const t = newTopic(text.trim());
  if (note) t.note = note;
  const link = el.getAttribute('LINK');
  const safe = link ? safeUrl(link) : null;
  if (safe) t.link = safe;
  if (el.getAttribute('FOLDED') === 'true') t.collapsed = true;
  const pos = el.getAttribute('POSITION');
  if (depth === 1 && (pos === 'left' || pos === 'right')) t.side = pos;

  const st: TopicStyle = {};
  const fg = color(el.getAttribute('COLOR'));
  const bg = color(el.getAttribute('BACKGROUND_COLOR'));
  if (fg) st.textColor = fg;
  if (bg) st.fill = bg;
  const font = kids(el, 'font')[0];
  if (font?.getAttribute('BOLD') === 'true') st.bold = true;
  if (font?.getAttribute('ITALIC') === 'true') st.italic = true;
  const edge = kids(el, 'edge')[0];
  const ec = color(edge?.getAttribute('COLOR') ?? null);
  if (ec) st.lineColor = ec;
  if (Object.keys(st).length) t.style = st;

  const markers: string[] = [];
  for (const ic of kids(el, 'icon')) {
    const m = ICONS[ic.getAttribute('BUILTIN') ?? ''];
    if (!m) continue;
    // в группе приоритета — только один
    if (m.startsWith('priority-') && markers.some((x) => x.startsWith('priority-'))) continue;
    if (!markers.includes(m)) markers.push(m);
  }
  if (markers.length) t.markers = markers;

  const id = el.getAttribute('ID');
  if (id) ctx.ids.set(id, t.id);
  for (const a of kids(el, 'arrowlink')) {
    const to = a.getAttribute('DESTINATION');
    if (to) ctx.arrows.push({ from: t.id, to, color: color(a.getAttribute('COLOR')) });
  }

  t.children = kids(el, 'node').map((c) => fromNode(c, ctx, depth + 1));
  if (!t.children.length) delete t.collapsed;
  return t;
}

/** Файл .mm → документ SuperMind */
export function freemindToDoc(xml: string, filename = ''): MindDoc {
  const dom = new DOMParser().parseFromString(xml.replace(/^﻿/, ''), 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('Не удалось прочитать файл FreeMind: он повреждён');
  const map = dom.documentElement;
  if (map.localName.toLowerCase() !== 'map') throw new Error('Это не карта FreeMind');
  const top = kids(map, 'node')[0];
  if (!top) throw new Error('В карте FreeMind нет тем');
  const ctx: Ctx = { ids: new Map(), arrows: [] };
  const root = fromNode(top, ctx, 0);
  if (!root.text) root.text = stripExt(filename) || DEFAULT_ROOT_TEXT;
  const sheet = makeSheet(root);
  sheet.relationships = ctx.arrows
    .filter((a) => ctx.ids.has(a.to))
    .map((a): Relationship => ({ id: uid(), from: a.from, to: ctx.ids.get(a.to)!, ...(a.color ? { color: a.color } : {}) }));
  const title = root.text === DEFAULT_ROOT_TEXT ? stripExt(filename) || root.text : root.text;
  return makeDoc(title.replace(/\s+/g, ' ').slice(0, 200), [sheet]);
}

// ---------- Экспорт ----------

function toNode(t: Topic, depth: number, pad: string, rels: Map<string, Relationship[]>): string {
  let a = ` ID="ID_${escAttr(t.id)}" TEXT="${escAttr(t.text)}"`;
  if (depth === 1 && t.side) a += ` POSITION="${t.side}"`;
  if (t.collapsed && t.children.length) a += ' FOLDED="true"';
  if (t.link) a += ` LINK="${escAttr(t.link)}"`;
  if (t.style?.textColor) a += ` COLOR="${escAttr(t.style.textColor)}"`;
  if (t.style?.fill) a += ` BACKGROUND_COLOR="${escAttr(t.style.fill)}"`;
  const inner: string[] = [];
  if (t.style?.bold || t.style?.italic) inner.push(`<font NAME="SansSerif" SIZE="12"${t.style.bold ? ' BOLD="true"' : ''}${t.style.italic ? ' ITALIC="true"' : ''}/>`);
  if (t.style?.lineColor) inner.push(`<edge COLOR="${escAttr(t.style.lineColor)}"/>`);
  for (const m of t.markers ?? []) {
    const ic = MARKER_ICON[m];
    if (ic) inner.push(`<icon BUILTIN="${ic}"/>`);
  }
  if (t.task?.status === 'done' && !(t.markers ?? []).includes('task-0')) inner.push('<icon BUILTIN="button_ok"/>');
  for (const r of rels.get(t.id) ?? []) inner.push(`<arrowlink DESTINATION="ID_${escAttr(r.to)}"${r.color ? ` COLOR="${escAttr(r.color)}"` : ''} ENDARROW="Default" STARTARROW="None"/>`);
  if (t.note?.trim()) {
    const html = t.note
      .split(/\n/)
      .map((l) => `<p>${escXml(l)}</p>`)
      .join('');
    inner.push(`<richcontent TYPE="NOTE"><html><head></head><body>${html}</body></html></richcontent>`);
  }
  const children = t.children.map((c) => toNode(c, depth + 1, pad + '  ', rels));
  if (!inner.length && !children.length) return `${pad}<node${a}/>`;
  return `${pad}<node${a}>\n${[...inner.map((x) => pad + '  ' + x), ...children].join('\n')}\n${pad}</node>`;
}

/** Лист → .mm (плавающие темы становятся ветками центральной) */
export function sheetToFreemind(sheet: Sheet): string {
  const rels = new Map<string, Relationship[]>();
  for (const r of sheet.relationships ?? []) rels.set(r.from, [...(rels.get(r.from) ?? []), r]);
  const root: Topic = sheet.floating.length ? { ...sheet.root, children: [...sheet.root.children, ...sheet.floating] } : sheet.root;
  return `<map version="1.0.1">\n<!-- SuperMind -->\n${toNode(root, 0, '', rels)}\n</map>\n`;
}
