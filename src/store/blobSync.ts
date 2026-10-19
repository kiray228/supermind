/**
 * Раздел, который держит свои данные в памяти (задачи, финансы, цели, заметки…), и синхронизация.
 * Правило: копия в памяти никогда не перетирает то, что пришло с другого устройства, —
 * перед записью она сливается с сохранённым, а при получении чужих данных несохранённые правки
 * сначала записываются (со слиянием) и только потом раздел перечитывается.
 */
import { get, remoteRev, set } from './kv';
import { isObj, mergeValues, type Obj } from './merge';

const sigOf = (x: Obj) => JSON.stringify({ ...x, updatedAt: 0 });
const isIdList = (v: unknown): v is Obj[] => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'string');

/**
 * Изменённая сущность: её вложенные списки с id (шаги, этапы, платежи, пункты чек-листа) тоже получают
 * отметки — изменённым и новым пунктам время, удалённым — gone['item:id']. Так слияние двух устройств
 * не теряет отметку шага, сделанную на одном, из-за правки названия на другом.
 */
function stampNested(next: Obj, prev: Obj | undefined, now: number, gone: Record<string, number>): Obj {
  let out: Obj | null = null;
  for (const [field, arr] of Object.entries(next)) {
    if (!isIdList(arr)) continue;
    const before = isIdList(prev?.[field]) ? new Map((prev![field] as Obj[]).map((x) => [x.id as string, x])) : new Map<string, Obj>();
    let changed = false;
    const list = arr.map((x) => {
      const p = before.get(x.id as string);
      before.delete(x.id as string);
      if (p === x || (p && sigOf(p) === sigOf(x))) return x;
      changed = true;
      return { ...stampNested(x, p, now, gone), updatedAt: Math.max(now, Number(x.updatedAt) || 0) };
    });
    for (const id of before.keys()) gone[`item:${id}`] = now;
    if (changed) (out ??= { ...next })[field] = list;
  }
  return out ?? next;
}

/**
 * Изменённые с прошлой записи сущности (элементы массивов с id) получают свежую отметку времени —
 * так при слиянии правка побеждает, даже если код, менявший её, забыл обновить updatedAt.
 */
export function stampChanged<T>(next: T, prev: T | null): { value: T; stamped: boolean } {
  if (!isObj(next)) return { value: next, stamped: false };
  const now = Date.now();
  let stamped = false;
  const out: Obj = { ...next };
  const gone: Record<string, number> = {};
  for (const [field, arr] of Object.entries(next)) {
    if (!Array.isArray(arr) || !arr.every((x) => isObj(x) && typeof x.id === 'string')) continue;
    const before = isObj(prev) && Array.isArray(prev[field]) ? new Map((prev[field] as Obj[]).map((x) => [x.id as string, x])) : new Map<string, Obj>();
    let changed = false;
    const list = (arr as Obj[]).map((x) => {
      const p = before.get(x.id as string);
      // тот же объект (не изменялся — изменения копируют только тронутое) — без перевода в JSON
      if (p === x || (p && sigOf(p) === sigOf(x))) return x;
      if (before.size === 0 && !isObj(prev)) return x; // первая запись — ничего не сравниваем
      changed = true;
      return { ...stampNested(x, p, now, gone), updatedAt: Math.max(now, Number(x.updatedAt) || 0) };
    });
    if (changed) {
      out[field] = list;
      stamped = true;
    }
  }
  // удалённые вложенные пункты — в отметки об удалении (синхронизируются вместе с данными)
  if (Object.keys(gone).length) out.gone = { ...((isObj(next.gone) ? next.gone : {}) as Obj), ...gone };
  return { value: (stamped ? out : next) as T, stamped };
}

export interface BlobSync {
  /** данные загружены из базы — запомнить, какую версию видели */
  loaded(): void;
  /** отложить запись (через delay мс) */
  schedule(delay?: number): void;
  pending(): boolean;
  /** записать отложенные изменения сейчас (со слиянием, если ключ менялся синхронизацией) */
  flush(): Promise<void>;
  /** ключ изменился на другом устройстве: сохранить свои правки и перечитать */
  reload(): Promise<void>;
}

export function blobSync<T>(o: {
  key: string;
  read: () => T | null;
  write: (v: T) => void;
  normalize: (raw: T | undefined) => T;
  onError?: () => void;
}): BlobSync {
  let seen = remoteRev(o.key);
  /** последнее записанное/прочитанное — для отметки изменённого */
  let last: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  /** Копия в памяти + всё, что синхронизация записала после её загрузки */
  async function fresh(mem: T): Promise<{ value: T; merged: boolean }> {
    for (let i = 0; i < 5; i++) {
      const rev = remoteRev(o.key);
      if (rev === seen) return { value: mem, merged: false };
      const disk = await get<T>(o.key);
      if (remoteRev(o.key) !== rev) continue; // пока читали, пришло ещё — заново
      seen = rev;
      if (disk === undefined) return { value: mem, merged: false };
      // пришедшее с другого устройства — не «изменено здесь»: сравниваем с ним
      last = o.normalize(disk);
      return { value: o.normalize(mergeValues(o.key, mem, disk) as T), merged: true };
    }
    return { value: mem, merged: false };
  }

  async function save() {
    const mem = o.read();
    if (!mem) return;
    const { value, merged } = await fresh(mem);
    // пока сливали, могли появиться новые правки — они уже в памяти, сливаем их тоже
    const now = o.read();
    const combined = merged && now && now !== mem ? o.normalize(mergeValues(o.key, now, value) as T) : value;
    const { value: final, stamped } = stampChanged(combined, last);
    if (merged || stamped) {
      // в памяти — то же, что записано (если за это время ничего не поменяли)
      if (o.read() === now || merged) o.write(final);
    }
    last = final;
    await set(o.key, final);
  }

  const api: BlobSync = {
    loaded() {
      seen = remoteRev(o.key);
      last = o.read();
    },
    schedule(delay = 250) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void api.flush(), delay);
    },
    pending: () => !!timer,
    flush() {
      if (!timer) return writing;
      clearTimeout(timer);
      timer = null;
      writing = writing.then(save).catch(() => o.onError?.());
      return writing;
    },
    async reload() {
      await api.flush();
      await writing;
      const rev = remoteRev(o.key);
      const disk = o.normalize(await get<T>(o.key));
      const mem = o.read();
      if (timer && mem) {
        // пока читали, пользователь что-то изменил — не теряем
        o.write(o.normalize(mergeValues(o.key, mem, disk) as T));
      } else o.write(disk);
      seen = rev;
      last = disk;
    },
  };
  return api;
}
