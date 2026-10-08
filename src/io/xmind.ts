/**
 * Импорт/экспорт .xmind (Xmind Zen/2020+ content.json и XMind 8 content.xml).
 */
import type {
  Boundary, FloatingTopic, MindDoc, Relationship, Sheet, StructureType, Summary, Topic, TopicImage, TopicStyle,
} from '../types';
import { uid } from '../utils/tree';
import { DEFAULT_ROOT_TEXT, compact, loadZip, makeDoc, makeSheet, newZip, stripDirs, stripExt } from './common';
import type { Zip } from './common';

// ---------------------------------------------------------------------
// Промежуточный формат (≈ Zen JSON)
// ---------------------------------------------------------------------

interface XRange {
  id?: string;
  range?: string;
  title?: string;
  topicId?: string;
}

interface XTopic {
  id?: string;
  title?: string;
  structureClass?: string;
  branch?: string;
  href?: string;
  children?: { attached?: XTopic[]; detached?: XTopic[]; summary?: XTopic[] };
  notes?: { plain?: { content?: string }; realHTML?: { content?: string } };
  markers?: { markerId?: string }[];
  labels?: string[];
  image?: { src?: string; width?: number; height?: number };
  boundaries?: XRange[];
  summaries?: XRange[];
  position?: { x?: number; y?: number };
  style?: { id?: string; properties?: Record<string, string> };
}

interface XSheet {
  id?: string;
  title?: string;
  rootTopic?: XTopic;
  relationships?: { id?: string; end1Id?: string; end2Id?: string; title?: string; style?: { properties?: Record<string, string> } }[];
}

// ---------------------------------------------------------------------
// Маркеры
// ---------------------------------------------------------------------

const TASK_PERCENT: Record<string, number> = {
  start: 0, oct: 12.5, quarter: 25, '3oct': 37.5, half: 50, '5oct': 62.5, '3quar': 75, '7oct': 87.5, done: 100,
};

const IMPORT_MARKERS: Record<string, string> = {
  'task-pause': 'task-2',
  'flag-blue': 'flag-blue',
  'flag-green': 'flag-check',
  'smiley-laugh': 'smile-0',
  'smiley-smile': 'smile-1',
  'smiley-surprise': 'smile-2',
  'smiley-cry': 'smile-3',
  'smiley-angry': 'smile-4',
  'smiley-boring': 'smile-5',
  'symbol-right': 'task-0',
  'symbol-wrong': 'task-1',
  'symbol-question': 'task-3',
  'symbol-exclam': 'task-4',
  'arrow-up': 'arrow-0',
  'arrow-down': 'arrow-1',
  'arrow-left': 'arrow-2',
  'arrow-right': 'arrow-3',
  'arrow-refresh': 'arrow-5',
};

export function mapXmindMarker(id: string): string | null {
  if (!id) return null;
  if (IMPORT_MARKERS[id]) return IMPORT_MARKERS[id];
  let m = /^priority-([1-9])$/.exec(id);
  if (m) return `priority-${m[1]}`;
  m = /^task-(.+)$/.exec(id);
  if (m && m[1] in TASK_PERCENT) return `progress-${Math.round(TASK_PERCENT[m[1]] / 25)}`;
  if (id.startsWith('flag-')) return 'flag-red';
  if (id.startsWith('star-')) return 'star-0';
  if (id.startsWith('smiley-')) return 'smile-0';
  if (id.startsWith('people-')) return 'people-0';
  return null;
}

const EXPORT_MARKERS: Record<string, string> = {
  'progress-0': 'task-start',
  'progress-1': 'task-quarter',
  'progress-2': 'task-half',
  'progress-3': 'task-3quar',
  'progress-4': 'task-done',
  'flag-red': 'flag-red',
  'flag-blue': 'flag-blue',
  'flag-check': 'flag-green',
  'star-0': 'star-yellow',
  'star-1': 'star-orange',
  'star-2': 'star-red',
  'star-3': 'star-blue',
  'smile-0': 'smiley-laugh',
  'smile-1': 'smiley-smile',
  'smile-2': 'smiley-surprise',
  'smile-3': 'smiley-cry',
  'smile-4': 'smiley-angry',
  'smile-5': 'smiley-boring',
  'smile-6': 'smiley-laugh',
  'smile-7': 'smiley-smile',
  'task-0': 'symbol-right',
  'task-1': 'symbol-wrong',
  'task-2': 'task-pause',
  'task-3': 'symbol-question',
  'task-4': 'symbol-exclam',
  'arrow-0': 'arrow-up',
  'arrow-1': 'arrow-down',
  'arrow-2': 'arrow-left',
  'arrow-3': 'arrow-right',
  'arrow-5': 'arrow-refresh',
};

function toXmindMarker(id: string): string | null {
  if (/^priority-[1-9]$/.test(id)) return id;
  if (EXPORT_MARKERS[id]) return EXPORT_MARKERS[id];
  if (id.startsWith('people-')) return 'people-blue';
  return null;
}

// ---------------------------------------------------------------------
// Структуры
// ---------------------------------------------------------------------

export function mapStructureClass(cls: string | undefined): StructureType {
  const c = (cls ?? '').toLowerCase();
  if (!c) return 'map';
  if (c.includes('logic.left')) return 'logic-left';
  if (c.includes('logic')) return 'logic-right';
  if (c.includes('org-chart') || c.includes('orgchart')) return 'org';
  if (c.includes('tree')) return 'tree';
  if (c.includes('timeline')) return 'timeline';
  if (c.includes('fishbone')) return 'fishbone';
  if (c.includes('brace')) return 'brace';
  return 'map';
}

const STRUCTURE_CLASS: Record<StructureType, string> = {
  map: 'org.xmind.ui.map.unbalanced',
  'logic-right': 'org.xmind.ui.logic.right',
  'logic-left': 'org.xmind.ui.logic.left',
  org: 'org.xmind.ui.org-chart.down',
  tree: 'org.xmind.ui.tree.right',
  timeline: 'org.xmind.ui.timeline.horizontal',
  fishbone: 'org.xmind.ui.fishbone.leftHeaded',
  brace: 'org.xmind.ui.brace.right',
};

// ---------------------------------------------------------------------
// Изображения
// ---------------------------------------------------------------------

const IMG_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp',
};

const MAX_IMG = 400;

async function imageSize(bytes: Uint8Array, mime: string): Promise<{ w: number; h: number }> {
  const def = { w: 200, h: 150 };
  if (typeof createImageBitmap !== 'function' || mime === 'image/svg+xml') return def;
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const r = { w: bmp.width, h: bmp.height };
    bmp.close?.();
    return r.w && r.h ? r : def;
  } catch {
    return def;
  }
}

function fitSize(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, MAX_IMG / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

async function loadImage(zip: Zip, src: string | undefined, width?: number, height?: number): Promise<TopicImage | undefined> {
  if (!src) return undefined;
  if (src.startsWith('data:')) {
    const s = width && height ? fitSize(width, height) : { w: 200, h: 150 };
    return { src, ...s };
  }
  const path = decodeURIComponent(src.replace(/^xap:/, '').replace(/^\/+/, ''));
  const f = zip.file(path);
  if (!f) return undefined;
  const bytes = await f.async('uint8array');
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mime = IMG_MIME[ext] ?? 'image/png';
  const size = width && height ? { w: width, h: height } : await imageSize(bytes, mime);
  return { src: `data:${mime};base64,${bytesToBase64(bytes)}`, ...fitSize(size.w, size.h) };
}

// ---------------------------------------------------------------------
// XTopic → Topic
// ---------------------------------------------------------------------

interface Ctx {
  zip: Zip;
  idMap: Map<string, string>;
  boundaries: Boundary[];
  summaries: Summary[];
}

function parseRange(r: string | undefined): [number, number] | 'master' | null {
  if (!r) return null;
  if (r === 'master') return 'master';
  const m = /\(\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(r);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a <= b ? [a, b] : [b, a];
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mapStyle(p: Record<string, string> | undefined): TopicStyle | undefined {
  if (!p) return undefined;
  const st: TopicStyle = {};
  const color = (v: string | undefined) => (v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined);
  st.fill = color(p['svg:fill']);
  st.textColor = color(p['fo:color']);
  st.borderColor = color(p['border-line-color']);
  st.lineColor = color(p['line-color']);
  if (p['fo:font-weight'] === 'bold' || Number(p['fo:font-weight']) >= 600) st.bold = true;
  if (p['fo:font-style'] === 'italic') st.italic = true;
  if (p['fo:text-decoration']?.includes('line-through')) st.strike = true;
  compact(st);
  return Object.keys(st).length ? st : undefined;
}

async function convertTopic(x: XTopic, ctx: Ctx): Promise<Topic> {
  const id = uid();
  if (x.id) ctx.idMap.set(x.id, id);
  const t: Topic = { id, text: x.title ?? '', children: [] };

  const plain = x.notes?.plain?.content ?? (x.notes?.realHTML?.content ? htmlToText(x.notes.realHTML.content) : '');
  if (plain && plain.trim()) t.note = plain.replace(/\r\n?/g, '\n');
  if (x.href && !/^(xmind:|xap:)/i.test(x.href)) t.link = x.href;

  const markers: string[] = [];
  const groups = new Set<string>();
  for (const m of x.markers ?? []) {
    const mapped = mapXmindMarker(m.markerId ?? '');
    if (!mapped) continue;
    const g = mapped.replace(/-[^-]+$/, '');
    if (groups.has(g) && g !== 'symbol' && g !== 'people') continue;
    groups.add(g);
    markers.push(mapped);
  }
  if (markers.length) t.markers = markers;
  const labels = (x.labels ?? []).map((l) => String(l).trim()).filter(Boolean);
  if (labels.length) t.labels = labels;
  if (x.image?.src) {
    const img = await loadImage(ctx.zip, x.image.src, x.image.width, x.image.height);
    if (img) t.image = img;
  }
  const style = mapStyle(x.style?.properties);
  if (style) t.style = style;

  const attached = x.children?.attached ?? [];
  for (const c of attached) t.children.push(await convertTopic(c, ctx));
  if (x.branch === 'folded' && t.children.length) t.collapsed = true;

  // Границы: диапазон детей → тема(ы)
  const n = t.children.length;
  const targets = (r: [number, number] | 'master'): Topic[] => {
    if (r === 'master') return [t];
    const [a, b] = [Math.max(0, r[0]), Math.min(n - 1, r[1])];
    if (a > b) return [];
    if (a === b) return [t.children[a]];
    if (a === 0 && b === n - 1) return [t];
    return t.children.slice(a, b + 1);
  };
  for (const b of x.boundaries ?? []) {
    const r = parseRange(b.range);
    if (!r) continue;
    for (const tt of targets(r)) {
      ctx.boundaries.push(compact({ id: uid(), topicId: tt.id, label: b.title?.trim() || undefined }));
    }
  }
  // Итоги: тексты берутся из children.summary
  const sumTopics = new Map<string, string>();
  for (const st of x.children?.summary ?? []) if (st.id) sumTopics.set(st.id, st.title ?? '');
  for (const s of x.summaries ?? []) {
    const r = parseRange(s.range);
    if (!r) continue;
    let target: Topic;
    if (r === 'master') target = t;
    else {
      const a = Math.max(0, r[0]);
      const b = Math.min(n - 1, r[1]);
      if (a > b) continue;
      target = a === b ? t.children[a] : t;
    }
    const text = (s.topicId && sumTopics.get(s.topicId)) || 'Итог';
    ctx.summaries.push({ id: uid(), topicId: target.id, text });
  }
  return t;
}

async function convertSheet(xs: XSheet, index: number, zip: Zip): Promise<Sheet> {
  const ctx: Ctx = { zip, idMap: new Map(), boundaries: [], summaries: [] };
  const xr = xs.rootTopic ?? { title: DEFAULT_ROOT_TEXT };
  const root = await convertTopic(xr, ctx);
  if (!root.text.trim()) root.text = DEFAULT_ROOT_TEXT;
  const sheet = makeSheet(root, xs.title?.trim() || `Лист ${index + 1}`, mapStructureClass(xr.structureClass));

  const detached = xr.children?.detached ?? [];
  for (let i = 0; i < detached.length; i++) {
    const d = detached[i];
    const t = await convertTopic(d, ctx);
    let x: number;
    let y: number;
    if (typeof d.position?.x === 'number' && typeof d.position?.y === 'number') {
      x = d.position.x;
      y = d.position.y;
    } else {
      const a = (i / Math.max(1, detached.length)) * Math.PI * 2 - Math.PI / 4;
      x = Math.round(Math.cos(a) * 450);
      y = Math.round(Math.sin(a) * 300);
    }
    const f: FloatingTopic = { ...t, x, y };
    sheet.floating.push(f);
  }

  for (const r of xs.relationships ?? []) {
    const from = r.end1Id && ctx.idMap.get(r.end1Id);
    const to = r.end2Id && ctx.idMap.get(r.end2Id);
    if (!from || !to || from === to) continue;
    const rel: Relationship = { id: uid(), from, to, label: r.title ?? '' };
    const color = r.style?.properties?.['line-color'];
    if (color && /^#[0-9a-f]{3,8}$/i.test(color)) rel.color = color;
    const pattern = r.style?.properties?.['line-pattern'];
    // у нас связь по умолчанию пунктирная — сплошную нужно отметить явно
    if (pattern === 'solid') rel.dashed = false;
    else if (pattern) rel.dashed = true;
    sheet.relationships.push(rel);
  }
  sheet.boundaries = ctx.boundaries;
  sheet.summaries = ctx.summaries;
  return sheet;
}

// ---------------------------------------------------------------------
// XMind 8 (content.xml) → XSheet[]
// ---------------------------------------------------------------------

function kids(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === name);
}
function kid(el: Element, name: string): Element | undefined {
  return kids(el, name)[0];
}
/** Значение атрибута по локальному имени (игнорируя префиксы xlink:, svg:, xhtml:) */
function attr(el: Element, local: string): string | undefined {
  for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value;
  return undefined;
}

function legacyTopic(el: Element): XTopic {
  const x: XTopic = {
    id: attr(el, 'id'),
    title: kid(el, 'title')?.textContent ?? '',
    structureClass: attr(el, 'structure-class'),
    branch: attr(el, 'branch'),
    href: attr(el, 'href'),
  };
  const notes = kid(el, 'notes');
  const plain = notes && kid(notes, 'plain');
  if (plain) x.notes = { plain: { content: plain.textContent ?? '' } };
  const mr = kid(el, 'marker-refs');
  if (mr) x.markers = kids(mr, 'marker-ref').map((m) => ({ markerId: attr(m, 'marker-id') }));
  const labels = kid(el, 'labels');
  if (labels) x.labels = kids(labels, 'label').map((l) => l.textContent ?? '');
  const img = kid(el, 'img');
  if (img) {
    const w = Number(attr(img, 'width'));
    const h = Number(attr(img, 'height'));
    x.image = { src: attr(img, 'src'), width: w || undefined, height: h || undefined };
  }
  const pos = kid(el, 'position');
  if (pos) x.position = { x: Number(attr(pos, 'x')) || 0, y: Number(attr(pos, 'y')) || 0 };
  const ch = kid(el, 'children');
  if (ch) {
    x.children = {};
    for (const ts of kids(ch, 'topics')) {
      const type = attr(ts, 'type') as 'attached' | 'detached' | 'summary' | undefined;
      if (type !== 'attached' && type !== 'detached' && type !== 'summary') continue;
      (x.children[type] ??= []).push(...kids(ts, 'topic').map(legacyTopic));
    }
  }
  const bs = kid(el, 'boundaries');
  if (bs) x.boundaries = kids(bs, 'boundary').map((b) => ({ range: attr(b, 'range'), title: kid(b, 'title')?.textContent ?? undefined }));
  const ss = kid(el, 'summaries');
  if (ss) x.summaries = kids(ss, 'summary').map((s) => ({ range: attr(s, 'range'), topicId: attr(s, 'topic-id') }));
  return x;
}

function parseLegacy(xml: string): XSheet[] {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('Файл XMind повреждён (content.xml)');
  return kids(dom.documentElement, 'sheet').map((s) => {
    const rels = kid(s, 'relationships');
    const topic = kid(s, 'topic');
    return {
      id: attr(s, 'id'),
      title: kid(s, 'title')?.textContent ?? '',
      rootTopic: topic ? legacyTopic(topic) : undefined,
      relationships: rels
        ? kids(rels, 'relationship').map((r) => ({
            end1Id: attr(r, 'end1'),
            end2Id: attr(r, 'end2'),
            title: kid(r, 'title')?.textContent ?? '',
          }))
        : [],
    };
  });
}

// ---------------------------------------------------------------------
// Импорт
// ---------------------------------------------------------------------

export async function importXmind(data: ArrayBuffer, filename?: string): Promise<MindDoc> {
  const JSZip = await loadZip();
  let zip: Zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('Не удалось открыть файл .xmind: это не zip-архив');
  }
  let sheetsX: XSheet[] | null = null;
  const json = zip.file('content.json');
  if (json) {
    try {
      const parsed: unknown = JSON.parse(await json.async('string'));
      if (Array.isArray(parsed)) sheetsX = parsed as XSheet[];
      else if (parsed && typeof parsed === 'object' && 'rootTopic' in parsed) sheetsX = [parsed as XSheet];
    } catch {
      sheetsX = null;
    }
  }
  if (!sheetsX) {
    const xml = zip.file('content.xml');
    if (!xml) throw new Error('В файле .xmind не найдено содержимое карты');
    sheetsX = parseLegacy(await xml.async('string'));
  }
  sheetsX = sheetsX.filter((s) => s && typeof s === 'object');
  if (!sheetsX.length) throw new Error('В файле .xmind нет листов');

  const sheets: Sheet[] = [];
  for (let i = 0; i < sheetsX.length; i++) sheets.push(await convertSheet(sheetsX[i], i, zip));
  const title = sheets[0].root.text.trim() || (filename ? stripExt(filename) : '') || 'Импорт из Xmind';
  return makeDoc(title, sheets);
}

// ---------------------------------------------------------------------
// Экспорт
// ---------------------------------------------------------------------

interface ExportCtx {
  zip: Zip;
  manifest: Record<string, object>;
}

function parseDataUrl(src: string): { mime: string; base64: boolean; data: string } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  return { mime: m[1] || 'application/octet-stream', base64: !!m[3], data: m[4] };
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
};

function styleProps(s: TopicStyle | undefined): XTopic['style'] {
  if (!s) return undefined;
  const p: Record<string, string> = {};
  if (s.fill) p['svg:fill'] = s.fill;
  if (s.textColor) p['fo:color'] = s.textColor;
  if (s.borderColor) p['border-line-color'] = s.borderColor;
  if (s.lineColor) p['line-color'] = s.lineColor;
  if (s.bold) p['fo:font-weight'] = 'bold';
  if (s.italic) p['fo:font-style'] = 'italic';
  if (s.strike) p['fo:text-decoration'] = 'line-through';
  return Object.keys(p).length ? { id: uid(), properties: p } : undefined;
}

function exportTopic(t: Topic, sheet: Sheet, ctx: ExportCtx, isRootLike: boolean): Record<string, unknown> {
  const x: Record<string, unknown> = { id: t.id, class: 'topic', title: t.text ?? '' };
  if (t.note?.trim()) {
    const html = t.note
      .split('\n')
      .map((l) => `<div>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '<br>'}</div>`)
      .join('');
    x.notes = { plain: { content: t.note }, realHTML: { content: html } };
  }
  if (t.link) x.href = t.link;

  const markers: string[] = [];
  for (const m of t.markers ?? []) {
    const xm = toXmindMarker(m);
    if (xm && !markers.includes(xm)) markers.push(xm);
  }
  if (t.task) {
    const p = t.task.priority;
    if (p && !markers.some((m) => m.startsWith('priority-'))) markers.push(`priority-${p}`);
    if (!markers.some((m) => /^task-(start|oct|quarter|3oct|half|5oct|3quar|7oct|done)$/.test(m))) {
      if (t.task.status === 'done') markers.push('task-done');
      else if (typeof t.task.progress === 'number') {
        const k = Math.round(t.task.progress / 25);
        markers.push(['task-start', 'task-quarter', 'task-half', 'task-3quar', 'task-done'][Math.max(0, Math.min(4, k))]);
      } else if (t.task.status === 'doing') markers.push('task-half');
      else markers.push('task-start');
    }
  }
  if (markers.length) x.markers = markers.map((markerId) => ({ markerId }));
  if (t.labels?.length) x.labels = [...t.labels];
  if (t.collapsed && t.children.length) x.branch = 'folded';

  if (t.image?.src) {
    const d = parseDataUrl(t.image.src);
    if (d) {
      const name = `resources/${uid()}.${EXT_BY_MIME[d.mime] ?? 'png'}`;
      if (d.base64) ctx.zip.file(name, d.data, { base64: true });
      else ctx.zip.file(name, decodeURIComponent(d.data));
      ctx.manifest[name] = {};
      x.image = { src: `xap:${name}`, width: Math.round(t.image.w), height: Math.round(t.image.h) };
    }
  }
  const st = styleProps(t.style);
  if (st) x.style = st;

  const attached = t.children.map((c) => exportTopic(c, sheet, ctx, false));
  const children: Record<string, unknown[]> = {};
  if (attached.length) children.attached = attached;

  // Границы и итоги, относящиеся к детям этой темы (диапазоны в Xmind задаются у родителя)
  const boundaries: XRange[] = [];
  const summaries: XRange[] = [];
  const summaryTopics: Record<string, unknown>[] = [];
  t.children.forEach((c, i) => {
    for (const b of sheet.boundaries) {
      if (b.topicId === c.id) boundaries.push(compact({ id: b.id, range: `(${i},${i})`, title: b.label || undefined }));
    }
    for (const s of sheet.summaries) {
      if (s.topicId !== c.id) continue;
      const sid = uid();
      summaries.push({ id: s.id, range: `(${i},${i})`, topicId: sid });
      summaryTopics.push({ id: sid, class: 'topic', title: s.text || 'Итог' });
    }
  });
  if (isRootLike) {
    for (const b of sheet.boundaries) {
      if (b.topicId === t.id) boundaries.push(compact({ id: b.id, range: 'master', title: b.label || undefined }));
    }
    // итог для корня — по всем его детям
    const n = t.children.length;
    for (const s of sheet.summaries) {
      if (s.topicId !== t.id || !n) continue;
      const sid = uid();
      summaries.push({ id: s.id, range: `(0,${n - 1})`, topicId: sid });
      summaryTopics.push({ id: sid, class: 'topic', title: s.text || 'Итог' });
    }
  }
  if (summaryTopics.length) children.summary = summaryTopics;
  if (Object.keys(children).length) x.children = children;
  if (boundaries.length) x.boundaries = boundaries;
  if (summaries.length) x.summaries = summaries;
  return x;
}

export async function exportXmind(doc: MindDoc): Promise<Blob> {
  const zip = await newZip();
  const ctx: ExportCtx = { zip, manifest: {} };
  const content = doc.sheets.map((sheet) => {
    const root = exportTopic(sheet.root, sheet, ctx, true);
    root.structureClass = STRUCTURE_CLASS[sheet.structure] ?? STRUCTURE_CLASS.map;
    if (sheet.floating.length) {
      const ch = (root.children ?? {}) as Record<string, unknown[]>;
      ch.detached = sheet.floating.map((f) => {
        const x = exportTopic(f, sheet, ctx, true);
        x.position = { x: Math.round(f.x), y: Math.round(f.y) };
        return x;
      });
      root.children = ch;
    }
    const s: Record<string, unknown> = {
      id: sheet.id,
      class: 'sheet',
      title: sheet.title || 'Лист',
      rootTopic: root,
    };
    if (sheet.relationships.length) {
      s.relationships = sheet.relationships.map((r) => {
        const rel: Record<string, unknown> = { id: r.id, class: 'relationship', end1Id: r.from, end2Id: r.to, title: r.label ?? '' };
        const props: Record<string, string> = {};
        if (r.color) props['line-color'] = r.color;
        // у нас связь пунктирная, если явно не сделана сплошной
        props['line-pattern'] = r.dashed === false ? 'solid' : 'dash';
        if (Object.keys(props).length) rel.style = { id: uid(), properties: props };
        return rel;
      });
    }
    return s;
  });

  zip.file('content.json', JSON.stringify(content));
  zip.file('metadata.json', JSON.stringify({ creator: { name: 'SuperMind', version: '1.0' } }));
  zip.file(
    'manifest.json',
    JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {}, ...ctx.manifest } }),
  );
  return stripDirs(zip).generateAsync({ type: 'blob', mimeType: 'application/vnd.xmind.workbook', compression: 'DEFLATE' });
}
