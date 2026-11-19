/** Поиск iPhone (Spotlight): что попадает в индекс и что поменялось с прошлого раза (без зависимостей — проверяется тестами) */

export type SpotKind = 'map' | 'note' | 'task';

export interface SpotItem {
  id: string;
  kind: SpotKind;
  title: string;
  /** короткий отрывок под названием */
  text?: string;
}

export interface SpotSources {
  maps: { id: string; title: string; trashed?: boolean; updatedAt: number; preview?: { r: string; k: { t: string }[] } }[];
  notes: { id: string; title: string; preview: string; trashed?: number; updatedAt: number }[];
  tasks: { id: string; title: string; notes?: string; deleted?: boolean | number; done?: boolean; wontDo?: boolean | number; updatedAt?: number }[];
}

/** Больше записей Spotlight не нужно — индекс остаётся лёгким */
export const SPOT_CAP = 2000;
const TITLE_MAX = 200;
const TEXT_MAX = 160;

const oneLine = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** Записи для Spotlight: карты, заметки и незакрытые задачи; свежие — первыми, не больше cap */
export function buildSpotlightItems(src: SpotSources, cap = SPOT_CAP): SpotItem[] {
  const all: { at: number; item: SpotItem }[] = [];
  const add = (at: number | undefined, kind: SpotKind, id: string, title: string, text?: string) => {
    const tt = clip(oneLine(title), TITLE_MAX);
    if (!tt || !id) return;
    const tx = text ? clip(oneLine(text), TEXT_MAX) : '';
    all.push({ at: at ?? 0, item: { id, kind, title: tt, ...(tx && tx !== tt ? { text: tx } : {}) } });
  };
  for (const m of src.maps) {
    if (m.trashed) continue;
    const branches = m.preview?.k.map((x) => oneLine(x.t)).filter(Boolean).join(', ');
    add(m.updatedAt, 'map', m.id, m.title || m.preview?.r || '', branches || undefined);
  }
  for (const n of src.notes) {
    if (n.trashed) continue;
    const first = oneLine(n.preview.split('\n')[0]);
    add(n.updatedAt, 'note', n.id, n.title || first, n.preview);
  }
  for (const t of src.tasks) {
    if (t.deleted || t.done || t.wontDo) continue;
    add(t.updatedAt, 'task', t.id, t.title, t.notes);
  }
  all.sort((a, b) => b.at - a.at);
  return all.slice(0, Math.max(0, cap)).map((x) => x.item);
}

export const spotKey = (i: Pick<SpotItem, 'kind' | 'id'>) => `${i.kind}:${i.id}`;

/** Отпечаток записи (FNV-1a): поменялось название или отрывок — переиндексировать */
export function spotHash(i: SpotItem): string {
  const s = i.title + '\u0001' + (i.text ?? '');
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Что отправить в Spotlight: новые и изменённые записи, удалённые ключи и новое состояние */
export function diffSpotlight(prev: Record<string, string>, items: SpotItem[]): { upsert: SpotItem[]; remove: string[]; next: Record<string, string> } {
  const next: Record<string, string> = {};
  const upsert: SpotItem[] = [];
  for (const i of items) {
    const k = spotKey(i);
    const h = spotHash(i);
    next[k] = h;
    if (prev[k] !== h) upsert.push(i);
  }
  const remove = Object.keys(prev).filter((k) => !(k in next));
  return { upsert, remove, next };
}
