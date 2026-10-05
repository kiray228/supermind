/**
 * Публичный API слоя импорта/экспорта.
 */
import type { Boundary, FloatingTopic, MindDoc, Relationship, Sheet, StructureType, Summary, Topic } from '../types';
import { uid } from '../utils/tree';
import { DEFAULT_ROOT_TEXT, fileExt, makeDoc, makeSheet, stripExt } from './common';
import { markdownToTopic } from './markdown';
import { opmlToTopic } from './opml';
import { importXmind } from './xmind';

export { downloadBlob, downloadText, pickFile, safeFilename, isIOS } from './download';
export { sheetToMarkdown, markdownToTopic, textToTopic, textToTopics } from './markdown';
export { sheetToOpml, opmlToTopic } from './opml';
export { importXmind, exportXmind } from './xmind';
export { exportDocx, exportXlsx, exportPptx, exportCsvTasks } from './office';
export { buildExportSvg, exportSvgBlob, exportPng, exportPdf } from './exportImage';

/** Значение accept для <input type="file"> */
export const IMPORT_ACCEPT =
  '.2mind,.xmind,.md,.markdown,.txt,.opml,.json,text/markdown,text/plain,text/x-opml,application/json';

// ---------------------------------------------------------------------
// Нативный формат .2mind (JSON MindDoc)
// ---------------------------------------------------------------------

export function exportNative(doc: MindDoc): Blob {
  return new Blob([JSON.stringify({ format: '2mind', version: 1, ...doc })], { type: 'application/json' });
}

const STRUCTURES: StructureType[] = ['map', 'logic-right', 'logic-left', 'org', 'tree', 'timeline', 'fishbone', 'brace'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function normTopic(v: unknown, ids: Set<string>): Topic {
  const o = isObj(v) ? v : {};
  let id = str(o.id) || uid();
  if (ids.has(id)) id = uid();
  ids.add(id);
  // переносим все известные поля, неизвестные отбрасываем
  const t: Topic = { ...(o as Partial<Topic>), id, text: str(o.text) ?? '', children: [] };
  t.children = Array.isArray(o.children) ? o.children.map((c) => normTopic(c, ids)) : [];
  if (t.markers && !Array.isArray(t.markers)) delete t.markers;
  if (t.labels && !Array.isArray(t.labels)) delete t.labels;
  if (t.note != null && typeof t.note !== 'string') delete t.note;
  if (t.link != null && typeof t.link !== 'string') delete t.link;
  if (t.image && !(isObj(t.image) && typeof t.image.src === 'string')) delete t.image;
  if (t.task && !(isObj(t.task) && typeof t.task.status === 'string')) delete t.task;
  if (t.style && !isObj(t.style)) delete t.style;
  return t;
}

function normSheet(v: unknown, i: number): Sheet {
  const o = isObj(v) ? v : {};
  const ids = new Set<string>();
  const root = normTopic(o.root, ids);
  if (!root.text.trim()) root.text = DEFAULT_ROOT_TEXT;
  const structure = STRUCTURES.includes(o.structure as StructureType) ? (o.structure as StructureType) : 'map';
  const sheet: Sheet = {
    ...(o as Partial<Sheet>),
    ...makeSheet(root, str(o.title) || `Лист ${i + 1}`, structure),
  };
  sheet.id = str(o.id) || sheet.id;
  sheet.themeId = str(o.themeId) || 'classic';
  sheet.rainbow = typeof o.rainbow === 'boolean' ? o.rainbow : true;
  if (str(o.lineStyle)) sheet.lineStyle = o.lineStyle as Sheet['lineStyle'];
  if (num(o.spacing) != null) sheet.spacing = num(o.spacing);
  if (str(o.background)) sheet.background = str(o.background);
  sheet.floating = Array.isArray(o.floating)
    ? o.floating.map((f): FloatingTopic => {
        const t = normTopic(f, ids);
        const fo = isObj(f) ? f : {};
        return { ...t, x: num(fo.x) ?? 0, y: num(fo.y) ?? 0 };
      })
    : [];
  const okId = (x: unknown) => typeof x === 'string' && ids.has(x);
  sheet.relationships = (Array.isArray(o.relationships) ? o.relationships : [])
    .filter((r): r is Obj => isObj(r) && okId(r.from) && okId(r.to))
    .map((r) => ({ ...(r as Partial<Relationship>), id: str(r.id) || uid() }) as Relationship);
  sheet.boundaries = (Array.isArray(o.boundaries) ? o.boundaries : [])
    .filter((b): b is Obj => isObj(b) && okId(b.topicId))
    .map((b) => ({ ...(b as Partial<Boundary>), id: str(b.id) || uid() }) as Boundary);
  sheet.summaries = (Array.isArray(o.summaries) ? o.summaries : [])
    .filter((b): b is Obj => isObj(b) && okId(b.topicId))
    .map((b) => ({ ...(b as Partial<Summary>), id: str(b.id) || uid(), text: str(b.text) ?? 'Итог' }) as Summary);
  return sheet;
}

/** Проверка и нормализация JSON документа 2Mind. Принимает также отдельный лист или тему. */
export function parseNative(json: string, filename?: string): MindDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(json.replace(/^﻿/, ''));
  } catch {
    throw new Error('Файл повреждён: не удалось разобрать JSON');
  }
  if (!isObj(raw)) throw new Error('Неизвестный формат файла');
  if ('locked' in raw && raw.locked === true) throw new Error('Документ зашифрован — импорт невозможен');
  const fallbackTitle = filename ? stripExt(filename) : 'Импорт';

  if (Array.isArray(raw.sheets)) {
    const sheets = raw.sheets.map(normSheet);
    if (!sheets.length) throw new Error('В документе нет листов');
    const doc = makeDoc(str(raw.title)?.trim() || sheets[0].root.text || fallbackTitle, sheets);
    const active = str(raw.activeSheet);
    if (active && sheets.some((s) => s.id === active)) doc.activeSheet = active;
    const created = num(raw.createdAt);
    if (created) doc.createdAt = created;
    return doc;
  }
  if (isObj(raw.root)) {
    const sheet = normSheet(raw, 0);
    return makeDoc(sheet.root.text || fallbackTitle, [sheet]);
  }
  if (typeof raw.text === 'string' && Array.isArray(raw.children)) {
    const root = normTopic(raw, new Set());
    return makeDoc(root.text || fallbackTitle, [makeSheet(root)]);
  }
  throw new Error('Неизвестный формат файла');
}

// ---------------------------------------------------------------------
// Импорт любого поддерживаемого файла
// ---------------------------------------------------------------------

function docFromTopic(root: Topic, filename: string): MindDoc {
  if (!root.text.trim()) root.text = stripExt(filename) || DEFAULT_ROOT_TEXT;
  const title = root.text === DEFAULT_ROOT_TEXT ? stripExt(filename) || root.text : root.text;
  return makeDoc(title.slice(0, 200), [makeSheet(root)]);
}

export async function importFile(file: File): Promise<MindDoc> {
  let ext = fileExt(file.name);
  if (!ext || !['xmind', 'md', 'markdown', 'txt', 'opml', '2mind', 'json'].includes(ext)) {
    // определяем по содержимому
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4b) ext = 'xmind';
    else {
      const start = (await file.slice(0, 512).text()).replace(/^﻿/, '').trimStart();
      if (start.startsWith('{')) ext = 'json';
      else if (start.startsWith('<') && /<opml[\s>]/i.test(start)) ext = 'opml';
      else ext = 'md';
    }
  }
  switch (ext) {
    case 'xmind':
      return importXmind(await file.arrayBuffer(), file.name);
    case 'opml':
      return docFromTopic(opmlToTopic(await file.text()), file.name);
    case '2mind':
    case 'json':
      return parseNative(await file.text(), file.name);
    default:
      return docFromTopic(markdownToTopic(await file.text()), file.name);
  }
}
