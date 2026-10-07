/**
 * Данные для виджетов «Календарь», «Привычки» и «Карта» (Android).
 * Компактный JSON: короткие ключи, только то, что виджет рисует. Дату «сегодня» виджет считает сам,
 * поэтому данные отдаются с запасом по дням.
 */
import { get } from '../store/kv';
import { listDocs, loadDoc } from '../store/db';
import { getTheme } from '../themes';
import { mapSides } from '../layout/layout';
import type { MindDoc, PlannerData } from '../types';
import { addDaysYmd, fromYmd } from '../utils/mapTasks';
import { useTasks } from '../tasks/store';
import { isActive, occurrences } from '../tasks/model';
import { phoneEvents } from '../tasks/sync';
import { activeHabits, compareByTime, countOn, currentStreak, doneOn, dueOn, partOf, targetOf } from '../habits/model';
import { goalsDueBetween, useGoals } from '../goals/store';

const AGENDA_DAYS = 14;
const MAX_AGENDA = 160;
const HABIT_DAYS = 3;
const MAX_MAPS = 12;
const MAX_BRANCHES = 10;

const PRIORITY_COLORS: Record<number, string> = { 1: '#ef4444', 2: '#f59e0b', 3: '#3b82f6' };

const clean = (s: string | undefined, max = 80) => {
  const t = (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// ---------- Календарь ----------

/** k: t — задача, g — срок цели/этапа, e — событие календаря телефона */
interface AgendaItem {
  k: 't' | 'g' | 'e';
  id?: string;
  t: string;
  d: string;
  tm?: string;
  te?: string;
  c?: string;
  e?: string;
}

let phoneCache: { at: number; from: string; items: AgendaItem[] } | null = null;
const PHONE_TTL = 10 * 60_000;

/** Сбросить кэш событий телефона (при возврате в приложение — календарь могли изменить) */
export function invalidatePhoneEvents() {
  phoneCache = null;
}

async function phoneAgenda(from: string, to: string): Promise<AgendaItem[]> {
  if (phoneCache && phoneCache.from === from && Date.now() - phoneCache.at < PHONE_TTL) return phoneCache.items;
  const out: AgendaItem[] = [];
  const events = await phoneEvents(fromYmd(from).getTime(), fromYmd(addDaysYmd(to, 1)).getTime()).catch(() => []);
  for (const ev of events) {
    const title = clean(ev.title) || 'Событие';
    const color = ev.color || undefined;
    if (ev.allDay) {
      // событие на весь день: begin/end в UTC-полночь — раскладываем по дням
      const s = new Date(ev.begin);
      let d = `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`;
      const e = new Date(Math.max(ev.end - 1, ev.begin));
      const last = `${e.getUTCFullYear()}-${pad2(e.getUTCMonth() + 1)}-${pad2(e.getUTCDate())}`;
      for (let i = 0; i < 31 && d <= last; i++, d = addDaysYmd(d, 1)) {
        if (d >= from && d <= to) out.push({ k: 'e', t: title, d, ...(color ? { c: color } : {}) });
      }
      continue;
    }
    const b = new Date(ev.begin);
    const en = new Date(ev.end);
    const d = ymdOf(b);
    if (d < from || d > to) continue;
    out.push({ k: 'e', t: title, d, tm: hm(b), ...(ev.end > ev.begin && ymdOf(en) === d ? { te: hm(en) } : {}), ...(color ? { c: color } : {}) });
  }
  phoneCache = { at: Date.now(), from, items: out };
  return out;
}

export async function buildAgenda(today: string): Promise<AgendaItem[]> {
  const from = addDaysYmd(today, -1);
  const to = addDaysYmd(today, AGENDA_DAYS);
  const data = useTasks.getState().data;
  const out: AgendaItem[] = [];
  if (data) {
    const listColor = new Map(data.lists.map((l) => [l.id, l.color]));
    for (const t of data.tasks) {
      if (!isActive(t) || !t.date) continue;
      const color = PRIORITY_COLORS[t.priority] ?? listColor.get(t.listId);
      for (const d of occurrences(t, from, to, 15)) {
        let te: string | undefined;
        if (t.time && t.duration) {
          const [h, m] = t.time.split(':').map(Number);
          const end = (h || 0) * 60 + (m || 0) + t.duration;
          if (end < 1440) te = `${pad2(Math.floor(end / 60))}:${pad2(end % 60)}`;
        }
        out.push({ k: 't', id: t.id, t: clean(t.title) || 'Без названия', d, ...(t.time ? { tm: t.time } : {}), ...(te ? { te } : {}), ...(color ? { c: color } : {}) });
      }
    }
  }
  for (const g of goalsDueBetween(useGoals.getState().data, from, to)) {
    out.push({ k: 'g', id: g.goalId, t: clean(g.title), d: g.date, e: g.emoji || '🎯' });
  }
  out.push(...(await phoneAgenda(from, to)));
  // по дню; весь день (цели, события, задачи) сверху; затем по времени
  const rank = (x: AgendaItem) => (x.tm ? 3 : x.k === 'g' ? 0 : x.k === 'e' ? 1 : 2);
  out.sort((a, b) => (a.d !== b.d ? (a.d < b.d ? -1 : 1) : rank(a) !== rank(b) ? rank(a) - rank(b) : (a.tm ?? '').localeCompare(b.tm ?? '')));
  return out.slice(0, MAX_AGENDA);
}

/** Изменения целей → обновить виджет */
export const subscribeGoals = (fn: () => void) => useGoals.subscribe((s, p) => s.data !== p.data && fn());

// ---------- Привычки ----------

export async function buildHabits(today: string) {
  const p = await get<PlannerData>('planner').catch(() => undefined);
  const list = activeHabits(p?.habits);
  if (!list.length) return { list: [], days: {} };
  const days = p?.days ?? {};
  const order = ['morning', 'day', 'evening', 'any'];
  const sorted = list
    .map((h, i) => ({ h, i }))
    .sort((a, b) => order.indexOf(partOf(a.h)) - order.indexOf(partOf(b.h)) || compareByTime(a.h, b.h) || a.i - b.i)
    .map((x) => x.h);
  const out: Record<string, [string, number, number, number][]> = {};
  for (let i = 0; i < HABIT_DAYS; i++) {
    const d = addDaysYmd(today, i);
    const rows: [string, number, number, number][] = [];
    for (const h of sorted) {
      if (!dueOn(days, h, d)) continue;
      const s = currentStreak(days, h, d);
      // [id, сколько сделано, серия, 1 — серия в неделях]
      rows.push([h.id, doneOn(days, h, d) ? Math.max(countOn(days[d], h), targetOf(h)) : countOn(days[d], h), s.n, s.unit === 'week' ? 1 : 0]);
    }
    out[d] = rows;
  }
  return {
    list: sorted.map((h) => ({ id: h.id, n: clean(h.name, 40) || 'Привычка', e: h.icon || '', c: h.color || '#22c55e', ...(targetOf(h) > 1 ? { tg: targetOf(h) } : {}), ...(h.unit ? { u: clean(h.unit, 12) } : {}) })),
    days: out,
  };
}

// ---------- Карты ----------

interface MapOutline {
  id: string;
  t: string;
  u: number;
  rc: string;
  r: string;
  /** l: 1 — ветвь слева (в «Интеллект-карте») */
  b: { t: string; c: string; n: number; l?: 1 }[];
  /** 1 — ветви в одну сторону (логическая схема, дерево…) */
  s?: 1;
}

const mapCache = new Map<string, { u: number; o: MapOutline | null }>();

const isHex = (c: string | undefined): c is string => !!c && /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(c);
const lum = (c: string) => {
  const h = c.length === 4 ? c.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : c;
  const n = parseInt(h.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
/** Цвет, заметный и на светлом, и на тёмном фоне */
const visible = (c: string | undefined) => isHex(c) && lum(c) > 0.12 && lum(c) < 0.82;

function outline(doc: MindDoc): MapOutline | null {
  const sheet = doc.sheets.find((s) => s.id === doc.activeSheet) ?? doc.sheets[0];
  if (!sheet) return null;
  const th = getTheme(sheet.themeId);
  const root = sheet.root;
  const rootFill = root.style?.fill ?? th.central.fill;
  const rc = visible(rootFill) ? rootFill : th.palette.find(visible) ?? '#6366f1';
  const palette = th.palette.filter(visible);
  const pal = palette.length ? palette : ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
  const oneSide = !!sheet.structure && sheet.structure !== 'map';
  const sides = oneSide ? null : mapSides(root);
  const b = root.children.slice(0, MAX_BRANCHES).map((t, i) => {
    const own = [t.style?.lineColor, t.style?.fill, t.style?.borderColor].find(visible);
    return {
      t: clean(t.text, 40) || '…',
      c: own ?? pal[i % pal.length],
      n: t.children.length,
      ...(sides?.get(t.id) === 'left' ? { l: 1 as const } : {}),
    };
  });
  return { id: doc.id, t: clean(doc.title, 60) || 'Без названия', u: doc.updatedAt, rc, r: clean(root.text, 50) || clean(doc.title, 50) || 'Карта', b, ...(oneSide ? { s: 1 as const } : {}) };
}

export async function buildMaps(): Promise<MapOutline[]> {
  const metas = (await listDocs().catch(() => []))
    .filter((m) => !m.locked && !m.trashed)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, MAX_MAPS);
  const out: MapOutline[] = [];
  for (const m of metas) {
    let c = mapCache.get(m.id);
    if (!c || c.u !== m.updatedAt) {
      const raw = await loadDoc(m.id).catch(() => undefined);
      c = { u: m.updatedAt, o: raw && !('locked' in raw) ? outline(raw) : null };
      mapCache.set(m.id, c);
    }
    if (c.o) out.push({ ...c.o, t: clean(m.title, 60) || c.o.t });
  }
  return out;
}
