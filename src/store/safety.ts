/**
 * Защита данных от потери: автокопии на устройстве (раз в 3 часа, при обновлении приложения,
 * перед входом в аккаунт и перед восстановлением), запрет браузеру очищать хранилище
 * и восстановление из любой копии — локальной, облачной или файла.
 */
import { createStore, entries, get as sget, set as sset, del as sdel, keys as skeys } from 'idb-keyval';
import { get, set } from './kv';

declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Отдельная база: «Удалить всё» и сбои основной базы копии не трогают */
const store = createStore('supermind-safety', 'snapshots');
/** Автокопия не чаще чем раз в 3 часа; хранятся 8 последних и по одной на день за 14 дней */
const EVERY = 3 * 3600_000;
const KEEP_RECENT = 8;
const KEEP_DAYS = 14;

export type SnapshotReason = 'auto' | 'update' | 'login' | 'restore' | 'manual';
export const REASON_LABEL: Record<SnapshotReason, string> = {
  auto: 'Автоматическая',
  update: 'Перед обновлением',
  login: 'Перед входом в аккаунт',
  restore: 'Перед восстановлением',
  manual: 'Вручную',
};

export interface SnapshotInfo {
  id: string;
  at: number;
  reason: SnapshotReason;
  version: string;
  keys: number;
  bytes: number;
  /** коротко, что внутри: «12 карт · 40 задач» */
  summary: string;
}
interface Snapshot extends SnapshotInfo {
  data: Record<string, unknown>;
}

/** Что попадает в копию: всё, кроме настроек (там API-ключ) и служебного */
const inBackup = (k: string) => k !== 'settings' && !k.startsWith('sync:');

/** Всё содержимое базы — одним чтением (getAll), а не по ключу: на телефоне в разы быстрее */
export async function collectData(): Promise<Record<string, unknown>> {
  const all: Record<string, unknown> = {};
  for (const [k, v] of await entries()) if (typeof k === 'string' && inBackup(k)) all[k] = v;
  return all;
}

const count = (v: unknown, field: string, alive = (x: Record<string, unknown>) => !x.deleted) => {
  const arr = v && typeof v === 'object' ? (v as Record<string, unknown>)[field] : undefined;
  return Array.isArray(arr) ? arr.filter((x) => x && typeof x === 'object' && alive(x as Record<string, unknown>)).length : 0;
};

export function summarize(data: Record<string, unknown>): string {
  const maps = Array.isArray(data['docs:index']) ? (data['docs:index'] as unknown[]).length : 0;
  const tasks = count(data.tasks, 'tasks', (t) => !t.deleted && !t.trashedAt);
  const notes = Object.keys(data).filter((k) => k.startsWith('note:')).length;
  const parts = [`${maps} ${plural(maps, 'карта', 'карты', 'карт')}`, `${tasks} ${plural(tasks, 'задача', 'задачи', 'задач')}`];
  if (notes) parts.push(`${notes} ${plural(notes, 'заметка', 'заметки', 'заметок')}`);
  return parts.join(' · ');
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Сделать копию всего, что есть на устройстве. Пустое не копируем. */
export async function takeSnapshot(reason: SnapshotReason): Promise<SnapshotInfo | null> {
  try {
    if (await lowOnSpace()) {
      await prune(3);
      if (reason === 'auto') return null;
    }
    const data = await collectData();
    const n = Object.keys(data).length;
    if (!n) return null;
    const bytes = JSON.stringify(data).length;
    const at = Date.now();
    const snap: Snapshot = { id: `${at}`, at, reason, version: APP_VERSION, keys: n, bytes, summary: summarize(data), data };
    await sset(snap.id, snap, store);
    const { data: _data, ...info } = snap;
    void _data;
    await saveIndex([info, ...(await listSnapshots())]);
    await prune();
    return snap;
  } catch {
    return null; // нет места и т. п. — приложение работает дальше
  }
}

/**
 * Свежие — все (до 8); старше — первая и последняя копии каждого дня (первая — ещё «до» беды,
 * если что-то сломалось днём) и все сделанные перед входом/восстановлением/вручную; старше 14 дней — прочь.
 */
async function prune(keepRecent = KEEP_RECENT) {
  const list = await listSnapshots(); // новые первыми
  const old = Date.now() - KEEP_DAYS * 86400000;
  const firstOfDay = new Map<string, string>();
  const lastOfDay = new Map<string, string>();
  for (const s of list) {
    const day = new Date(s.at).toDateString();
    if (!lastOfDay.has(day)) lastOfDay.set(day, s.id);
    firstOfDay.set(day, s.id);
  }
  const kept: SnapshotInfo[] = [];
  for (const [i, s] of list.entries()) {
    const day = new Date(s.at).toDateString();
    const keep =
      i < keepRecent ||
      (s.at > old && keepRecent === KEEP_RECENT && (firstOfDay.get(day) === s.id || lastOfDay.get(day) === s.id || s.reason !== 'auto'));
    if (keep) kept.push(s);
    else await sdel(s.id, store);
  }
  if (kept.length !== list.length) await saveIndex(kept);
}

/** Места почти нет — копий меньше (основные данные важнее) */
async function lowOnSpace(): Promise<boolean> {
  try {
    const e = await navigator.storage?.estimate?.();
    return !!(e?.quota && e.usage && e.usage > e.quota * 0.6);
  } catch {
    return false;
  }
}

/** Список копий хранится отдельно — чтобы не читать сами копии (они бывают большими) */
const INDEX = 'meta-index';
let cache: SnapshotInfo[] | null = null;
async function saveIndex(list: SnapshotInfo[]) {
  cache = [...new Map(list.map((x) => [x.id, x])).values()].sort((a, b) => b.at - a.at);
  await sset(INDEX, cache, store);
}

export async function listSnapshots(): Promise<SnapshotInfo[]> {
  if (cache) return [...cache];
  const saved = await sget<SnapshotInfo[]>(INDEX, store);
  if (saved) return [...(cache = saved)];
  // копии версии 1.7 — без списка: собрать один раз
  const ids = (await skeys(store)).filter((k): k is string => typeof k === 'string' && /^\d+$/.test(k));
  const out: SnapshotInfo[] = [];
  for (const id of ids) {
    const s = await sget<Snapshot>(id, store);
    if (s) out.push({ id: s.id, at: s.at, reason: s.reason, version: s.version, keys: s.keys, bytes: s.bytes, summary: s.summary });
  }
  await saveIndex(out);
  return [...cache!];
}

export async function snapshotData(id: string): Promise<Record<string, unknown> | null> {
  return (await sget<Snapshot>(id, store))?.data ?? null;
}

const LAST_VERSION = 'last-version';

/** При запуске: копия раз в 3 часа и при смене версии приложения; просим браузер не очищать данные */
export async function startupSafety() {
  void requestPersistence();
  try {
    const last = await sget<string>(LAST_VERSION, store);
    const list = await listSnapshots();
    if (last && last !== APP_VERSION) await takeSnapshot('update');
    else if (!list.some((s) => s.at > Date.now() - EVERY)) await takeSnapshot('auto');
    if (last !== APP_VERSION) await sset(LAST_VERSION, APP_VERSION, store);
  } catch {
    /* копия не получилась — не мешаем запуску */
  }
  // приложение открыто долго — копия при сворачивании, если прошло 3 часа
  if (!wired) {
    wired = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      void listSnapshots().then((l) => (l.some((s) => s.at > Date.now() - EVERY) ? null : takeSnapshot('auto')));
    });
  }
}
let wired = false;

/** Защищено ли хранилище от автоматической очистки браузером (Safari чистит сайты через 7 дней без входа) */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean | null> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}

// ================= Восстановление =================

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const withId = (a: unknown[]): a is Obj[] => a.every((x) => isObj(x) && typeof x.id === 'string');

/**
 * Наложить копию на текущие данные: всё, что есть в копии, возвращается в том виде (и считается
 * свежим — победит при синхронизации), а созданное позже копии — остаётся.
 */
function overlay(cur: unknown, snap: unknown, now: number): unknown {
  if (!isObj(snap)) return snap;
  if (!isObj(cur)) return touchAll(snap, now);
  const out: Obj = { ...cur, ...snap };
  const restoredIds = new Set<string>();
  for (const [field, sv] of Object.entries(snap)) {
    const cv = cur[field];
    if (Array.isArray(sv) && withId(sv) && Array.isArray(cv) && withId(cv)) {
      const ids = new Set(sv.map((x) => x.id as string));
      sv.forEach((x) => restoredIds.add(x.id as string));
      out[field] = [...sv.map((x) => touch(x, now)), ...cv.filter((x) => !ids.has(x.id as string))];
    } else if (Array.isArray(sv) && withId(sv)) {
      sv.forEach((x) => restoredIds.add(x.id as string));
      out[field] = sv.map((x) => touch(x, now));
    } else if (field === 'days' && isObj(sv)) {
      // дни ежедневника из копии — со свежей отметкой, иначе синхронизация вернула бы новые
      const days: Obj = { ...(isObj(cv) ? cv : {}) };
      for (const [k, d] of Object.entries(sv)) days[k] = isObj(d) ? { ...d, updatedAt: now } : d;
      out[field] = days;
    }
  }
  // отметки об удалении восстановленного снимаем — иначе синхронизация снова удалит
  if (isObj(cur.gone)) {
    const gone: Obj = {};
    for (const [k, t] of Object.entries(cur.gone)) {
      const id = k.includes(':') ? k.slice(k.indexOf(':') + 1) : k;
      if (!restoredIds.has(id) && !restoredIds.has(k)) gone[k] = t;
    }
    out.gone = gone;
  }
  return out;
}

const touch = (x: Obj, now: number): Obj => ('updatedAt' in x ? { ...x, updatedAt: now } : x);
function touchAll(v: Obj, now: number): Obj {
  const out: Obj = { ...v };
  for (const [f, a] of Object.entries(v)) if (Array.isArray(a) && withId(a)) out[f] = a.map((x) => touch(x, now));
  if (isObj(out.gone)) out.gone = {};
  return out;
}

/** Вернуть данные из копии. Перед этим — копия текущего состояния (можно передумать). */
export async function restoreData(data: Record<string, unknown>): Promise<{ maps: number }> {
  // несохранённое в разделах — сначала в базу: иначе отложенная запись потом затрёт восстановленное
  await Promise.all([
    import('./docStore').then((m) => m.flushSave()),
    import('../tasks/store').then((m) => m.flushTasks()),
    import('../finance/store').then((m) => m.flushFinance()),
    import('../goals/store').then((m) => m.flushGoals()),
    import('../notes/store').then((m) => m.flushNotes()),
  ]).catch(() => {});
  await takeSnapshot('restore');
  const now = Date.now();
  for (const [k, v] of Object.entries(data)) {
    if (!inBackup(k) || k === 'docs:index' || k === 'welcomed') continue;
    if (v === undefined || v === null) continue;
    if (k.startsWith('doc:') || k.startsWith('note:')) {
      // документ целиком; свежая отметка — чтобы при синхронизации победила копия
      await set(k, isObj(v) ? { ...v, updatedAt: now } : v);
    } else await set(k, overlay(await get(k), v, now));
  }
  const cur = ((await get('docs:index')) ?? []) as Obj[];
  // свежая отметка и у записей списка: иначе при слиянии победила бы более поздняя (например, «в корзине»)
  const incoming = (Array.isArray(data['docs:index']) ? data['docs:index'] : []).filter(isObj).map((m): Obj => ({ ...m, metaAt: now }));
  const merged = [...incoming, ...cur.filter((c) => !incoming.some((i) => i.id === c.id))];
  await set('docs:index', merged);
  await reloadAll();
  return { maps: incoming.length };
}

/** Перечитать открытые разделы после восстановления */
export async function reloadAll() {
  const { useApp } = await import('./appStore');
  useApp.setState({ docsVersion: Date.now() });
  await Promise.all([
    import('../tasks/store').then((m) => m.reloadTasks()),
    import('../finance/store').then((m) => m.reloadFinance()),
    import('../goals/store').then((m) => m.reloadGoals()),
    import('../notes/store').then((m) => m.reloadNotes()),
  ]).catch(() => {});
  window.dispatchEvent(new Event('sm-planner-changed'));
  window.dispatchEvent(new Event('sm-board-changed'));
}
