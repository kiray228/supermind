/**
 * Аккаунт и синхронизация между устройствами.
 * Локальные данные остаются главными (приложение работает без интернета); изменённые ключи
 * отправляются на сервер, чужие изменения забираются и аккуратно сливаются (по id и времени изменения).
 */
import { create } from 'zustand';
import { isObj, mergeValues } from './merge';
import { mark } from '../perf';
import { clearAllDirty, dirtyAt, clearDirty, dirtyKeys, get, hasDirty, isSynced, keys, markDirty, onDirty, set, setFromSync, delFromSync, META_KEY } from './kv';

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
  /** ключи, которые не помещаются в облако (байты) — хранятся только на этом устройстве */
  localOnly?: Record<string, number>;
  lastSync?: number;
  userId?: string;
}

interface CloudState {
  account: Account | null;
  ready: boolean;
  status: 'idle' | 'syncing' | 'error' | 'offline';
  /** сколько объектов слишком велики для облака */
  localOnly?: number;
  error?: string;
  lastSync?: number;
}

export const useCloud = create<CloudState>(() => ({ account: null, ready: false, status: 'idle' }));

let account: Account | null = null;
let meta: SyncMeta = { cursor: 0, seqs: {} };

/** Ключи, которые не помещаются в облако: их отметка «изменено» не снимается — в счёт неотправленного не идут */
export const isLocalOnly = (key: string) => !!meta.localOnly && key in meta.localOnly;

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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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

/**
 * Синхронизация не начнётся, пока не готово это обещание (копия данных при запуске):
 * экран приложения открывается сразу, а данные меняются синхронизацией только после копии.
 */
let syncGate: Promise<unknown> = Promise.resolve();

/**
 * Загрузить сохранённый вход при запуске. Приложение готово сразу после чтения аккаунта;
 * before — что должно закончиться до первой синхронизации (копия данных на устройстве).
 */
export async function initCloud(before?: Promise<unknown>) {
  if (before) syncGate = before.catch(() => {});
  account = ((await get<Account>(ACCOUNT_KEY)) ?? null) as Account | null;
  meta = ((await get<SyncMeta>(META_KEY)) ?? { cursor: 0, seqs: {} }) as SyncMeta;
  useCloud.setState({ account, ready: true, lastSync: meta.lastSync, localOnly: Object.keys(meta.localOnly ?? {}).length });
  mark('cloud-ready');
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
  // уход из приложения (iPhone сразу усыпляет страницу) — отправить правки сейчас, а не через 4 с:
  // иначе на другом устройстве их не будет, пока это приложение снова не откроют
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncSoon(300);
    else
      void (async () => {
        for (const f of flushers) await f();
        if (hasDirty()) await syncNow();
      })().catch(() => {});
  });
  window.addEventListener('online', () => syncSoon(300));
  setInterval(() => document.visibilityState === 'visible' && syncSoon(0), 60_000);
}

async function startSession(a: Account) {
  const safety = await import('./safety');
  // данные устройства сольются с облачными — сначала копия на всякий случай
  await safety.takeSnapshot('login');
  // на устройстве данные, с которыми входили в другой аккаунт (например, телефон общий) — спросить
  let foreign = !!meta.userId && meta.userId !== a.user.id;
  if (foreign) {
    const { confirmDialog } = await import('../ui/dialogs');
    const move = await confirmDialog(
      'Данные другого аккаунта',
      `На этом устройстве карты и записи, с которыми входили в другой аккаунт. Добавить их в аккаунт ${a.user.email}? Если нет — они уберутся с устройства, но останутся в автокопии «Перед входом в аккаунт».`,
      { okText: 'Добавить', cancelText: 'Не добавлять' },
    );
    foreign = !move;
  }
  if (foreign) {
    // на устройстве данные другого аккаунта: в этот аккаунт они не попадут (они в автокопии «Перед входом»)
    for (const f of flushers) await f();
    await clearAllDirty();
    for (const k of await keys()) if (typeof k === 'string' && isSynced(k)) await delFromSync(k);
    await safety.reloadAll();
  }
  if (meta.userId !== a.user.id) meta = { cursor: 0, seqs: {}, userId: a.user.id };
  account = a;
  await setFromSync(ACCOUNT_KEY, a);
  await saveMeta();
  // всё, что есть на устройстве, — в аккаунт (сольётся с данными других устройств)
  if (!foreign) for (const k of await keys()) if (typeof k === 'string' && isSynced(k)) await markDirty(k, 1);
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

/** Восстановление пароля: код на почту */
export async function requestReset(email: string) {
  await api('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
}

/** Код из письма + новый пароль → сразу вход */
export async function resetPassword(email: string, code: string, password: string) {
  const r = await api<Account>('/auth/reset', { method: 'POST', body: JSON.stringify({ email, code, password }) });
  await startSession(r);
}

/** Выйти: данные остаются на устройстве */
export async function logout() {
  // сначала отправить несохранённое — иначе оно останется только на этом устройстве
  await syncNow().catch(() => {});
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
    const changed = new Set<string>();
    try {
      // копия данных при запуске ещё делается — синхронизация её дождётся
      await syncGate;
      for (const f of flushers) await f();
      for (let round = 0; round < 4; round++) {
        await pull(changed);
        if (!(await push())) break;
      }
      meta.lastSync = Date.now();
      await saveMeta();
      useCloud.setState({ status: 'idle', error: undefined, lastSync: meta.lastSync });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        account = null;
        await delFromSync(ACCOUNT_KEY);
        useCloud.setState({ account: null, status: 'error', error: 'Сессия истекла — войдите снова' });
      } else useCloud.setState({ status: err.status === 0 ? 'offline' : 'error', error: err.message });
    } finally {
      // полученное применяем, даже если отправка не удалась: иначе разделы остались бы со старыми данными
      if (changed.size) {
        await reconcileIndex(changed).catch(() => {});
        const list = [...changed];
        for (const r of reloaders) {
          const hit = list.filter(r.match);
          if (hit.length) await Promise.resolve(r.run(hit)).catch(() => {});
        }
      }
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
    await dirtyKeys(); // свежие отметки (в том числе других вкладок)
    for (const item of r.items) {
      // своё же отправленное («эхо») — уже здесь
      if (meta.seqs[item.key] !== item.seq) await applyRemote(item, changed);
      meta.seqs[item.key] = item.seq;
    }
    meta.cursor = r.cursor;
    await saveMeta();
    if (!r.more) break;
  }
}

async function applyRemote(item: RemoteItem, changed: Set<string>) {
  if (!isSynced(item.key)) return;
  // отметка читается прямо перед записью: правка, сделанная пока шла загрузка, не потеряется
  let at = dirtyAt(item.key);
  if (item.deleted) {
    // удалено на другом устройстве; локальная правка новее — оставляем (вернётся при отправке)
    if (!at || item.updatedAt >= at) {
      await delFromSync(item.key);
      if (at) await clearDirty(item.key, at);
      changed.add(item.key);
    }
    return;
  }
  if (!at) {
    await setFromSync(item.key, item.value);
    changed.add(item.key);
    return;
  }
  for (let i = 0; i < 5; i++) {
    const local = await get(item.key);
    if (dirtyAt(item.key) !== at) {
      at = dirtyAt(item.key); // пока читали — новая правка; читаем заново
      continue;
    }
    if (local === undefined) {
      // удалили здесь, а там изменили позже — вернуть
      if (item.updatedAt > at!) {
        await setFromSync(item.key, item.value);
        await clearDirty(item.key, at!);
        changed.add(item.key);
      }
      return;
    }
    const merged = mergeValues(item.key, local, item.value);
    // слитое пишем сразу после проверки отметки (копия конфликта — потом): правка в промежутке не затрётся
    await setFromSync(item.key, merged);
    changed.add(item.key);
    if (item.key.startsWith('doc:')) await keepConflictCopy(local, item.value, merged, changed);
    return;
  }
}

/**
 * Карту изменили и здесь, и на другом устройстве: побеждает более свежая версия,
 * а проигравшая сохраняется отдельной картой «(версия с …)» — ничья работа не пропадает.
 */
async function keepConflictCopy(local: unknown, remote: unknown, winner: unknown, changed: Set<string>) {
  const loser = winner === local ? remote : local;
  if (!isObj(loser) || 'locked' in loser || !Array.isArray(loser.sheets)) return;
  const strip = (d: unknown) => (isObj(d) ? JSON.stringify({ ...d, updatedAt: 0 }) : '');
  if (strip(loser) === strip(winner)) return;
  const { uid } = await import('../utils/tree');
  const id = uid();
  const copy = { ...loser, id, title: `${String(loser.title || 'Карта')} (${loser === local ? 'версия с этого устройства' : 'версия с другого устройства'})`, updatedAt: Date.now() };
  await set(`doc:${id}`, copy);
  changed.add(`doc:${id}`);
}

/** Отправить изменённое. true — был конфликт (кто-то успел изменить раньше), нужен ещё круг */
async function push(): Promise<boolean> {
  const dirty = Object.entries(await dirtyKeys());
  if (!dirty.length) return false;
  let conflict = false;
  type Item = { key: string; value: unknown; updatedAt: number; deleted: boolean; baseSeq: number; at: number; bytes: number };
  let batch: Item[] = [];
  let size = 0;
  const post = async (items: Item[]) => {
    const r = await api<{ results: { key: string; ok: boolean; seq?: number }[] }>('/sync', {
      method: 'POST',
      body: JSON.stringify({ items: items.map(({ key, value, updatedAt, deleted, baseSeq }) => ({ key, value, updatedAt, deleted, baseSeq })) }),
    });
    for (const res of r.results) {
      const sent = items.find((b) => b.key === res.key)!;
      if (res.ok && res.seq) {
        meta.seqs[res.key] = res.seq;
        if (meta.localOnly) delete meta.localOnly[res.key];
        await clearDirty(res.key, sent.at);
      } else conflict = true;
    }
  };
  const send = async () => {
    if (!batch.length) return;
    const items = batch;
    batch = [];
    size = 0;
    try {
      await post(items);
    } catch (e) {
      if ((e as ApiError).status !== 413) throw e;
      // слишком большой запрос — по одному; не помещающееся — только на этом устройстве
      for (const it of items) {
        try {
          await post([it]);
        } catch (e2) {
          if ((e2 as ApiError).status !== 413) throw e2;
          (meta.localOnly ??= {})[it.key] = it.bytes;
        }
      }
    }
    await saveMeta();
  };
  const enc = new TextEncoder();
  for (const [key, at] of dirty) {
    const value = await get(key);
    const deleted = value === undefined;
    const json = deleted ? '' : JSON.stringify(value);
    // размер в байтах (кириллица — 2 байта на букву)
    const bytes = json.length > 200_000 ? enc.encode(json).length : json.length * 2;
    if (bytes > 7.5 * 1024 * 1024) {
      (meta.localOnly ??= {})[key] = bytes; // слишком большой (картинки) — только на этом устройстве
      continue;
    }
    if (size + bytes > 3 * 1024 * 1024 || batch.length >= 40) await send();
    batch.push({ key, value: deleted ? null : value, updatedAt: Math.max(at, 1), deleted, baseSeq: meta.seqs[key] ?? 0, at, bytes });
    size += bytes;
  }
  await send();
  useCloud.setState({ localOnly: Object.keys(meta.localOnly ?? {}).length });
  return conflict;
}

type Obj = Record<string, unknown>;

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
    if (doc.locked) next.push({ id, title: 'Защищённая карта', createdAt: Number(doc.updatedAt) || 0, updatedAt: Number(doc.updatedAt) || 0, locked: true });
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

