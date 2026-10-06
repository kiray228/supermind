/**
 * Хранилище на IndexedDB (idb-keyval) с учётом изменений для синхронизации:
 * каждая запись запоминает, какой ключ и когда изменён, — синхронизация отправит только их.
 */
import { clear as idbClear, del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';

/** Служебные ключи синхронизации — сами не синхронизируются. */
export const DIRTY_KEY = 'sync:dirty';
export const META_KEY = 'sync:meta';

/** Что синхронизируется между устройствами (API-ключ из настроек — никогда). */
export function isSynced(key: string): boolean {
  if (key.startsWith('sync:')) return false;
  return !['settings', 'calsync', 'welcomed'].includes(key);
}

type Dirty = Record<string, number>;
let dirty: Dirty | null = null;
let dirtyWrite: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

async function loadDirty(): Promise<Dirty> {
  dirty ??= ((await idbGet<Dirty>(DIRTY_KEY)) ?? {}) as Dirty;
  return dirty;
}

/** Отметить ключ изменённым (с отметкой времени для «побеждает свежее»). */
export async function markDirty(key: string, at = Date.now()) {
  if (!isSynced(key)) return;
  const d = await loadDirty();
  d[key] = Math.max(at, (d[key] ?? 0) + 1);
  dirtyWrite = dirtyWrite.then(() => idbSet(DIRTY_KEY, d)).catch(() => {});
  for (const l of listeners) l();
}

export async function dirtyKeys(): Promise<Dirty> {
  return { ...(await loadDirty()) };
}

/** Снять отметку, если ключ не менялся после отправки. */
export async function clearDirty(key: string, sentAt: number) {
  const d = await loadDirty();
  if (d[key] === sentAt) {
    delete d[key];
    dirtyWrite = dirtyWrite.then(() => idbSet(DIRTY_KEY, d)).catch(() => {});
  }
}

export function onDirty(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const get = idbGet;
export const keys = idbKeys;

export async function set(key: string, value: unknown) {
  await idbSet(key, value);
  await markDirty(key);
}

export async function del(key: string) {
  await idbDel(key);
  await markDirty(key);
}

/** Запись данных, пришедших с сервера: без отметки «изменено». */
export const setFromSync = idbSet;
export const delFromSync = idbDel;

export async function clear() {
  dirty = {};
  await idbClear();
}
