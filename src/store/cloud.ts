/**
 * Аккаунт и синхронизация между устройствами.
 * Локальные данные остаются главными (приложение работает без интернета); изменённые ключи
 * отправляются на сервер, чужие изменения забираются и аккуратно сливаются (по id и времени изменения).
 */
import { create } from 'zustand';
import { clearDirty, dirtyKeys, get, isSynced, keys, markDirty, onDirty, set, setFromSync, delFromSync, META_KEY } from './kv';

const PROD_API = 'https://br-soft-term-b1xn6yim-supermind.compute.c-5.eu-central-1.aws.neon.tech';
/** В режиме разработки можно подключить локальный сервер: localStorage['sm-api'] = 'http://127.0.0.1:8787' */
function devApi(): string | null {
  try {
    return import.meta.env.DEV ? localStorage.getItem('sm-api') : null;
  } catch {
    return null;
  }
}
export const API = devApi() || PROD_API;
const ACCOUNT_KEY = 'sync:account';

export interface CloudUser {
  id: string;
  email: string;
  name: string;
}
interface Account {
  token: string;
  user: CloudUser;
}
interface SyncMeta {
  cursor: number;
  seqs: Record<string, number>;
  lastSync?: number;
  userId?: string;
}

interface CloudState {
  account: Account | null;
  ready: boolean;
  status: 'idle' | 'syncing' | 'error' | 'offline';
  error?: string;
  lastSync?: number;
}

export const useCloud = create<CloudState>(() => ({ account: null, ready: false, status: 'idle' }));

let account: Account | null = null;
let meta: SyncMeta = { cursor: 0, seqs: {} };

export function authHeader(): Record<string, string> {
  return account ? { Authorization: `Bearer ${account.token}` } : {};
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, { ...init, headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init.headers ?? {}) } });
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером — проверьте интернет');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Ошибка сервера (${res.status})`);
  return data;
}

async function saveMeta() {
  await setFromSync(META_KEY, meta);
}

// ================= Аккаунт =================

/** Загрузить сохранённый вход при запуске */
export async function initCloud() {
  account = ((await get<Account>(ACCOUNT_KEY)) ?? null) as Account | null;
  meta = ((await get<SyncMeta>(META_KEY)) ?? { cursor: 0, seqs: {} }) as SyncMeta;
  useCloud.setState({ account, ready: true, lastSync: meta.lastSync });
  if (!account) return;
  wire();
  syncSoon(800);
}

let wired = false;
/** Синхронизация: при изменениях, при возвращении в приложение, раз в минуту и при появлении сети */
function wire() {
  if (wired) return;
  wired = true;
  onDirty(() => syncSoon(4000));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncSoon(300));
  window.addEventListener('online', () => syncSoon(300));
  setInterval(() => document.visibilityState === 'visible' && syncSoon(0), 60_000);
}

async function startSession(a: Account) {
  // данные устройства сольются с облачными — сначала копия на всякий случай
  await (await import('./safety')).takeSnapshot('login');
  // другой аккаунт, чем в прошлый раз, — начинаем синхронизацию с нуля
  if (meta.userId !== a.user.id) meta = { cursor: 0, seqs: {}, userId: a.user.id };
  account = a;
  await setFromSync(ACCOUNT_KEY, a);
  await saveMeta();
  // всё, что есть на устройстве, — в аккаунт (сольётся с данными других устройств)
  for (const k of await keys()) if (typeof k === 'string' && isSynced(k)) await markDirty(k, 1);
  useCloud.setState({ account: a, error: undefined });
  wire();
  await syncNow();
}

export async function register(name: string, email: string, password: string) {
  const r = await api<Account>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
  await startSession(r);
}

export async function login(email: string, password: string) {
  const r = await api<Account>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  await startSession(r);
}

/** Выйти: данные остаются на устройстве */
export async function logout() {
  await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
  account = null;
  await delFromSync(ACCOUNT_KEY);
  useCloud.setState({ account: null, status: 'idle' });
}

export async function changePassword(oldPassword: string, newPassword: string) {
  await api('/auth/password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) });
}

export async function deleteAccount(password: string) {
  await api('/account', { method: 'DELETE', body: JSON.stringify({ password }) });
  account = null;
  meta = { cursor: 0, seqs: {} };
  await delFromSync(ACCOUNT_KEY);
  await saveMeta();
  useCloud.setState({ account: null, status: 'idle' });
}

// ================= Облачные копии =================

export interface CloudSnapshot {
  id: string;
  at: number;
  reason: string;
  keys: number;
  bytes: number;
}

export async function listCloudSnapshots(): Promise<CloudSnapshot[]> {
  return (await api<{ snapshots: CloudSnapshot[] }>('/snapshots')).snapshots;
}

export async function cloudSnapshotData(id: string): Promise<Record<string, unknown>> {
  return (await api<{ data: Record<string, unknown> }>(`/snapshots/${id}`)).data;
}

/** Копия в облаке прямо сейчас (сначала отправим всё несохранённое) */
export async function makeCloudSnapshot() {
  await syncNow();
  await api('/snapshots', { method: 'POST', body: '{}' });
}

// ================= Синхронизация =================

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;

export function syncSoon(delay = 1500) {
  if (!account) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delay);
}

/** Слушатели изменений, пришедших с других устройств (перезагрузка открытых разделов) */
const reloaders: { match: (key: string) => boolean; run: (keys: string[]) => void | Promise<void> }[] = [];
export function onRemoteChange(match: (key: string) => boolean, run: (keys: string[]) => void | Promise<void>) {
  reloaders.push({ match, run });
}

/** Перед синхронизацией все разделы сохраняют несохранённое */
const flushers: (() => Promise<void> | void)[] = [];
export function onBeforeSync(fn: () => Promise<void> | void) {
  flushers.push(fn);
}

export function syncNow(): Promise<void> {
  if (!account) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    useCloud.setState({ status: 'syncing' });
    try {
      for (const f of flushers) await f();
      const changed = new Set<string>();
      for (let round = 0; round < 4; round++) {
        await pull(changed);
        if (!(await push())) break;
      }
      if (changed.size) await reconcileIndex(changed);
      meta.lastSync = Date.now();
      await saveMeta();
      useCloud.setState({ status: 'idle', error: undefined, lastSync: meta.lastSync });
      if (changed.size) {
        const list = [...changed];
        for (const r of reloaders) {
          const hit = list.filter(r.match);
          if (hit.length) await Promise.resolve(r.run(hit)).catch(() => {});
        }
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        account = null;
        await delFromSync(ACCOUNT_KEY);
        useCloud.setState({ account: null, status: 'error', error: 'Сессия истекла — войдите снова' });
      } else useCloud.setState({ status: err.status === 0 ? 'offline' : 'error', error: err.message });
    } finally {
      running = null;
      if (again) {
        again = false;
        syncSoon(500);
      }
    }
  })();
  return running;
}

interface RemoteItem {
  key: string;
  value: unknown;
  updatedAt: number;
  deleted: boolean;
  seq: number;
}

async function pull(changed: Set<string>) {
  for (let i = 0; i < 1000; i++) {
    const r = await api<{ items: RemoteItem[]; cursor: number; more: boolean }>(`/sync?since=${meta.cursor}`);
    const dirty = await dirtyKeys();
    for (const item of r.items) {
      await applyRemote(item, dirty[item.key], changed);
      meta.seqs[item.key] = item.seq;
    }
    meta.cursor = r.cursor;
    await saveMeta();
    if (!r.more) break;
  }
}

async function applyRemote(item: RemoteItem, dirtyAt: number | undefined, changed: Set<string>) {
  if (!isSynced(item.key)) return;
  if (item.deleted) {
    // удалено на другом устройстве; локальная правка новее — оставляем (вернётся при отправке)
    if (!dirtyAt || item.updatedAt >= dirtyAt) {
      await delFromSync(item.key);
      if (dirtyAt) await clearDirty(item.key, dirtyAt);
      changed.add(item.key);
    }
    return;
  }
  if (!dirtyAt) {
    await setFromSync(item.key, item.value);
    changed.add(item.key);
    return;
  }
  const local = await get(item.key);
  if (local === undefined) {
    // удалили здесь, а там изменили позже — вернуть
    if (item.updatedAt > dirtyAt) {
      await setFromSync(item.key, item.value);
      await clearDirty(item.key, dirtyAt);
      changed.add(item.key);
    }
    return;
  }
  await setFromSync(item.key, mergeValues(item.key, local, item.value));
  changed.add(item.key);
}

/** Отправить изменённое. true — был конфликт (кто-то успел изменить раньше), нужен ещё круг */
async function push(): Promise<boolean> {
  const dirty = Object.entries(await dirtyKeys());
  if (!dirty.length) return false;
  let conflict = false;
  let batch: { key: string; value: unknown; updatedAt: number; deleted: boolean; baseSeq: number; at: number }[] = [];
  let size = 0;
  const send = async () => {
    if (!batch.length) return;
    const r = await api<{ results: { key: string; ok: boolean; seq?: number }[] }>('/sync', {
      method: 'POST',
      body: JSON.stringify({ items: batch.map(({ at, ...x }) => (void at, x)) }),
    });
    for (const res of r.results) {
      const sent = batch.find((b) => b.key === res.key)!;
      if (res.ok && res.seq) {
        meta.seqs[res.key] = res.seq;
        await clearDirty(res.key, sent.at);
      } else conflict = true;
    }
    await saveMeta();
    batch = [];
    size = 0;
  };
  for (const [key, at] of dirty) {
    const value = await get(key);
    const deleted = value === undefined;
    const json = deleted ? '' : JSON.stringify(value);
    if (json.length > 7.5 * 1024 * 1024) continue; // слишком большой (картинки) — только на этом устройстве
    if (size + json.length > 3 * 1024 * 1024 || batch.length >= 40) await send();
    batch.push({ key, value: deleted ? null : value, updatedAt: Math.max(at, 1), deleted, baseSeq: meta.seqs[key] ?? 0, at });
    size += json.length;
  }
  await send();
  return conflict;
}

// ================= Слияние =================

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function mergeValues(key: string, local: unknown, remote: unknown): unknown {
  if (key.startsWith('doc:') || key.startsWith('note:')) {
    // документ целиком: побеждает более свежий
    const lu = isObj(local) ? Number(local.updatedAt) || 0 : 0;
    const ru = isObj(remote) ? Number(remote.updatedAt) || 0 : 0;
    return ru > lu ? remote : local;
  }
  if (key === 'docs:index' && Array.isArray(local) && Array.isArray(remote)) return mergeArray(local, remote, {}, 'doc');
  if (key === 'planner' && isObj(local) && isObj(remote)) {
    const days: Obj = { ...(remote.days as Obj) };
    for (const [d, v] of Object.entries((local.days as Obj) ?? {})) {
      const r = days[d];
      if (!isObj(r) || !isObj(v)) days[d] = v;
      // день с отметкой времени: побеждает свежая версия целиком (снятые отметки не возвращаются)
      else if (r.updatedAt || v.updatedAt) days[d] = (Number(r.updatedAt) || 0) > (Number(v.updatedAt) || 0) ? r : v;
      else days[d] = { ...r, ...v, habits: [...new Set([...((r.habits as string[]) ?? []), ...((v.habits as string[]) ?? [])])] };
    }
    return { ...remote, ...local, days, habits: mergeArray((local.habits as Obj[]) ?? [], (remote.habits as Obj[]) ?? [], {}, 'habit') };
  }
  if (isObj(local) && isObj(remote)) return mergeBlob(local, remote);
  return local;
}

/** Набор сущностей: массивы объектов с id сливаются по id (свежее по updatedAt), удалённое не возвращается */
function mergeBlob(local: Obj, remote: Obj): Obj {
  const gone: Record<string, number> = { ...((remote.gone as Record<string, number>) ?? {}), ...((local.gone as Record<string, number>) ?? {}) };
  const out: Obj = { ...remote, ...local };
  for (const field of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[field];
    const r = remote[field];
    if (Array.isArray(l) || Array.isArray(r)) {
      const la = (Array.isArray(l) ? l : []) as unknown[];
      const ra = (Array.isArray(r) ? r : []) as unknown[];
      const withId = [...la, ...ra].every((x) => isObj(x) && typeof x.id === 'string');
      if (withId) out[field] = mergeArray(la as Obj[], ra as Obj[], gone, field.replace(/s$/, ''));
      else if (field === 'log') out[field] = unionBy(la as Obj[], ra as Obj[], (x) => `${x.taskId}|${x.at}`);
      else out[field] = la.length ? la : ra;
    } else if (isObj(l) && isObj(r) && field !== 'prefs') out[field] = { ...r, ...l };
  }
  // старые отметки об удалении больше не нужны
  const old = Date.now() - 90 * 86400000;
  for (const [k, t] of Object.entries(gone)) if (t < old) delete gone[k];
  out.gone = gone;
  return out;
}

function mergeArray(local: Obj[], remote: Obj[], gone: Record<string, number>, singular: string): Obj[] {
  const isGone = (id: string) => !!(gone[id] || gone[`${singular}:${id}`] || gone[`${singular}s:${id}`]);
  const byId = new Map<string, Obj>();
  for (const x of local) byId.set(x.id as string, x);
  for (const x of remote) {
    const cur = byId.get(x.id as string);
    if (!cur || (Number(x.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) byId.set(x.id as string, x);
  }
  // порядок: как на этом устройстве, новые — в конце
  const order = [...local.map((x) => x.id as string), ...remote.map((x) => x.id as string)];
  return [...new Set(order)].filter((id) => !isGone(id)).map((id) => byId.get(id)!);
}

function unionBy(a: Obj[], b: Obj[], key: (x: Obj) => string): Obj[] {
  const seen = new Set<string>();
  const out: Obj[] = [];
  for (const x of [...a, ...b]) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out.sort((x, y) => (Number(x.at) || 0) - (Number(y.at) || 0));
}

/** Список карт должен совпадать с картами на устройстве (после прихода чужих изменений) */
async function reconcileIndex(changed: Set<string>) {
  if (![...changed].some((k) => k.startsWith('doc:') || k === 'docs:index')) return;
  const index = ((await get<Obj[]>('docs:index')) ?? []) as Obj[];
  const docKeys = new Set((await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith('doc:')));
  const ids = new Set(index.map((m) => m.id as string));
  let next = index.filter((m) => docKeys.has(`doc:${m.id}`));
  for (const k of docKeys) {
    const id = k.slice(4);
    if (ids.has(id)) continue;
    const doc = await get<Obj>(k);
    if (!doc) continue;
    if (doc.locked) next.push({ id, title: 'Защищённая карта', createdAt: Date.now(), updatedAt: Date.now(), locked: true });
    else {
      const { metaFor } = await import('./db');
      next.push(metaFor(doc as never) as unknown as Obj);
    }
  }
  if (next.length !== index.length || next.some((m, i) => m !== index[i])) {
    next = next.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    await set('docs:index', next);
    changed.add('docs:index');
  }
}

