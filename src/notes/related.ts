/**
 * Связи «второго мозга» в приложении: заметки, карты, задачи и цели.
 * Признаки каждой единицы (важные слова) кэшируются на устройстве и пересчитываются только у изменённых;
 * индекс пересобирается по требованию. Сам алгоритм — в links.ts, источники — в brain.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { get, set } from '../store/kv';
import { useApp } from '../store/appStore';
import { useGoals } from '../goals/store';
import { useTasks } from '../tasks/store';
import type { ID } from '../types';
import {
  applyTermReview,
  buildIndexAsync,
  patchIndex,
  buildMentionIndex,
  edgesOf,
  extractFeatures,
  keywordsOf,
  type LinkEdge,
  type LinkIndex,
  type MentionIndex,
  type NoteFeatures,
  normTitle,
  pairKey,
  type Related,
  relatedTo,
  termKey,
} from './links';
import type { NotesData } from './model';
import { type BrainItem, collectItems, itemText } from './brain';
import { perfStart } from './perfLog';
import { useNotes } from './store';

/** Только на этом устройстве (не синхронизируется и не попадает в копии) */
const CACHE_KEY = 'cache:links';
/** Меняется вместе с алгоритмом признаков — старый кэш пересчитывается (2 — карты, задачи, цели и [[ссылки]]) */
const ALGO = 2;

interface CacheItem {
  at: number;
  f: NoteFeatures;
}
interface Cache {
  v: number;
  items: Record<ID, CacheItem>;
  /** разовые пересчёты части кэша (1 — статьи: их шаблон больше не участвует в связях) */
  fix?: number;
}

// ---------- Кэш признаков ----------

let cache: Cache | null = null;
let cacheLoad: Promise<Cache> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function loadCache(): Promise<Cache> {
  if (cache) return Promise.resolve(cache);
  cacheLoad ??= get<Cache>(CACHE_KEY)
    .catch(() => undefined)
    .then((c) => (cache = c && c.v === ALGO && c.items ? c : { v: ALGO, items: {} }));
  return cacheLoad;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (cache) void set(CACHE_KEY, cache).catch(() => undefined);
  }, 3000);
}

// ---------- Индекс ----------

interface LinksState {
  /** первичный анализ: сколько единиц обработано */
  progress: { done: number; total: number } | null;
  /** номер сборки индекса — подписчики пересчитывают связи */
  rev: number;
  /** «Показать на графе»: что выделить, когда откроется граф */
  graphFocus: ID | null;
  /** названия для подсветки упоминаний в тексте заметок */
  mentions: MentionIndex | null;
}

export const useLinks = create<LinksState>(() => ({ progress: null, rev: 0, graphFocus: null, mentions: null }));

/** Открыть граф с выделенной единицей */
export const showInGraph = (id: ID) => useLinks.setState({ graphFocus: id });

let ix: LinkIndex | null = null;
let ixSig = '';
let running: Promise<LinkIndex> | null = null;
let items: BrainItem[] = [];
let itemById = new Map<string, BrainItem>();
let byTitle = new Map<string, string>();
/** пары, связанные явной [[ссылкой]] */
let wikiPairs = new Set<string>();

/** Что влияет на связи: версии единиц и проверка ИИ (правки слов и решения по парам) */
const signature = (list: BrainItem[], d: NotesData | null) =>
  list.map((n) => n.id + ':' + n.at).join('|') +
  '#' +
  (d?.aiTerms ?? []).map((r) => r.id + ':' + r.updatedAt).join('|') +
  '#' +
  (d?.aiLinks ?? []).map((r) => r.id + ':' + (r.ok ? 1 : 0)).join('|') +
  '#' +
  (d?.synonyms ?? []).map((g) => g.id + ':' + g.updatedAt).join('|');
/** показывать прогресс, если читать с диска нужно много */
const PROGRESS_FROM = 15;
const EMPTY: NoteFeatures = { terms: {}, forms: {} };
/** признаки с правками ИИ — те же объекты, пока не менялись ни признаки, ни правки */
const reviewed = new Map<string, { src: NoteFeatures; at: number; out: NoteFeatures }>();

async function rebuild(): Promise<LinkIndex> {
  const c = await loadCache();
  const list = await collectItems();
  const data = useNotes.getState().data;
  const sig = signature(list, data);
  if (ix && sig === ixSig) return ix;

  // статьи, разобранные до 1.32, — признаки заново (шаблон «Главные мысли»… связывал все статьи между собой)
  if ((c.fix ?? 0) < 1) {
    for (const n of data?.notes ?? []) if (n.source) delete c.items[n.id];
    c.fix = 1;
    scheduleSave();
  }
  const stale = list.filter((n) => c.items[n.id]?.at !== n.at);
  const tFeat = perfStart();
  const showProgress = stale.length >= PROGRESS_FROM;
  if (showProgress) useLinks.setState({ progress: { done: 0, total: stale.length } });
  let done = 0;
  for (const n of stale) {
    try {
      const doc = await itemText(n.id);
      // не прочитать (карта под паролем) — пустые признаки, чтобы не читать каждый раз
      c.items[n.id] = { at: n.at, f: doc ? extractFeatures(doc) : EMPTY };
    } catch {
      /* не прочитать сейчас — попробуем в следующий раз */
    }
    done++;
    if (showProgress && (done % 5 === 0 || done === stale.length)) useLinks.setState({ progress: { done, total: stale.length } });
  }
  // удалённые — из кэша (заметки в корзине остаются: восстановятся без пересчёта)
  const known = new Set(list.map((n) => n.id));
  for (const n of data?.notes ?? []) known.add(n.id);
  let pruned = false;
  for (const id in c.items)
    if (!known.has(id)) {
      delete c.items[id];
      pruned = true;
    }
  if (stale.length || pruned) scheduleSave();
  if (stale.length >= 20) tFeat('features', stale.length);

  // названия → единицы (заметки первыми: при совпадении [[ссылка]] ведёт на заметку)
  const titles = new Map<string, string>();
  for (const n of list) {
    const k = normTitle(n.title);
    if (k && !titles.has(k)) titles.set(k, n.id);
  }
  // решения по парам: ИИ и человек, поверх — явные [[ссылки]] (их написал сам человек)
  const pairs = new Map((data?.aiLinks ?? []).map((r) => [r.id, r.ok]));
  const wiki = new Set<string>();
  for (const n of list)
    for (const t of c.items[n.id]?.f.wiki ?? []) {
      const target = titles.get(normTitle(t));
      if (!target || target === n.id) continue;
      const k = pairKey(n.id, target);
      pairs.set(k, true);
      wiki.add(k);
    }

  // правки ИИ: лишние слова убраны, пропущенные темы добавлены (результат — тот же объект, пока ничего не менялось:
  // так точечное обновление индекса видит, какие записи изменились)
  const reviews = new Map((data?.aiTerms ?? []).map((r) => [r.id, r]));
  const docs = list
    .filter((n) => c.items[n.id])
    .map((n) => {
      const r = reviews.get(n.id);
      const f = c.items[n.id].f;
      if (!r) return { id: n.id, f };
      const hit = reviewed.get(n.id);
      if (hit && hit.src === f && hit.at === r.updatedAt) return { id: n.id, f: hit.out };
      const out = applyTermReview(f, r.drop, r.add);
      reviewed.set(n.id, { src: f, at: r.updatedAt, out });
      return { id: n.id, f: out };
    });
  // синонимы: слова группы → ключи терминов
  const synonyms = (data?.synonyms ?? []).map((g) => g.words.map(termKey).filter((k): k is string => !!k));
  // правка одной-двух записей — точечное обновление (миллисекунды); иначе полная сборка порциями (экран не замирает)
  const opts = { pairs, synonyms };
  const tIx = perfStart();
  const patched = ix ? patchIndex(ix, docs, opts) : null;
  const next = patched ?? (await buildIndexAsync(docs, opts));
  if (next !== ix) tIx(patched ? 'patch' : 'index', next.n);
  ix = next;
  ixSig = sig;
  items = list;
  itemById = new Map(list.map((n) => [n.id, n]));
  byTitle = titles;
  wikiPairs = wiki;
  // упоминания в тексте: названия заметок, карт и целей (у задач названия — короткие фразы, их слишком много)
  const rare = (k: string) => (next.df.get(k) ?? 0) <= Math.max(3, Math.ceil(next.n * 0.15));
  const mentions = buildMentionIndex(
    list.filter((n) => n.kind !== 'task' && n.title.trim()).map((n) => ({ id: n.id, title: n.title })),
    { canon: next.canonLex, isRare: rare },
  );
  useLinks.setState((s) => ({ progress: null, rev: s.rev + 1, mentions }));
  return next;
}

/** Актуальный индекс связей (запросы во время сборки ждут её и, если данные успели измениться, — следующую) */
export function ensureLinkIndex(): Promise<LinkIndex> {
  const prev = running;
  const next: Promise<LinkIndex> = (prev ? prev.catch(() => undefined) : Promise.resolve()).then(rebuild);
  running = next;
  void next
    .finally(() => {
      if (running === next) running = null;
    })
    .catch(() => {
      useLinks.setState({ progress: null });
    });
  return next;
}

/** Важные слова единицы, как их выбрал алгоритм (без правок ИИ) — из кэша; индекс должен быть собран */
export const rawFeatures = (id: ID): NoteFeatures | undefined => cache?.items[id]?.f;

/** Текущий индекс без пересборки (может быть устаревшим) */
export const linkIndex = () => ix;
/** Единица мозга по id (по последней сборке) */
export const brainItem = (id: string) => itemById.get(id);
export const brainItems = () => items;
/** Единица по названию (как в [[ссылке]]) */
export const itemByTitle = (title: string) => {
  const id = byTitle.get(normTitle(title));
  return id ? itemById.get(id) : undefined;
};
/** Пара связана явной [[ссылкой]] */
export const isWikiLink = (a: string, b: string) => wikiPairs.has(pairKey(a, b));

/** Данные, от которых зависят связи: подписчик пересчитывает, когда меняется любой раздел */
function useBrainDeps() {
  const notes = useNotes((s) => s.data);
  const tasks = useTasks((s) => s.data);
  const goals = useGoals((s) => s.data);
  const maps = useApp((s) => s.docsVersion);
  return { notes, tasks, goals, maps };
}

// ---------- Хук для экрана заметки ----------

export interface RelatedView {
  list: Related[];
  keywords: string[];
  /** первый расчёт ещё идёт */
  loading: boolean;
}

/** Пересчёт после правок — с паузой: пока человек печатает, индекс не трогаем */
const DEBOUNCE = 1200;

/**
 * Связанное с единицей (заметкой, задачей…). После правок пересчитывается, только когда
 * панель на экране (visible), — набор текста в начале длинной заметки не тратит батарею.
 */
export function useRelatedNotes(id: ID | null, visible: boolean, limit = 8): RelatedView {
  const deps = useBrainDeps();
  const rev = useLinks((s) => s.rev);
  const first = useRef(true);

  // индекс устарел — пересобрать (сразу при открытии, потом — с паузой и только на экране)
  useEffect(() => {
    // заметки могут быть ещё не загружены (панель в задаче или цели) — collectItems загрузит их сам
    if (!id) return;
    if (!first.current && !visible) return;
    const t = setTimeout(
      () => {
        first.current = false;
        void ensureLinkIndex().catch(() => undefined);
      },
      first.current ? 0 : DEBOUNCE,
    );
    return () => clearTimeout(t);
  }, [id, deps.notes, deps.tasks, deps.goals, deps.maps, visible]);

  // индекс собран (rev) — связи этой единицы; ix — модульная переменная, rev отмечает её смену
  return useMemo(() => {
    const cur = ix;
    if (!id || !cur) return { list: [], keywords: [], loading: true };
    const trashed = new Set((deps.notes?.notes ?? []).filter((n) => n.trashed).map((n) => n.id));
    return { list: relatedTo(cur, id, { limit }).filter((r) => itemById.has(r.id) && !trashed.has(r.id)), keywords: keywordsOf(cur, id, 6), loading: false };
    // rev — не используется внутри, но отмечает пересборку модульного ix
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rev, limit, deps.notes]);
}

// ---------- Граф ----------

/** у каждой единицы на графе — не больше стольких самых сильных связей */
const GRAPH_PER_NOTE = 6;
const graphCache = new WeakMap<LinkIndex, LinkEdge[]>();

/** Все связи для графа. Считаются порциями, чтобы не подвешивать экран; результат — до следующей пересборки индекса */
async function graphEdges(cur: LinkIndex, onProgress: (p: number) => void, alive: () => boolean): Promise<LinkEdge[] | null> {
  const hit = graphCache.get(cur);
  if (hit) return hit;
  // индекс обновлён точечно — связи прежнего графа, кроме изменённых записей, + их связи заново
  const prev = cur.base && cur.changed ? graphCache.get(cur.base) : undefined;
  const tG = perfStart();
  if (prev && cur.changed) {
    const ch = cur.changed;
    const seen = new Map<string, LinkEdge>();
    for (const e of prev) if (!ch.has(e.a) && !ch.has(e.b)) seen.set(e.a + '|' + e.b, e);
    for (const id of ch) for (const e of edgesOf(cur, id, GRAPH_PER_NOTE)) if (!seen.has(e.a + '|' + e.b)) seen.set(e.a + '|' + e.b, e);
    const edges = [...seen.values()];
    graphCache.set(cur, edges);
    tG('graph-patch', cur.n);
    return edges;
  }
  const ids = [...cur.docs.keys()];
  const seen = new Map<string, LinkEdge>();
  let t = performance.now();
  for (let i = 0; i < ids.length; i++) {
    for (const e of edgesOf(cur, ids[i], GRAPH_PER_NOTE)) {
      const key = e.a + '|' + e.b;
      if (!seen.has(key)) seen.set(key, e);
    }
    if (performance.now() - t > 30) {
      onProgress((i + 1) / ids.length);
      await new Promise((r) => setTimeout(r, 0));
      if (!alive()) return null;
      t = performance.now();
    }
  }
  const edges = [...seen.values()];
  graphCache.set(cur, edges);
  tG('graph', cur.n);
  return edges;
}

/** Индекс и все связи мозга (как на графе) — для тем и конспектов */
export async function brainGraph(): Promise<{ ix: LinkIndex; edges: LinkEdge[]; items: BrainItem[] }> {
  const cur = await ensureLinkIndex();
  const edges = (await graphEdges(cur, () => undefined, () => true)) ?? [];
  return { ix: cur, edges, items };
}

export interface GraphState {
  /** индекс, по которому посчитаны связи (в нём — единицы, у которых есть текст) */
  ix: LinkIndex | null;
  edges: LinkEdge[] | null;
  /** единицы мозга на момент сборки */
  items: BrainItem[];
  /** 0…1 — считаются связи; null — готово */
  progress: number | null;
}

/** Связи всего мозга для экрана графа: пересчитываются после правок (с паузой) */
export function useLinkGraph(): GraphState {
  const deps = useBrainDeps();
  const rev = useLinks((s) => s.rev);
  const [st, setSt] = useState<GraphState>(() => {
    const e = ix ? graphCache.get(ix) : undefined;
    return { ix: e ? ix : null, edges: e ?? null, items: e ? items : [], progress: null };
  });
  const first = useRef(true);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(
      () => {
        first.current = false;
        void ensureLinkIndex()
          .then(async (cur) => {
            if (!alive) return;
            if (!graphCache.has(cur)) setSt((s) => ({ ...s, progress: 0 }));
            const edges = await graphEdges(cur, (p) => alive && setSt((s) => ({ ...s, progress: p })), () => alive);
            if (alive && edges) setSt({ ix: cur, edges, items, progress: null });
          })
          .catch(() => alive && setSt((s) => ({ ...s, progress: null })));
      },
      first.current ? 0 : DEBOUNCE,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [deps.notes, deps.tasks, deps.goals, deps.maps, rev]);

  return st;
}
