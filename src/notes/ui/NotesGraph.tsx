import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronRight, CircleDot, Maximize2, Minus, Plus, Waypoints, X } from 'lucide-react';
import type { ID } from '../../types';
import type { Folder, NoteMeta } from '../model';
import { useLinkGraph, useLinks } from '../related';
import { GraphView, type ViewLink, type ViewNode } from './graphView';

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

interface Props {
  /** заметки на графе (уже отфильтрованы по папке) */
  notes: NoteMeta[];
  folders: Folder[];
  /** найденные поиском — подсвечиваются */
  highlight: Set<ID> | null;
  /** выделить и показать эту заметку («Показать на графе») */
  focusId: ID | null;
  onFocused: () => void;
  onOpen: (id: ID) => void;
  onSelect?: (id: ID | null) => void;
}

/** Граф заметок: узлы — заметки, линии — связи, найденные автоматически по общим темам */
export function NotesGraph({ notes, folders, highlight, focusId, onFocused, onOpen, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<GraphView | null>(null);
  const [sel, setSel] = useState<ID | null>(null);
  const [orphans, setOrphans] = useState(() => readLS('sm-graph-orphans', true));
  const { ix, edges, progress } = useLinkGraph();
  const analysing = useLinks((s) => s.progress);

  const select = (id: ID | null) => {
    setSel(id);
    onSelect?.(id);
  };
  const cbRef = useRef({ select, onOpen });
  useEffect(() => {
    cbRef.current = { select, onOpen };
  });

  useEffect(() => {
    const v = new GraphView(canvasRef.current!, { onSelect: (id) => cbRef.current.select(id), onOpen: (id) => cbRef.current.onOpen(id) });
    viewRef.current = v;
    return () => {
      v.destroy();
      viewRef.current = null;
    };
  }, []);

  // узлы и связи для показа (подпись — чтобы новый массив тех же заметок не пересобирал граф)
  const notesKey = notes.map((n) => `${n.id}:${n.folderId ?? ''}:${n.title}:${n.preview.slice(0, 40)}`).join('|');
  const foldersKey = folders.map((f) => f.id + f.color).join('|');
  const model = useMemo(() => {
    const folderColor = new Map(folders.map((f) => [f.id, f.color]));
    const inSet = new Set(notes.map((n) => n.id));
    const links: ViewLink[] = (edges ?? []).filter((e) => inSet.has(e.a) && inSet.has(e.b)).map((e) => ({ a: e.a, b: e.b, w: e.score }));
    const deg = new Map<ID, number>();
    for (const l of links) {
      deg.set(l.a, (deg.get(l.a) ?? 0) + 1);
      deg.set(l.b, (deg.get(l.b) ?? 0) + 1);
    }
    const list: ViewNode[] = notes
      // заметки без текста (пустые) не показываем; одиночки — по желанию
      .filter((n) => (!ix || ix.docs.has(n.id)) && (orphans || deg.has(n.id)))
      .map((n) => ({ id: n.id, label: n.title || n.preview.slice(0, 40) || 'Без названия', color: (n.folderId && folderColor.get(n.folderId)) || 'var(--accent)' }));
    return { list, links, deg, total: notes.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, foldersKey, edges, ix, orphans]);

  // canvas не понимает var(...) — подставляем акцент из CSS
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !edges) return;
    const accent = getComputedStyle(canvasRef.current!).getPropertyValue('--accent').trim() || '#007aff';
    v.setData(
      model.list.map((n) => (n.color.startsWith('var(') ? { ...n, color: accent } : n)),
      model.links,
    );
  }, [model, edges]);

  useEffect(() => viewRef.current?.setHighlight(highlight), [highlight]);

  // «Показать на графе»
  useEffect(() => {
    const v = viewRef.current;
    if (!focusId || !v || !edges) return;
    if (!v.has(focusId) && !orphans) {
      setOrphans(true);
      return;
    }
    v.select(focusId, true);
    setSel(v.has(focusId) ? focusId : null);
    onSelect?.(v.has(focusId) ? focusId : null);
    onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, edges, model]);

  // выбранная заметка исчезла (удалена, отфильтрована)
  const selMeta = sel ? notes.find((n) => n.id === sel) : undefined;
  useEffect(() => {
    if (sel && !model.list.some((n) => n.id === sel)) select(null);
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

  const pick = (id: ID) => {
    viewRef.current?.select(id, true);
    select(id);
  };

  const busy = !edges || progress !== null || !!analysing;
  const folder = selMeta?.folderId ? folders.find((f) => f.id === selMeta.folderId) : undefined;
  const titleOf = (id: ID) => {
    const m = notes.find((n) => n.id === id);
    return m ? m.title || m.preview.slice(0, 40) || 'Без названия' : '';
  };

  return (
    <div className="nt-graph">
      <canvas ref={canvasRef} className="nt-graph-canvas" aria-label="Граф связей между заметками" />

      <div className="nt-graph-bar">
        <span className="nt-graph-stat">
          <Waypoints size={15} />
          {model.list.length} {plural(model.list.length, 'заметка', 'заметки', 'заметок')} · {model.links.length} {plural(model.links.length, 'связь', 'связи', 'связей')}
        </span>
        <button className={`nt-graph-chip${orphans ? ' active' : ''}`} onClick={toggleOrphans} aria-pressed={orphans} title="Показывать заметки без связей">
          <CircleDot size={14} /> Одиночные
        </button>
      </div>

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

      {busy && (
        <div className="nt-graph-busy">
          <div className="nt-rel-bar">
            <span style={{ width: `${Math.round((analysing ? analysing.done / Math.max(1, analysing.total) : (progress ?? 0)) * 100)}%` }} />
          </div>
          <span className="faint tiny">{analysing ? `Анализирую заметки… ${analysing.done} из ${analysing.total}` : 'Ищу связи…'}</span>
        </div>
      )}

      {!busy && model.list.length === 0 && (
        <div className="nt-graph-empty">
          <Waypoints size={36} />
          <div>{model.total === 0 ? 'Здесь пока нет заметок' : 'Связей пока нет. Они появятся сами, когда одни и те же темы встретятся в разных заметках.'}</div>
          {model.total > 0 && !orphans && (
            <button className="btn btn-sm" onClick={toggleOrphans}>
              Показать все заметки
            </button>
          )}
        </div>
      )}

      {selMeta && (
        <div className="nt-graph-card" style={folder ? ({ '--fc': folder.color } as CSSProperties) : undefined}>
          <div className="nt-graph-card-top">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="nt-graph-card-title">{selMeta.title || 'Без названия'}</div>
              <div className="nt-graph-card-meta">
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
          {selMeta.preview && <div className="nt-graph-card-prev">{selMeta.preview}</div>}
          {neighbors.length > 0 && (
            <div className="nt-graph-card-nb">
              {neighbors.slice(0, 6).map((nb) => (
                <button key={nb.id} className="nt-rel-chip nt-graph-nb" onClick={() => pick(nb.id)}>
                  {titleOf(nb.id)}
                </button>
              ))}
            </div>
          )}
          <button className="btn btn-primary nt-graph-open" onClick={() => onOpen(selMeta.id)}>
            Открыть заметку <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
