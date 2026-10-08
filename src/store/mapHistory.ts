/**
 * История версий карты: снимки хранятся только на этом устройстве (ключи `hist:<id>`, не синхронизируются
 * и не попадают в копии). Снимок — при открытии карты и не чаще раза в 10 минут во время правок.
 * Свежие версии хранятся все, за последние двое суток — по одной в час, старше — по одной в день.
 */
import { del, get, keys, set } from './kv';
import type { ID, MindDoc, Topic } from '../types';
import { countTopics } from '../utils/tree';

export interface MapVersion {
  at: number;
  title: string;
  topics: number;
  doc: MindDoc;
}

const key = (id: ID) => `hist:${id}`;
const EVERY = 10 * 60_000;
const HOUR = 3600_000;
const MAX = 50;
/** не больше ~8 МБ истории на карту */
const MAX_BYTES = 8_000_000;

/** Когда снимали последний раз (в памяти — чтобы не читать базу при каждом сохранении) */
const lastAt = new Map<ID, number>();
let chain: Promise<unknown> = Promise.resolve();
/** Записи по очереди: два снимка подряд не затрут друг друга */
const queued = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

export async function listVersions(id: ID): Promise<MapVersion[]> {
  return ((await get<MapVersion[]>(key(id))) ?? []).slice().sort((a, b) => b.at - a.at);
}

/** Свёрнутые/развёрнутые ветви — не изменение карты */
const noFold = (k: string, v: unknown) => (k === 'collapsed' ? undefined : v);
export const sameContent = (a: MindDoc, b: MindDoc) => a.title === b.title && JSON.stringify(a.sheets, noFold) === JSON.stringify(b.sheets, noFold);

/** Какие версии оставить: последние 2 часа — все, до двух суток — последняя в каждом часе, дальше — в каждом дне */
export function thin(list: MapVersion[], now = Date.now()): MapVersion[] {
  const seen = new Set<string>();
  const out: MapVersion[] = [];
  for (const v of list.slice().sort((a, b) => b.at - a.at)) {
    const age = now - v.at;
    const d = new Date(v.at);
    const bucket = age < 2 * HOUR ? `v${v.at}` : age < 48 * HOUR ? `h${Math.floor(v.at / HOUR)}` : `d${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    out.push(v);
  }
  // по размеру: самые старые уходят первыми
  let bytes = 0;
  const kept: MapVersion[] = [];
  for (const v of out.slice(0, MAX)) {
    bytes += JSON.stringify(v.doc).length;
    if (bytes > MAX_BYTES && kept.length) break;
    kept.push(v);
  }
  return kept;
}

/** Сохранить версию карты (если она отличается от последней сохранённой) */
export function snapshot(doc: MindDoc, at = Date.now()): Promise<boolean> {
  const copy = structuredClone(doc);
  lastAt.set(doc.id, at);
  return queued(async () => {
    const list = await listVersions(doc.id);
    if (list[0] && sameContent(list[0].doc, copy)) return false;
    const v: MapVersion = { at, title: copy.title, topics: copy.sheets.reduce((n, s) => n + countTopics(s), 0), doc: copy };
    await set(key(doc.id), thin([v, ...list], at));
    return true;
  });
}

/** Снимок во время правок — не чаще раза в 10 минут */
export function maybeSnapshot(doc: MindDoc) {
  const now = Date.now();
  if (now - (lastAt.get(doc.id) ?? 0) < EVERY) return;
  void snapshot(doc, now).catch(() => {});
}

export function deleteHistory(id: ID) {
  lastAt.delete(id);
  return queued(() => del(key(id)));
}

/** Убрать всю историю (вход в другой аккаунт) */
export async function clearAllHistory() {
  lastAt.clear();
  for (const k of await keys()) if (typeof k === 'string' && k.startsWith('hist:')) await del(k);
}

export interface VersionDiff {
  added: number;
  removed: number;
  changed: number;
}

/** Чем версия отличается от текущей карты: сколько тем появилось с тех пор, исчезло и изменилось */
export function diffVersion(version: MindDoc, current: MindDoc): VersionDiff {
  const map = (d: MindDoc) => {
    const m = new Map<string, string>();
    const rec = (t: Topic) => {
      m.set(t.id, `${t.text}\u0000${t.note ?? ''}`);
      t.children.forEach(rec);
    };
    for (const s of d.sheets) {
      rec(s.root);
      s.floating.forEach(rec);
    }
    return m;
  };
  const a = map(version);
  const b = map(current);
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, v] of b) {
    if (!a.has(id)) added++;
    else if (a.get(id) !== v) changed++;
  }
  for (const id of a.keys()) if (!b.has(id)) removed++;
  return { added, removed, changed };
}
