import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronRight, CircleDot, Maximize2, Minus, Plus, Scan, SlidersHorizontal, Sparkles, Waypoints, X } from 'lucide-react';
import type { ID } from '../../types';
import { AIError } from '../../ai/claude';
import { toast } from '../../store/appStore';
import { confirmDialog } from '../../ui/dialogs';
import { notesToReview, reviewNote } from '../aiReview';
import type { Folder } from '../model';
import { type BrainKind, KIND_LABEL } from '../brainDocs';
import { openItem, type BrainItem } from '../brain';
import { clusterGraph, clusterTopics, neighborhood } from '../links';
import { useLinkGraph, useLinks } from '../related';
import { useNotes } from '../store';
import { GraphView, type NodeShape, type ViewLink, type ViewNode } from './graphView';
import { KIND_ICON } from './kindIcons';

function readLS<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* хранилище недоступно */
  }
}

type ColorMode = 'folder' | 'topic' | 'kind';
const KINDS: BrainKind[] = ['note', 'map', 'goal', 'task'];
const SHAPE: Record<BrainKind, NodeShape> = { note: 'circle', map: 'square', goal: 'diamond', task: 'triangle' };
/** цвета типов (заметки — цветом акцента) */
const KIND_COLOR: Record<BrainKind, string> = { note: 'var(--accent)', map: '#8b5cf6', goal: '#f59e0b', task: '#22c55e' };
/** цвета тем — различимые и в светлой, и в тёмной теме */
const TOPIC_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#14b8a6', '#eab308', '#ec4899', '#06b6d4', '#84cc16'];
const KIND_PLURAL: Record<BrainKind, string> = { note: 'Заметки', map: 'Карты', goal: 'Цели', task: 'Задачи' };
const OPEN_LABEL: Record<BrainKind, string> = { note: 'Открыть заметку', map: 'Открыть карту', goal: 'Открыть цель', task: 'Открыть задачу' };

interface Props {
  /** заметки текущего раздела (папка, закреплённые); null — все заметки, а с ними карты, задачи и цели */
  noteScope: Set<ID> | null;
  folders: Folder[];
  /** найденные поиском — подсвечиваются */
  highlight: Set<ID> | null;
  /** выделить и показать эту единицу («На графе») */
  focusId: ID | null;
  onFocused: () => void;
  onSelect?: (id: ID | null) => void;
}

/** Граф «второго мозга»: заметки, карты, цели и задачи — точки, линии — связи, найденные автоматически */
export function NotesGraph({ noteScope, folders, highlight, focusId, onFocused, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<GraphView | null>(null);
  const [sel, setSel] = useState<ID | null>(null);
  const [orphans, setOrphans] = useState(() => readLS('sm-graph-orphans', true));
  const [kinds, setKinds] = useState<BrainKind[]>(() => readLS<BrainKind[]>('sm-graph-kinds', ['note', 'map', 'goal']));
  const [colorMode, setColorMode] = useState<ColorMode>(() => readLS<ColorMode>('sm-graph-color', 'folder'));
  const [panel, setPanel] = useState(false);
  /** «окрестность»: только связи выбранной единицы на depth шагов */
  const [hood, setHood] = useState<{ id: ID; depth: number } | null>(null);
  /** подсвеченная тема из легенды */
  const [topic, setTopic] = useState<number | null>(null);
  const { ix, edges, items, progress } = useLinkGraph();
  const analysing = useLinks((s) => s.progress);
  const notesMeta = useNotes((s) => s.data?.notes);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const bulkAbort = useRef<AbortController | null>(null);
  useEffect(() => () => bulkAbort.current?.abort(), []);

  const select = (id: ID | null) => {
    setSel(id);
    onSelect?.(id);
  };
  const cbRef = useRef({ select });
  useEffect(() => {
    cbRef.current = { select };
  });

  useEffect(() => {
    const v = new GraphView(canvasRef.current!, { onSelect: (id) => cbRef.current.select(id), onOpen: (id) => void openItem(id) });
    viewRef.current = v;
    return () => {
      v.destroy();
      viewRef.current = null;
    };
  }, []);

  // папки заметок — из индекса заметок (у единиц мозга их нет)
  const folderOf = useMemo(() => new Map((notesMeta ?? []).filter((n) => n.folderId).map((n) => [n.id, n.folderId!])), [notesMeta]);
  const scopeKey = noteScope ? [...noteScope].sort().join('|') : '*';
  const foldersKey = folders.map((f) => f.id + f.color).join('|');
  const kindsKey = kinds.join(',');

  // единицы и связи для показа
  const model = useMemo(() => {
    const kindSet = new Set(kinds);
    const pool: BrainItem[] = items.filter(
      (i) => kindSet.has(i.kind) && (i.kind === 'note' ? !noteScope || noteScope.has(i.id) : !noteScope) && (!ix || ix.docs.has(i.id)),
    );
    let ids = new Set(pool.map((i) => i.id));
    let links: ViewLink[] = (edges ?? []).filter((e) => ids.has(e.a) && ids.has(e.b)).map((e) => ({ a: e.a, b: e.b, w: e.score }));
    // окрестность выбранной единицы
    if (hood && ids.has(hood.id)) {
      const near = neighborhood(links, hood.id, hood.depth);
      ids = near;
      links = links.filter((l) => near.has(l.a) && near.has(l.b));
    }
    const deg = new Map<ID, number>();
    for (const l of links) {
      deg.set(l.a, (deg.get(l.a) ?? 0) + 1);
      deg.set(l.b, (deg.get(l.b) ?? 0) + 1);
    }
    const shown = pool.filter((i) => ids.has(i.id) && (orphans || deg.has(i.id) || i.id === hood?.id));
    // темы — кластеры связей; подпись темы — самое частое важное слово её единиц
    const clusters = clusterGraph(
      shown.map((i) => i.id),
      links.map((l) => ({ a: l.a, b: l.b, score: l.w })),
    );
    const size = new Map<number, number>();
    for (const c of clusters.values()) size.set(c, (size.get(c) ?? 0) + 1);
    const names = ix ? clusterTopics(ix, clusters) : new Map<number, string>();
    const topics = [...size.entries()]
      .filter(([c, n]) => n >= 2 && c < TOPIC_COLORS.length)
      // большие темы — первыми (номер кластера и есть место по размеру)
      .sort((a, b) => a[0] - b[0])
      .map(([c, n]) => ({ c, n, name: capitalize(names.get(c) ?? 'Тема ' + (c + 1)), color: TOPIC_COLORS[c] }));
    return { shown, links, clusters, size, topics, total: pool.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, edges, ix, orphans, kindsKey, scopeKey, hood]);

  // canvas не понимает var(...) — подставляем акцент из CSS
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !edges) return;
    const accent = getComputedStyle(canvasRef.current!).getPropertyValue('--accent').trim() || '#007aff';
    const muted = getComputedStyle(canvasRef.current!).getPropertyValue('--text-3').trim() || '#999';
    const folderColor = new Map(folders.map((f) => [f.id, f.color]));
    const colorOf = (i: BrainItem): string => {
      if (colorMode === 'topic') {
        const c = model.clusters.get(i.id) ?? -1;
        return (model.size.get(c) ?? 0) >= 2 && c < TOPIC_COLORS.length ? TOPIC_COLORS[c] : muted;
      }
      if (colorMode === 'folder' && i.kind === 'note') {
        const f = folderOf.get(i.id);
        return (f && folderColor.get(f)) || accent;
      }
      return i.kind === 'note' ? accent : KIND_COLOR[i.kind];
    };
    const nodes: ViewNode[] = model.shown.map((i) => ({
      id: i.id,
      label: i.title || i.preview.slice(0, 40) || 'Без названия',
      color: colorOf(i),
      shape: SHAPE[i.kind],
      ...(i.done ? { done: true } : {}),
    }));
    v.setData(nodes, model.links);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, edges, colorMode, foldersKey, folderOf]);

  // подсветка: найденное поиском или тема из легенды
  useEffect(() => {
    const ids = topic !== null ? new Set([...model.clusters].filter(([, c]) => c === topic).map(([id]) => id)) : highlight;
    viewRef.current?.setHighlight(ids);
  }, [highlight, topic, model]);

  // «На графе»: тип скрыт — показать его; потом выделить и приблизить
  useEffect(() => {
    const v = viewRef.current;
    if (!focusId || !v || !edges) return;
    const it = items.find((i) => i.id === focusId);
    if (it && !kinds.includes(it.kind)) return setKinds([...kinds, it.kind]);
    if (!v.has(focusId) && !orphans) return setOrphans(true);
    setHood(null);
    v.select(focusId, true);
    select(v.has(focusId) ? focusId : null);
    onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, edges, model]);

  // выбранное исчезло (удалено, отфильтровано)
  const selItem = sel ? model.shown.find((n) => n.id === sel) : undefined;
  useEffect(() => {
    if (sel && !model.shown.some((n) => n.id === sel)) select(null);
    if (hood && !items.some((i) => i.id === hood.id)) setHood(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const neighbors = useMemo(() => {
    if (!sel) return [];
    const out: { id: ID; w: number }[] = [];
    for (const l of model.links) {
      if (l.a === sel) out.push({ id: l.b, w: l.w });
      else if (l.b === sel) out.push({ id: l.a, w: l.w });
    }
    return out.sort((a, b) => b.w - a.w);
  }, [sel, model]);

  const toggleOrphans = () => {
    setOrphans(!orphans);
    writeLS('sm-graph-orphans', !orphans);
  };
  const toggleKind = (k: BrainKind) => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
    if (!next.length) return;
    setKinds(next);
    writeLS('sm-graph-kinds', next);
  };
  const setColor = (m: ColorMode) => {
    setColorMode(m);
    writeLS('sm-graph-color', m);
    setTopic(null);
  };

  /** Проверить ИИ все заметки на графе, которые ещё не проверены или изменились после проверки */
  const reviewAll = async () => {
    if (bulk) return;
    setPanel(false);
    const ids = await notesToReview(model.shown.filter((n) => n.kind === 'note').map((n) => n.id));
    if (!ids.length) return toast('Все заметки уже проверены ИИ');
    const n = ids.length;
    const ok = await confirmDialog(
      `Проверить ${n} ${plural(n, 'заметку', 'заметки', 'заметок')} ИИ?`,
      'ИИ оценит важные слова и связи каждой заметки — по одному запросу на заметку. Остановить можно в любой момент.',
      { okText: 'Проверить' },
    );
    if (!ok) return;
    const ac = new AbortController();
    bulkAbort.current = ac;
    let rejected = 0;
    let found = 0;
    let done = 0;
    setBulk({ done, total: n });
    for (const id of ids) {
      if (ac.signal.aborted) break;
      try {
        const r = await reviewNote(id, ac.signal);
        rejected += r.rejected.length;
        found += r.found.length;
      } catch (e) {
        if (ac.signal.aborted) break;
        // лимит, ключ, сеть — дальше нет смысла; заметка без текста — просто пропускаем
        if (e instanceof AIError) {
          toast(e.message);
          break;
        }
      }
      done++;
      setBulk({ done, total: n });
    }
    bulkAbort.current = null;
    setBulk(null);
    if (done) toast(`ИИ проверил ${done} ${plural(done, 'заметку', 'заметки', 'заметок')}: убрал случайных связей — ${rejected}, нашёл новых — ${found}`);
  };

  const pick = (id: ID) => {
    viewRef.current?.select(id, true);
    select(id);
  };

  const busy = !edges || progress !== null || !!analysing;
  const folder = selItem?.kind === 'note' && folderOf.get(selItem.id) ? folders.find((f) => f.id === folderOf.get(selItem.id)) : undefined;
  const titleOf = (id: ID) => {
    const m = items.find((n) => n.id === id);
    return m ? m.title || m.preview.slice(0, 40) || 'Без названия' : '';
  };
  const hoodTitle = hood ? titleOf(hood.id) : '';
  const scopeAll = !noteScope;
  const statLabel = scopeAll ? plural(model.shown.length, 'единица', 'единицы', 'единиц') : plural(model.shown.length, 'заметка', 'заметки', 'заметок');

  return (
    <div className="nt-graph">
      <canvas ref={canvasRef} className="nt-graph-canvas" aria-label="Граф связей между заметками, картами, целями и задачами" />

      {/* панель и легенда — одной колонкой: панель переносится на вторую строку — легенда сдвигается */}
      <div className="nt-graph-top">
        <div className="nt-graph-bar">
          <span className="nt-graph-stat">
            <Waypoints size={15} />
            {model.shown.length} {statLabel} · {model.links.length} {plural(model.links.length, 'связь', 'связи', 'связей')}
          </span>
          <button className={`nt-graph-chip${panel ? ' active' : ''}`} onClick={() => setPanel(!panel)} aria-expanded={panel} title="Что показывать и как раскрасить">
            <SlidersHorizontal size={14} /> Вид
          </button>
          {hood && (
            <span className="nt-graph-chip active nt-graph-hood">
              <Scan size={14} />
              <span className="ellipsis">{hoodTitle}</span>
              <button
                className="nt-graph-hood-depth"
                onClick={() => setHood({ ...hood, depth: hood.depth === 1 ? 2 : 1 })}
                title="Сколько шагов по связям показывать"
              >
                {hood.depth === 1 ? '1 шаг' : '2 шага'}
              </button>
              <button className="nt-graph-hood-x" onClick={() => setHood(null)} aria-label="Показать весь граф">
                <X size={14} />
              </button>
            </span>
          )}
        </div>

        {colorMode === 'topic' && model.topics.length > 0 && (
          <div className="nt-graph-legend" aria-label="Темы">
            {model.topics.map((t) => (
              <button
                key={t.c}
                className={`nt-graph-topic${topic === t.c ? ' active' : ''}`}
                style={{ '--tc': t.color } as CSSProperties}
                onClick={() => setTopic(topic === t.c ? null : t.c)}
                aria-pressed={topic === t.c}
              >
                <i />
                {t.name}
                <span className="nt-graph-topic-n">{t.n}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {panel && (
        <>
          <div className="nt-graph-panel-shield" onPointerDown={() => setPanel(false)} />
          <div className="nt-graph-panel" role="dialog" aria-label="Вид графа">
            {scopeAll && (
              <>
                <div className="nt-graph-panel-label">Показывать</div>
                <div className="nt-graph-panel-row">
                  {KINDS.map((k) => {
                    const Icon = KIND_ICON[k];
                    return (
                      <button key={k} className={`nt-graph-chip${kinds.includes(k) ? ' active' : ''}`} onClick={() => toggleKind(k)} aria-pressed={kinds.includes(k)}>
                        <Icon size={14} /> {KIND_PLURAL[k]}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div className="nt-graph-panel-row">
              <button className={`nt-graph-chip${orphans ? ' active' : ''}`} onClick={toggleOrphans} aria-pressed={orphans}>
                <CircleDot size={14} /> Без связей
              </button>
            </div>
            <div className="nt-graph-panel-label">Цвет</div>
            <div className="nt-seg" role="radiogroup" aria-label="Цвет точек">
              {(
                [
                  ['folder', 'Папки'],
                  ['topic', 'Темы'],
                  ['kind', 'Типы'],
                ] as [ColorMode, string][]
              ).map(([m, l]) => (
                <button key={m} className={colorMode === m ? 'on' : ''} onClick={() => setColor(m)} role="radio" aria-checked={colorMode === m}>
                  {l}
                </button>
              ))}
            </div>
            {model.shown.some((n) => n.kind === 'note') && !bulk && (
              <button className="nt-ai-btn nt-graph-panel-ai" onClick={() => void reviewAll()}>
                <Sparkles size={14} /> Проверить связи ИИ
              </button>
            )}
          </div>
        </>
      )}

      <div className="nt-graph-tools">
        <button className="nt-graph-tool" onClick={() => viewRef.current?.zoomBy(1.4)} aria-label="Приблизить">
          <Plus size={18} />
        </button>
        <button className="nt-graph-tool" onClick={() => viewRef.current?.zoomBy(1 / 1.4)} aria-label="Отдалить">
          <Minus size={18} />
        </button>
        <button className="nt-graph-tool" onClick={() => viewRef.current?.fit()} aria-label="Вписать граф в экран">
          <Maximize2 size={16} />
        </button>
      </div>

      {bulk && (
        <div className="nt-graph-busy">
          <div className="nt-rel-bar">
            <span style={{ width: `${Math.round((bulk.done / Math.max(1, bulk.total)) * 100)}%` }} />
          </div>
          <span className="faint tiny">
            ИИ проверяет связи… {bulk.done} из {bulk.total}
          </span>
          <button className="nt-ai-btn" onClick={() => bulkAbort.current?.abort()}>
            Стоп
          </button>
        </div>
      )}

      {busy && !bulk && (
        <div className="nt-graph-busy">
          <div className="nt-rel-bar">
            <span style={{ width: `${Math.round((analysing ? analysing.done / Math.max(1, analysing.total) : (progress ?? 0)) * 100)}%` }} />
          </div>
          <span className="faint tiny">{analysing ? `Анализирую… ${analysing.done} из ${analysing.total}` : 'Ищу связи…'}</span>
        </div>
      )}

      {!busy && model.shown.length === 0 && (
        <div className="nt-graph-empty">
          <Waypoints size={36} />
          <div>{model.total === 0 ? 'Здесь пока нет заметок' : 'Связей пока нет. Они появятся сами, когда одни и те же темы встретятся в разных заметках, картах и задачах.'}</div>
          {model.total > 0 && !orphans && (
            <button className="btn btn-sm" onClick={toggleOrphans}>
              Показать всё
            </button>
          )}
        </div>
      )}

      {selItem && (
        <div className="nt-graph-card" style={folder ? ({ '--fc': folder.color } as CSSProperties) : undefined}>
          <div className="nt-graph-card-top">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="nt-graph-card-title">{selItem.title || 'Без названия'}</div>
              <div className="nt-graph-card-meta">
                {selItem.kind !== 'note' && <span className="nt-graph-card-kind">{KIND_LABEL[selItem.kind]}</span>}
                {folder && (
                  <span className="nt-graph-card-folder">
                    <i />
                    {folder.name}
                  </span>
                )}
                {neighbors.length ? `${neighbors.length} ${plural(neighbors.length, 'связь', 'связи', 'связей')}` : 'Без связей'}
              </div>
            </div>
            <button className="icon-btn" onClick={() => (viewRef.current?.select(null), select(null))} aria-label="Снять выделение">
              <X size={18} />
            </button>
          </div>
          {selItem.preview && <div className="nt-graph-card-prev">{selItem.preview}</div>}
          {neighbors.length > 0 && (
            <div className="nt-graph-card-nb">
              {neighbors.slice(0, 6).map((nb) => (
                <button key={nb.id} className="nt-rel-chip nt-graph-nb" onClick={() => pick(nb.id)}>
                  {titleOf(nb.id)}
                </button>
              ))}
            </div>
          )}
          <div className="nt-graph-card-actions">
            {neighbors.length > 0 && hood?.id !== selItem.id && (
              <button className="btn" onClick={() => setHood({ id: selItem.id, depth: 2 })} title="Показать только связи этой единицы">
                <Scan size={16} /> Окрестность
              </button>
            )}
            <button className="btn btn-primary grow nt-graph-open" onClick={() => void openItem(selItem.id)}>
              {OPEN_LABEL[selItem.kind]} <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
