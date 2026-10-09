import { get, set, del } from './kv';
import type { BoardData, DocMeta, DocPreview, LockedDoc, MindDoc, PlannerData, PlannerDay, Settings } from '../types';
import { countTopics } from '../utils/tree';
import { getTheme } from '../themes';

const INDEX = 'docs:index';
const docKey = (id: string) => `doc:${id}`;

export async function listDocs(): Promise<DocMeta[]> {
  return (await get<DocMeta[]>(INDEX)) ?? [];
}

async function saveIndex(list: DocMeta[]) {
  await set(INDEX, list);
}

export async function loadDoc(id: string): Promise<MindDoc | LockedDoc | undefined> {
  return get(docKey(id));
}

export function metaFor(doc: MindDoc, prev?: DocMeta): DocMeta {
  const sheet = doc.sheets[0];
  return {
    ...prev,
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    topicCount: doc.sheets.reduce((n, s) => n + countTopics(s), 0),
    accent: sheet ? accentOf(sheet.themeId) : undefined,
    locked: false,
    preview: sheet ? previewOf(doc) : undefined,
  };
}

const PREVIEW_KIDS = 8;
const cut = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** Миниатюра первого листа: центральная тема и до 8 основных ветвей (стороны — как в раскладке карты) */
export function previewOf(doc: MindDoc): DocPreview {
  const sheet = doc.sheets[0];
  const th = getTheme(sheet.themeId);
  const kids = sheet.root.children;
  const explicitRight = kids.filter((c) => c.side === 'right').length;
  const needRight = Math.max(0, Math.ceil(kids.length / 2) - explicitRight);
  let free = 0;
  const shown = kids.slice(0, PREVIEW_KIDS).map((c, i) => {
    const left = c.side ? c.side === 'left' : free++ >= needRight;
    const color = c.style?.fill || (sheet.rainbow === false ? th.palette[0] : th.palette[i % th.palette.length]);
    return { t: cut(c.text || 'Тема', 22), c: color, ...(left && sheet.structure === 'map' ? { l: 1 as const } : {}), ...(c.children.length ? { d: 1 as const } : {}) };
  });
  return { r: cut(sheet.root.text || doc.title || 'Карта', 28), s: sheet.structure, k: shown, ...(kids.length > PREVIEW_KIDS ? { more: kids.length - PREVIEW_KIDS } : {}) };
}

/** У старых карт миниатюры нет — построить один раз (зашифрованные пропускаются) */
export async function fillPreviews(list: DocMeta[]): Promise<boolean> {
  const missing = list.filter((m) => !m.preview && !m.locked && !m.trashed);
  if (!missing.length) return false;
  const fresh = await listDocs();
  let changed = false;
  for (const m of missing) {
    const d = await loadDoc(m.id);
    if (!d || 'locked' in d) continue;
    const i = fresh.findIndex((x) => x.id === m.id);
    if (i < 0) continue;
    fresh[i] = { ...fresh[i], preview: previewOf(d) };
    changed = true;
  }
  if (changed) await saveIndex(fresh);
  return changed;
}

/** Цвет превью карты: заметный и на светлом, и на тёмном фоне */
function accentOf(themeId: string): string {
  const th = getTheme(themeId);
  const c = th.central.fill;
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return th.palette[0];
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.25 || lum > 0.85 ? th.palette[0] : c;
}

export async function saveDoc(doc: MindDoc) {
  await set(docKey(doc.id), doc);
  const list = await listDocs();
  const i = list.findIndex((m) => m.id === doc.id);
  const meta = metaFor(doc, list[i]);
  if (i >= 0) list[i] = meta;
  else list.unshift(meta);
  await saveIndex(list);
}

export async function saveLocked(locked: LockedDoc, title: string) {
  await set(docKey(locked.id), locked);
  const list = await listDocs();
  const i = list.findIndex((m) => m.id === locked.id);
  if (i >= 0) list[i] = { ...list[i], title, locked: true, updatedAt: locked.updatedAt ?? Date.now() };
  await saveIndex(list);
}

export async function updateMeta(id: string, patch: Partial<DocMeta>) {
  const list = await listDocs();
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch, metaAt: Date.now() };
  await saveIndex(list);
}

export async function deleteDoc(id: string) {
  await del(docKey(id));
  await (await import('./mapHistory')).deleteHistory(id);
  await saveIndex((await listDocs()).filter((m) => m.id !== id));
}

/** Загрузить все незашифрованные документы (для доски задач и ежедневника) */
export async function loadAllDocs(): Promise<MindDoc[]> {
  const list = await listDocs();
  const out: MindDoc[] = [];
  for (const m of list) {
    if (m.locked || m.trashed) continue;
    const d = await loadDoc(m.id);
    if (d && !('locked' in d)) out.push(d);
  }
  return out;
}

// ---------- Ежедневник / доска / настройки ----------

/** Версии дней, которые видел тот, кто сохраняет (по ним видно, что изменено здесь, а что пришло извне) */
let plannerBase: Record<string, string> | null = null;
const daySig = (d: PlannerDay | undefined) => (d ? JSON.stringify({ ...d, updatedAt: 0 }) : '');
const sigs = (p: PlannerData) => Object.fromEntries(Object.entries(p.days ?? {}).map(([k, d]) => [k, daySig(d)]));
/**
 * Каким был каждый выданный объект дня. Общая plannerBase перезаписывается любым чтением
 * (поиск, виджет), а по самому объекту видно, менял ли день именно тот, кто сохраняет:
 * устаревшая копия нетронутого дня не затрёт пришедшее с другого устройства.
 */
const seenDays = new WeakMap<object, { k: string; sig: string }>();
function remember(p: PlannerData) {
  for (const [k, d] of Object.entries(p.days ?? {})) if (d && typeof d === 'object') seenDays.set(d, { k, sig: daySig(d) });
}

export async function loadPlanner(): Promise<PlannerData> {
  const p = (await get<PlannerData>('planner')) ?? { days: {}, habits: [] };
  plannerBase = sigs(p);
  remember(p);
  return p;
}

/**
 * Сохранить ежедневник — трёхсторонним слиянием: изменённые здесь дни (по сравнению с загруженными)
 * записываются с отметкой времени, остальные остаются такими, какими их записала синхронизация.
 * Пустой день не удаляется, а хранится пустым — отсутствие дня никогда не считается удалением.
 * Возвращает то, что записано (вызывающий может обновить свою копию).
 */
export async function savePlanner(p: PlannerData): Promise<PlannerData> {
  const disk = (await get<PlannerData>('planner')) ?? { days: {}, habits: [] };
  const base = plannerBase ?? sigs(disk);
  const now = Date.now();
  const days: PlannerData['days'] = { ...(disk.days ?? {}) };
  for (const [k, d] of Object.entries(p.days ?? {})) {
    const sig = daySig(d);
    const seen = d && typeof d === 'object' ? seenDays.get(d) : undefined;
    const changedHere = seen && seen.k === k ? sig !== seen.sig : sig !== (base[k] ?? '');
    if (changedHere && sig !== daySig(disk.days?.[k])) days[k] = { ...d, updatedAt: now };
  }
  const { mergeValues } = await import('./merge');
  const habits = (mergeValues('planner', { days: {}, habits: p.habits ?? [] }, { days: {}, habits: disk.habits ?? [] }) as PlannerData).habits;
  const out: PlannerData = { ...disk, ...p, days, habits };
  await set('planner', out);
  plannerBase = sigs(out);
  remember(out);
  return out;
}

export const DEFAULT_BOARD: BoardData = {
  columns: [
    { id: 'todo', title: 'К выполнению', status: 'todo', color: '#64748b' },
    { id: 'doing', title: 'В работе', status: 'doing', color: '#f59e0b' },
    { id: 'done', title: 'Готово', status: 'done', color: '#22c55e' },
  ],
  cards: [],
};

type Sig = Record<string, string>;
let boardBase: { columns: Sig; cards: Sig } | null = null;
const itemSig = (x: { updatedAt?: number }) => JSON.stringify({ ...x, updatedAt: 0 });
const boardSigs = (b: BoardData) => ({
  columns: Object.fromEntries(b.columns.map((c) => [c.id, itemSig(c)])),
  cards: Object.fromEntries(b.cards.map((c) => [c.id, itemSig(c)])),
});

export async function loadBoard(): Promise<BoardData> {
  const b = (await get<BoardData>('board')) ?? structuredClone(DEFAULT_BOARD);
  boardBase = boardSigs(b);
  return b;
}

/**
 * Сохранить доску трёхсторонним слиянием (как ежедневник): изменённое и удалённое здесь —
 * записывается, пришедшее с другого устройства — остаётся. Возвращает записанное.
 */
export async function saveBoard(b: BoardData): Promise<BoardData> {
  const disk = (await get<BoardData>('board')) ?? structuredClone(DEFAULT_BOARD);
  const base = boardBase ?? boardSigs(disk);
  const now = Date.now();
  const gone = { ...(disk.gone ?? {}), ...(b.gone ?? {}) };
  function mergeList<T extends { id: string; updatedAt?: number }>(mine: T[], theirs: T[], baseSig: Sig): T[] {
    const theirById = new Map(theirs.map((x) => [x.id, x]));
    const mineIds = new Set(mine.map((x) => x.id));
    const out: T[] = [];
    for (const x of mine) {
      const t = theirById.get(x.id);
      const changedHere = itemSig(x) !== (baseSig[x.id] ?? '');
      if (changedHere) out.push(itemSig(x) === (t ? itemSig(t) : '') && t ? t : { ...x, updatedAt: now });
      else if (t) out.push(t);
      else if (!gone[x.id]) out.push(x); // здесь не меняли, там нет — пусть решит синхронизация
    }
    for (const [id, sig] of Object.entries(baseSig)) {
      // удалено здесь (было при загрузке, а теперь нет) и там не менялось — удаляем
      if (!mineIds.has(id) && theirById.get(id) && itemSig(theirById.get(id)!) === sig) {
        theirById.delete(id);
        gone[id] = now;
      }
    }
    for (const t of theirs) if (!mineIds.has(t.id) && theirById.has(t.id) && !gone[t.id]) out.push(t);
    return out;
  }
  const out: BoardData = {
    columns: mergeList(b.columns, disk.columns ?? [], base.columns),
    cards: mergeList(b.cards, disk.cards ?? [], base.cards),
    gone,
  };
  await set('board', out);
  boardBase = boardSigs(out);
  return out;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'claude-opus-5-5',
  theme: 'system',
  language: 'ru',
};

export async function loadSettings(): Promise<Settings> {
  const s: Settings = { ...DEFAULT_SETTINGS, ...((await get<Settings>('settings')) ?? {}) };
  // цвет по умолчанию стал «Стандарт» (синий Apple): прежний стандартный изумрудный меняем один раз
  if (s.accentV !== 2) {
    if (!s.accent || s.accent === 'emerald') delete s.accent;
    s.accentV = 2;
    await set('settings', s);
  }
  return s;
}
export async function saveSettings(s: Settings) {
  await set('settings', s);
}
