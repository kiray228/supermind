/**
 * Связанные заметки в приложении: признаки каждой заметки (важные слова) кэшируются на устройстве
 * и пересчитываются только у изменённых; индекс пересобирается по требованию.
 * Сам алгоритм — в links.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { get, set } from '../store/kv';
import type { ID } from '../types';
import { applyTermReview, buildIndex, edgesOf, extractFeatures, keywordsOf, type LinkEdge, type LinkIndex, type NoteDoc, type NoteFeatures, type Related, relatedTo } from './links';
import { type NoteBody, type NoteMeta, type NotesData, stripInline } from './model';
import { loadNoteBody, useNotes } from './store';

/** Только на этом устройстве (не синхронизируется и не попадает в копии) */
const CACHE_KEY = 'cache:links';
/** Меняется вместе с алгоритмом признаков — старый кэш пересчитывается */
const ALGO = 1;

interface CacheItem {
  at: number;
  f: NoteFeatures;
}
interface Cache {
  v: number;
  items: Record<ID, CacheItem>;
}

/** Текст заметки для анализа: заголовки отдельно (весят больше), код не учитывается */
export function noteDoc(body: NoteBody): NoteDoc {
  const headings: string[] = [];
  const text: string[] = [];
  for (const b of body.blocks) {
    if (b.type === 'code') continue;
    if (b.text) (b.type === 'h1' || b.type === 'h2' || b.type === 'h3' ? headings : text).push(stripInline(b.text));
    if (b.caption) text.push(b.caption);
    if (b.transcript) text.push(b.transcript);
  }
  return { title: body.title, headings, text: text.join('\n') };
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
  /** первичный анализ: сколько заметок обработано */
  progress: { done: number; total: number } | null;
  /** номер сборки индекса — подписчики пересчитывают связи */
  rev: number;
  /** «Показать на графе»: какую заметку выделить, когда откроется граф */
  graphFocus: ID | null;
}

export const useLinks = create<LinksState>(() => ({ progress: null, rev: 0, graphFocus: null }));

/** Открыть граф с выделенной заметкой */
export const showInGraph = (id: ID) => useLinks.setState({ graphFocus: id });

let ix: LinkIndex | null = null;
let ixSig = '';
let running: Promise<LinkIndex> | null = null;

const alive = (notes: NoteMeta[]) => notes.filter((n) => !n.trashed);
/** Что влияет на связи: заметки (их версии) и проверка ИИ (правки слов и решения по парам) */
const signature = (d: NotesData | null) =>
  alive(d?.notes ?? [])
    .map((n) => n.id + ':' + n.updatedAt)
    .join('|') +
  '#' +
  (d?.aiTerms ?? []).map((r) => r.id + ':' + r.updatedAt).join('|') +
  '#' +
  (d?.aiLinks ?? []).map((r) => r.id + ':' + (r.ok ? 1 : 0)).join('|');
/** показывать прогресс, если читать с диска нужно много заметок */
const PROGRESS_FROM = 15;

async function rebuild(): Promise<LinkIndex> {
  const c = await loadCache();
  const data = useNotes.getState().data;
  const notes = alive(data?.notes ?? []);
  const sig = signature(data);
  if (ix && sig === ixSig) return ix;

  const stale = notes.filter((n) => c.items[n.id]?.at !== n.updatedAt);
  const showProgress = stale.length >= PROGRESS_FROM;
  if (showProgress) useLinks.setState({ progress: { done: 0, total: stale.length } });
  let done = 0;
  for (const n of stale) {
    try {
      const body = await loadNoteBody(n.id);
      c.items[n.id] = { at: n.updatedAt, f: extractFeatures(noteDoc(body)) };
    } catch {
      /* заметку не прочитать — пропускаем, попробуем в следующий раз */
    }
    done++;
    if (showProgress && (done % 5 === 0 || done === stale.length)) useLinks.setState({ progress: { done, total: stale.length } });
  }
  // удалённые навсегда — из кэша (заметки в корзине остаются: восстановятся без пересчёта)
  const known = new Set((useNotes.getState().data?.notes ?? []).map((n) => n.id));
  let pruned = false;
  for (const id in c.items)
    if (!known.has(id)) {
      delete c.items[id];
      pruned = true;
    }
  if (stale.length || pruned) scheduleSave();

  // правки ИИ: лишние слова убраны, пропущенные темы добавлены; решения по парам — поверх алгоритма
  const reviews = new Map((data?.aiTerms ?? []).map((r) => [r.id, r]));
  const items = notes
    .filter((n) => c.items[n.id])
    .map((n) => {
      const r = reviews.get(n.id);
      const f = c.items[n.id].f;
      return { id: n.id, f: r ? applyTermReview(f, r.drop, r.add) : f };
    });
  ix = buildIndex(items, { pairs: new Map((data?.aiLinks ?? []).map((r) => [r.id, r.ok])) });
  ixSig = sig;
  useLinks.setState((s) => ({ progress: null, rev: s.rev + 1 }));
  return ix;
}

/** Актуальный индекс связей (запросы во время сборки ждут её и, если заметки успели измениться, — следующую) */
export function ensureLinkIndex(): Promise<LinkIndex> {
  if (ix && !running && signature(useNotes.getState().data) === ixSig) return Promise.resolve(ix);
  const prev = running;
  const next: Promise<LinkIndex> = (prev ? prev.catch(() => undefined) : Promise.resolve()).then(rebuild);
  running = next;
  void next
    .finally(() => {
      if (running === next) running = null;
    })
    .catch(() => undefined);
  return next;
}

/** Важные слова заметки, как их выбрал алгоритм (без правок ИИ) — из кэша; индекс должен быть собран */
export const rawFeatures = (id: ID): NoteFeatures | undefined => cache?.items[id]?.f;

/** Текущий индекс без пересборки (может быть устаревшим) */
export const linkIndex = () => ix;

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
 * Связанные заметки для открытой заметки. После правок пересчитывается, только когда
 * панель на экране (visible), — набор текста в начале длинной заметки не тратит батарею.
 */
export function useRelatedNotes(id: ID | null, visible: boolean, limit = 8): RelatedView {
  const data = useNotes((s) => s.data);
  const rev = useLinks((s) => s.rev);
  const first = useRef(true);

  // индекс устарел — пересобрать (сразу при открытии, потом — с паузой и только на экране)
  useEffect(() => {
    if (!id || !data) return;
    if (!first.current && !visible) return;
    const t = setTimeout(
      () => {
        first.current = false;
        void ensureLinkIndex().catch(() => undefined);
      },
      first.current ? 0 : DEBOUNCE,
    );
    return () => clearTimeout(t);
  }, [id, data, visible]);

  // индекс собран (rev) — связи этой заметки; ix — модульная переменная, rev отмечает её смену
  return useMemo(() => {
    const cur = ix;
    if (!id || !cur) return { list: [], keywords: [], loading: true };
    const live = new Set((data?.notes ?? []).filter((n) => !n.trashed).map((n) => n.id));
    return { list: relatedTo(cur, id, { limit }).filter((r) => live.has(r.id)), keywords: keywordsOf(cur, id, 6), loading: false };
    // rev — не используется внутри, но отмечает пересборку модульного ix
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rev, limit, data]);
}

// ---------- Граф ----------

/** у каждой заметки на графе — не больше стольких самых сильных связей */
const GRAPH_PER_NOTE = 6;
const graphCache = new WeakMap<LinkIndex, LinkEdge[]>();

/** Все связи для графа. Считаются порциями, чтобы не подвешивать экран; результат — до следующей пересборки индекса */
async function graphEdges(cur: LinkIndex, onProgress: (p: number) => void, alive: () => boolean): Promise<LinkEdge[] | null> {
  const hit = graphCache.get(cur);
  if (hit) return hit;
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
  return edges;
}

export interface GraphState {
  /** индекс, по которому посчитаны связи (в нём — заметки, у которых есть текст) */
  ix: LinkIndex | null;
  edges: LinkEdge[] | null;
  /** 0…1 — считаются связи; null — готово */
  progress: number | null;
}

/** Связи всех заметок для экрана графа: пересчитываются после правок (с паузой) */
export function useLinkGraph(): GraphState {
  const data = useNotes((s) => s.data);
  const rev = useLinks((s) => s.rev);
  const [st, setSt] = useState<GraphState>(() => {
    const e = ix ? graphCache.get(ix) : undefined;
    return { ix: e ? ix : null, edges: e ?? null, progress: null };
  });
  const first = useRef(true);

  useEffect(() => {
    if (!data) return;
    let alive = true;
    const t = setTimeout(
      () => {
        first.current = false;
        void ensureLinkIndex()
          .then(async (cur) => {
            if (!alive) return;
            if (!graphCache.has(cur)) setSt((s) => ({ ...s, progress: 0 }));
            const edges = await graphEdges(cur, (p) => alive && setSt((s) => ({ ...s, progress: p })), () => alive);
            if (alive && edges) setSt({ ix: cur, edges, progress: null });
          })
          .catch(() => alive && setSt((s) => ({ ...s, progress: null })));
      },
      first.current ? 0 : DEBOUNCE,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [data, rev]);

  return st;
}
