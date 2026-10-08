/**
 * Хранилище на IndexedDB (idb-keyval) с учётом изменений для синхронизации:
 * каждая запись запоминает, какой ключ и когда изменён, — синхронизация отправит только их.
 * Значение и отметка «изменено» пишутся одной транзакцией: приложение, закрытое посреди записи,
 * не потеряет правку, а две вкладки не затрут отметки друг друга.
 */
import { clear as idbClear, createStore, del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';

/** Служебные ключи синхронизации — сами не синхронизируются. */
export const DIRTY_KEY = 'sync:dirty';
export const META_KEY = 'sync:meta';

/** Что синхронизируется между устройствами (API-ключ из настроек — никогда; история версий карт — только на устройстве). */
export function isSynced(key: string): boolean {
  if (key.startsWith('sync:') || key.startsWith('hist:')) return false;
  return !['settings', 'calsync', 'welcomed'].includes(key);
}

type Dirty = Record<string, number>;
/** Последние известные отметки этой вкладки (для быстрых проверок без ожидания) */
let dirty: Dirty = {};
const listeners = new Set<() => void>();

/** То же хранилище, что у idb-keyval по умолчанию, — для записи в одной транзакции */
const raw = createStore('keyval-store', 'keyval');

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

/** Транзакция: записать/удалить значения и изменить отметки (читаются свежими — другая вкладка могла их поменять) */
function writeTx(ops: (store: IDBObjectStore) => void, edit: (d: Dirty) => void): Promise<void> {
  return raw('readwrite', (store) => {
    ops(store);
    const r = store.get(DIRTY_KEY);
    r.onsuccess = () => {
      const d = { ...((r.result as Dirty | undefined) ?? {}) };
      edit(d);
      store.put(d, DIRTY_KEY);
      dirty = d;
    };
    return done(store.transaction);
  });
}

const bump = (d: Dirty, key: string, at: number) => {
  d[key] = Math.max(at, (d[key] ?? 0) + 1);
};

/** Отметить ключ изменённым (с отметкой времени для «побеждает свежее»). */
export async function markDirty(key: string, at = Date.now()) {
  if (!isSynced(key)) return;
  await writeTx(() => {}, (d) => bump(d, key, at));
  for (const l of listeners) l();
}

export async function dirtyKeys(): Promise<Dirty> {
  dirty = ((await idbGet<Dirty>(DIRTY_KEY)) ?? {}) as Dirty;
  return { ...dirty };
}

/** Отметка ключа по последним данным этой вкладки (без ожидания базы) */
export const dirtyAt = (key: string): number | undefined => dirty[key];
/** Есть ли неотправленные изменения (по последним данным этой вкладки) */
export const hasDirty = () => Object.keys(dirty).length > 0;

/** Снять отметку, если ключ не менялся после отправки. */
export async function clearDirty(key: string, sentAt: number) {
  await writeTx(
    () => {},
    (d) => {
      if (d[key] === sentAt) delete d[key];
    },
  );
}

export function onDirty(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const get = idbGet;
export const keys = idbKeys;

export async function set(key: string, value: unknown) {
  if (!isSynced(key)) return idbSet(key, value);
  const at = Date.now();
  await writeTx(
    (s) => s.put(value, key),
    (d) => bump(d, key, at),
  );
  for (const l of listeners) l();
}

export async function del(key: string) {
  if (!isSynced(key)) return idbDel(key);
  const at = Date.now();
  await writeTx(
    (s) => s.delete(key),
    (d) => bump(d, key, at),
  );
  for (const l of listeners) l();
}

// ---------- Данные с сервера ----------

/** Сколько раз ключ перезаписывала синхронизация: разделы сверяются, не устарела ли их копия в памяти */
const remote = new Map<string, number>();
export const remoteRev = (key: string) => remote.get(key) ?? 0;
const bumpRemote = (key: string) => remote.set(key, remoteRev(key) + 1);

/** Запись данных, пришедших с сервера: без отметки «изменено». */
export async function setFromSync(key: string, value: unknown) {
  bumpRemote(key);
  await idbSet(key, value);
  bumpRemote(key);
}
export async function delFromSync(key: string) {
  bumpRemote(key);
  await idbDel(key);
  bumpRemote(key);
}

/** Удалить отметки «изменено» у всех ключей (данные другого аккаунта не отправляются) */
export async function clearAllDirty() {
  await writeTx(
    () => {},
    (d) => {
      for (const k of Object.keys(d)) delete d[k];
    },
  );
}

export async function clear() {
  dirty = {};
  await idbClear();
}
