import { get, set, del } from 'idb-keyval';
import type { BoardData, DocMeta, LockedDoc, MindDoc, PlannerData, Settings } from '../types';
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
    accent: sheet ? getTheme(sheet.themeId).central.fill : undefined,
    locked: false,
  };
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
export async function savePlanner(p: PlannerData) {
  await set('planner', p);
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
