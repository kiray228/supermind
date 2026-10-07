import { get, set, del } from './kv';
import type { BoardData, DocMeta, LockedDoc, MindDoc, PlannerData, PlannerDay, Settings } from '../types';
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
  };
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
  if (i >= 0) list[i] = { ...list[i], title, locked: true, updatedAt: Date.now() };
  await saveIndex(list);
}

export async function updateMeta(id: string, patch: Partial<DocMeta>) {
  const list = await listDocs();
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch };
  await saveIndex(list);
}

export async function deleteDoc(id: string) {
  await del(docKey(id));
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

export async function loadPlanner(): Promise<PlannerData> {
  return (await get<PlannerData>('planner')) ?? { days: {}, habits: [] };
}
/**
 * Сохранить ежедневник. Изменённые дни получают отметку времени — при синхронизации побеждает
 * более свежая версия дня (иначе снятая отметка привычки вернулась бы с другого устройства).
 * Удалённый день остаётся пустой записью с отметкой — по той же причине.
 */
export async function savePlanner(p: PlannerData) {
  const old = (await get<PlannerData>('planner'))?.days ?? {};
  const now = Date.now();
  const days: PlannerData['days'] = {};
  const strip = (d: PlannerDay | undefined) => (d ? JSON.stringify({ ...d, updatedAt: 0 }) : '');
  for (const [k, d] of Object.entries(p.days ?? {})) days[k] = strip(d) === strip(old[k]) ? (old[k]?.updatedAt ? { ...d, updatedAt: old[k].updatedAt } : d) : { ...d, updatedAt: now };
  for (const [k, d] of Object.entries(old)) {
    if (days[k]) continue;
    const had = !!(d.journal || d.mood || d.tasks?.length || d.habits?.length || (d.habitCounts && Object.keys(d.habitCounts).length));
    if (had) days[k] = { journal: '', tasks: [], updatedAt: now };
    else if (d.updatedAt && d.updatedAt > now - 90 * 86400000) days[k] = { journal: '', tasks: [], updatedAt: d.updatedAt };
  }
  await set('planner', { ...p, days });
}

export const DEFAULT_BOARD: BoardData = {
  columns: [
    { id: 'todo', title: 'К выполнению', status: 'todo', color: '#64748b' },
    { id: 'doing', title: 'В работе', status: 'doing', color: '#f59e0b' },
    { id: 'done', title: 'Готово', status: 'done', color: '#22c55e' },
  ],
  cards: [],
};

export async function loadBoard(): Promise<BoardData> {
  return (await get<BoardData>('board')) ?? structuredClone(DEFAULT_BOARD);
}
export async function saveBoard(b: BoardData) {
  await set('board', b);
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'claude-opus-5-5',
  theme: 'system',
  language: 'ru',
};

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await get<Settings>('settings')) ?? {}) };
}
export async function saveSettings(s: Settings) {
  await set('settings', s);
}
