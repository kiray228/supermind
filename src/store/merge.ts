/**
 * Слияние версий одного ключа (с этого устройства и с сервера/другой вкладки).
 * Наборы сущностей сливаются по id (свежее по updatedAt), удалённое не возвращается,
 * карты и заметки целиком — побеждает более свежая.
 */

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export function mergeValues(key: string, local: unknown, remote: unknown): unknown {
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

/** Отметки об удалении живут год: устройство, не выходившее в сеть дольше, может вернуть удалённое */
const GONE_TTL = 365 * 86400000;

/** Время последнего изменения сущности (метаданные — звёздочка, корзина — тоже изменения) */
const stamp = (x: Obj) => Math.max(Number(x.updatedAt) || 0, Number(x.metaAt) || 0);

/** Набор сущностей: массивы объектов с id сливаются по id (свежее по updatedAt), удалённое не возвращается */
function mergeBlob(local: Obj, remote: Obj): Obj {
  const gone: Record<string, number> = { ...((remote.gone as Record<string, number>) ?? {}) };
  for (const [k, t] of Object.entries((local.gone as Record<string, number>) ?? {})) gone[k] = Math.max(gone[k] ?? 0, t);
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
    } else if (isObj(l) && isObj(r)) {
      // настройки раздела: целиком более свежие (если время изменения известно), иначе — этого устройства
      if (field === 'prefs') out[field] = (Number(r.updatedAt) || 0) > (Number(l.updatedAt) || 0) ? r : l;
      else out[field] = { ...r, ...l };
    }
  }
  const old = Date.now() - GONE_TTL;
  for (const [k, t] of Object.entries(gone)) if (t < old) delete gone[k];
  out.gone = gone;
  return out;
}

/**
 * Сущности по id: свежая версия побеждает. Отметка об удалении скрывает сущность,
 * только если она не моложе последнего изменения (восстановленное из копии не удаляется снова).
 */
function mergeArray(local: Obj[], remote: Obj[], gone: Record<string, number>, singular: string): Obj[] {
  const goneAt = (id: string) => Math.max(gone[id] ?? 0, gone[`${singular}:${id}`] ?? 0, gone[`${singular}s:${id}`] ?? 0);
  const byId = new Map<string, Obj>();
  for (const x of local) byId.set(x.id as string, x);
  for (const x of remote) {
    const cur = byId.get(x.id as string);
    if (!cur || stamp(x) > stamp(cur)) byId.set(x.id as string, x);
  }
  // порядок: как на этом устройстве, новые — в конце
  const order = [...local.map((x) => x.id as string), ...remote.map((x) => x.id as string)];
  return [...new Set(order)]
    .filter((id) => {
      const g = goneAt(id);
      return !g || g < stamp(byId.get(id)!);
    })
    .map((id) => byId.get(id)!);
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

