import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import {
  CalendarDays,
  Check,
  Ellipsis,
  ExternalLink,
  GripVertical,
  ListChecks,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  ArrowRight,
  AlignLeft,
} from 'lucide-react';
import type { BoardCard, BoardColumn, BoardData, TaskInfo, TaskStatus } from '../types';
import { DEFAULT_BOARD, loadAllDocs, loadBoard, saveBoard } from '../store/db';
import { collectMapTasks, dueState, formatShortDate, PRIORITY_META, updateMapTask } from '../utils/mapTasks';
import type { MapTask } from '../utils/mapTasks';
import { uid } from '../utils/tree';
import { openDoc } from '../actions';
import { askText, confirmDialog } from '../ui/dialogs';
import { toast } from '../store/appStore';
import './views.css';
import { IconTile } from '../ui/icons';

// ---------- Типы и константы ----------

type DragKind = 'card' | 'map';

interface DragInfo {
  kind: DragKind;
  id: string;
  x: number;
  y: number;
  offX: number;
  offY: number;
  w: number;
}

interface DropTarget {
  colId: string;
  /** индекс среди видимых карточек колонки (без перетаскиваемой) */
  index: number;
}

type MenuEntry =
  | { kind?: 'item'; label: string; icon?: ReactNode; danger?: boolean; active?: boolean; onClick: () => void }
  | { kind: 'sep' }
  | { kind: 'header'; label: string }
  | { kind: 'colors'; value?: string; onPick: (c: string) => void };

interface MenuState {
  anchor: DOMRect;
  entries: MenuEntry[];
}

const COLORS = ['#64748b', '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];

const STATUS_FALLBACK: Record<TaskStatus, string> = { todo: 'К выполнению', doing: 'В работе', done: 'Готово' };

const mapKey = (t: MapTask) => `${t.docId}:${t.topicId}`;

type PrioFilter = 'all' | '0' | '1' | '2' | '3';
type SourceFilter = 'all' | 'board' | 'maps';

function normalize(b: BoardData): BoardData {
  const columns = b.columns?.length ? b.columns : structuredClone(DEFAULT_BOARD.columns);
  const ids = new Set(columns.map((c) => c.id));
  // повреждённые записи (без id или названия) не должны ронять доску на поиске и сортировке
  const cards = (b.cards ?? [])
    .filter((c) => c && typeof c.id === 'string')
    .map((c) => ({ ...c, title: typeof c.title === 'string' ? c.title : '', order: Number.isFinite(c.order) ? c.order : 0 }))
    .map((c) => (ids.has(c.columnId) ? c : { ...c, columnId: columns[0].id }));
  return { columns, cards };
}

function sortMapTasks(a: MapTask, b: MapTask) {
  const da = a.task.due ?? '9999';
  const db = b.task.due ?? '9999';
  if (da !== db) return da < db ? -1 : 1;
  return (a.task.priority || 9) - (b.task.priority || 9);
}

// ---------- Доска ----------

export default function Board() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const boardRef = useRef<BoardData | null>(null);
  const [mapTasks, setMapTasks] = useState<MapTask[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(false);

  const [query, setQuery] = useState('');
  const [prio, setPrio] = useState<PrioFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');

  const [editCardId, setEditCardId] = useState<string | null>(null);
  const [editMapKey, setEditMapKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [addingIn, setAddingIn] = useState<string | null>(null);

  const [drag, setDrag] = useState<DragInfo | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  // ----- загрузка / сохранение -----

  const commit = useCallback((b: BoardData) => {
    boardRef.current = b;
    setBoard(b);
    saveBoard(b)
      .then((saved) => {
        // пришедшее с другого устройства — показать, если здесь за это время ничего не меняли
        if (boardRef.current === b) {
          const n = normalize(saved);
          boardRef.current = n;
          setBoard(n);
        }
      })
      .catch(() => toast('Не удалось сохранить доску'));
  }, []);

  const reloadMaps = useCallback(async () => {
    setLoadingMaps(true);
    try {
      setMapTasks(collectMapTasks(await loadAllDocs()));
    } finally {
      setLoadingMaps(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    loadBoard().then((b) => {
      if (!alive) return;
      const n = normalize(b);
      boardRef.current = n;
      setBoard(n);
    });
    reloadMaps();
    // доска изменилась на другом устройстве — перечитать
    const onRemote = () =>
      void loadBoard().then((b) => {
        if (!alive) return;
        const n = normalize(b);
        boardRef.current = n;
        setBoard(n);
      });
    window.addEventListener('sm-board-changed', onRemote);
    return () => {
      alive = false;
      window.removeEventListener('sm-board-changed', onRemote);
    };
  }, [reloadMaps]);

  // ----- фильтрация -----

  const q = query.trim().toLowerCase();
  const matchPrio = useCallback((p?: number) => prio === 'all' || String(p ?? 0) === prio, [prio]);

  const columnsData = useMemo(() => {
    if (!board) return [];
    const cardOk = (c: BoardCard) =>
      source !== 'maps' &&
      matchPrio(c.priority) &&
      (!q ||
        c.title.toLowerCase().includes(q) ||
        !!c.description?.toLowerCase().includes(q) ||
        !!c.labels?.some((l) => l.toLowerCase().includes(q)));
    const mapOk = (t: MapTask) =>
      source !== 'board' &&
      matchPrio(t.task.priority) &&
      (!q || t.text.toLowerCase().includes(q) || t.docTitle.toLowerCase().includes(q) || t.path.some((p) => p.toLowerCase().includes(q)));
    return board.columns.map((col) => ({
      col,
      cards: board.cards
        .filter((c) => c.columnId === col.id)
        .sort((a, b) => a.order - b.order)
        .filter(cardOk),
      maps: col.status ? mapTasks.filter((t) => t.task.status === col.status && mapOk(t)).sort(sortMapTasks) : [],
    }));
  }, [board, mapTasks, q, source, matchPrio]);

  const allLabels = useMemo(() => {
    const s = new Set<string>();
    board?.cards.forEach((c) => c.labels?.forEach((l) => s.add(l)));
    return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [board]);

  // ----- операции с карточками -----

  const patchCard = useCallback(
    (id: string, patch: Partial<BoardCard>) => {
      const b = boardRef.current;
      if (!b) return;
      commit({ ...b, cards: b.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    },
    [commit],
  );

  const addCard = (colId: string, title: string) => {
    const b = boardRef.current;
    if (!b || !title.trim()) return;
    const max = b.cards.filter((c) => c.columnId === colId).reduce((m, c) => Math.max(m, c.order), -1);
    const card: BoardCard = { id: uid(), columnId: colId, title: title.trim(), order: max + 1, createdAt: Date.now() };
    commit({ ...b, cards: [...b.cards, card] });
  };

  /** Удалить сразу — с «Вернуть» в течение нескольких секунд */
  const deleteCard = (id: string) => {
    const b = boardRef.current;
    const card = b?.cards.find((c) => c.id === id);
    if (!b || !card) return;
    commit({ ...b, cards: b.cards.filter((c) => c.id !== id) });
    setEditCardId(null);
    toast(`«${card.title}» удалена`, {
      label: 'Вернуть',
      run: () => {
        const cur = boardRef.current;
        if (!cur || cur.cards.some((c) => c.id === id)) return;
        // колонку могли удалить — тогда в первую
        const columnId = cur.columns.some((c) => c.id === card.columnId) ? card.columnId : cur.columns[0]?.id;
        // свежая отметка — карточка побеждает отметку об удалении и на других устройствах
        if (columnId) commit({ ...cur, cards: [...cur.cards, { ...card, columnId, updatedAt: Date.now() }] });
      },
    });
  };

  /** Переместить карточку в колонку на позицию visIndex среди видимых карточек (-1 — в конец) */
  const moveCard = (cardId: string, colId: string, visIndex: number) => {
    const b = boardRef.current;
    if (!b) return;
    const card = b.cards.find((c) => c.id === cardId);
    if (!card) return;
    const visible = (columnsData.find((d) => d.col.id === colId)?.cards ?? []).filter((c) => c.id !== cardId);
    const full = b.cards.filter((c) => c.columnId === colId && c.id !== cardId).sort((x, y) => x.order - y.order);
    let at = full.length;
    if (visIndex >= 0 && visible.length) {
      if (visIndex < visible.length) at = full.findIndex((c) => c.id === visible[visIndex].id);
      else at = full.findIndex((c) => c.id === visible[visible.length - 1].id) + 1;
      if (at < 0) at = full.length;
    }
    full.splice(at, 0, { ...card, columnId: colId });
    const order: Record<string, number> = {};
    full.forEach((c, i) => (order[c.id] = i));
    commit({
      ...b,
      cards: b.cards.map((c) => (c.id in order ? { ...c, columnId: colId, order: order[c.id] } : c)),
    });
  };

  // ----- операции с задачами из карт -----

  const saveMapTask = async (t: MapTask, patch: Partial<TaskInfo>) => {
    const key = mapKey(t);
    setMapTasks((ts) => ts.map((x) => (mapKey(x) === key ? { ...x, task: { ...x.task, ...patch } } : x)));
    try {
      await updateMapTask(t.docId, t.topicId, patch);
    } catch {
      toast('Не удалось обновить задачу в карте');
    }
  };

  const setMapStatus = (t: MapTask, status: TaskStatus) => {
    const patch: Partial<TaskInfo> = { status };
    if (status === 'done') patch.progress = 100;
    saveMapTask(t, patch);
  };

  const moveMapTo = (t: MapTask, col: BoardColumn) => {
    if (!col.status) {
      toast('Задачи из карт можно переносить только в колонки со статусом');
      return;
    }
    if (col.status !== t.task.status) setMapStatus(t, col.status);
  };

  // ----- колонки -----

  const addColumn = async () => {
    const title = await askText('Новая колонка', { placeholder: 'Название колонки', okText: 'Создать' });
    if (!title?.trim()) return;
    const b = boardRef.current!;
    const color = COLORS[(b.columns.length * 3) % COLORS.length];
    commit({ ...b, columns: [...b.columns, { id: uid(), title: title.trim(), color }] });
    setTimeout(() => scrollerRef.current?.scrollTo({ left: scrollerRef.current.scrollWidth, behavior: 'smooth' }), 50);
  };

  const patchColumn = (id: string, patch: Partial<BoardColumn>) => {
    const b = boardRef.current!;
    commit({ ...b, columns: b.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };

  const renameColumn = async (col: BoardColumn) => {
    const title = await askText('Переименовать колонку', { value: col.title, okText: 'Сохранить' });
    if (title?.trim()) patchColumn(col.id, { title: title.trim() });
  };

  const deleteColumn = async (col: BoardColumn) => {
    const b = boardRef.current!;
    const n = b.cards.filter((c) => c.columnId === col.id).length;
    const target = b.columns.find((c) => c.id !== col.id);
    if (!target) return;
    const ok = await confirmDialog(
      `Удалить колонку «${col.title}»?`,
      n ? `Карточки (${n}) будут перенесены в «${target.title}».` : undefined,
      { okText: 'Удалить', danger: true },
    );
    if (!ok) return;
    const cur = boardRef.current!;
    const maxT = cur.cards.filter((c) => c.columnId === target.id).reduce((m, c) => Math.max(m, c.order), -1);
    let k = 0;
    commit({
      columns: cur.columns.filter((c) => c.id !== col.id),
      cards: cur.cards.map((c) => (c.columnId === col.id ? { ...c, columnId: target.id, order: maxT + 1 + k++ } : c)),
    });
  };

  // ----- меню -----

  const openMenu = (e: ReactMouseEvent, entries: MenuEntry[]) => {
    e.stopPropagation();
    setMenu({ anchor: (e.currentTarget as HTMLElement).getBoundingClientRect(), entries });
  };

  const cardMenu = (e: ReactMouseEvent, card: BoardCard) => {
    const cols = boardRef.current?.columns ?? [];
    openMenu(e, [
      { label: 'Редактировать', icon: <Pencil />, onClick: () => setEditCardId(card.id) },
      { kind: 'header', label: 'Переместить в…' },
      ...cols.map(
        (c): MenuEntry => ({
          label: c.title,
          icon: <span className="kb-dot" style={{ background: c.color ?? 'var(--text-3)' }} />,
          active: c.id === card.columnId,
          onClick: () => c.id !== card.columnId && moveCard(card.id, c.id, -1),
        }),
      ),
      { kind: 'sep' },
      { label: 'Удалить', icon: <Trash2 />, danger: true, onClick: () => deleteCard(card.id) },
    ]);
  };

  const mapMenu = (e: ReactMouseEvent, t: MapTask) => {
    const cols = (boardRef.current?.columns ?? []).filter((c) => c.status);
    openMenu(e, [
      { label: 'Изменить задачу', icon: <Pencil />, onClick: () => setEditMapKey(mapKey(t)) },
      { label: 'Открыть в карте', icon: <ExternalLink />, onClick: () => openDoc(t.docId, t.topicId) },
      { kind: 'header', label: 'Переместить в…' },
      ...cols.map(
        (c): MenuEntry => ({
          label: c.title,
          icon: <span className="kb-dot" style={{ background: c.color ?? 'var(--text-3)' }} />,
          active: c.status === t.task.status,
          onClick: () => moveMapTo(t, c),
        }),
      ),
    ]);
  };

  const columnMenu = (e: ReactMouseEvent, col: BoardColumn) => {
    openMenu(e, [
      { label: 'Добавить карточку', icon: <Plus />, onClick: () => setAddingIn(col.id) },
      { label: 'Переименовать', icon: <Pencil />, onClick: () => renameColumn(col) },
      { kind: 'header', label: 'Цвет' },
      { kind: 'colors', value: col.color, onPick: (c) => patchColumn(col.id, { color: c }) },
      ...(col.status
        ? []
        : ([{ kind: 'sep' }, { label: 'Удалить колонку', icon: <Trash2 />, danger: true, onClick: () => deleteColumn(col) }] as MenuEntry[])),
    ]);
  };

  // ---------- Перетаскивание (pointer events: мышь, касание, перо) ----------

  const dragRef = useRef<{ info: DragInfo; pointerId: number } | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const pendingRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    el: HTMLElement;
    kind: DragKind;
    id: string;
    mouse: boolean;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const computeDrop = useCallback((x: number, y: number) => {
    const d = dragRef.current;
    if (!d) return;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const colEl = el?.closest<HTMLElement>('[data-col-id]');
    let next: DropTarget | null = null;
    if (colEl) {
      const colId = colEl.dataset.colId!;
      let index = 0;
      if (d.info.kind === 'card') {
        colEl.querySelectorAll<HTMLElement>('[data-drag-kind="card"]').forEach((c) => {
          if (c.dataset.dragId === d.info.id) return;
          const r = c.getBoundingClientRect();
          if (r.top + r.height / 2 < y) index++;
        });
      }
      next = { colId, index };
    }
    const prev = dropRef.current;
    if (prev?.colId !== next?.colId || prev?.index !== next?.index) {
      dropRef.current = next;
      setDrop(next);
    }
  }, []);

  const positionGhost = (x: number, y: number) => {
    const d = dragRef.current;
    const g = ghostRef.current;
    if (!d || !g) return;
    g.style.transform = `translate3d(${x - d.info.offX}px, ${y - d.info.offY}px, 0) rotate(2deg)`;
  };

  const startDrag = (el: HTMLElement, kind: DragKind, id: string, x: number, y: number, pointerId: number) => {
    const r = el.getBoundingClientRect();
    const info: DragInfo = { kind, id, x, y, offX: x - r.left, offY: y - r.top, w: r.width };
    dragRef.current = { info, pointerId };
    pointerRef.current = { x, y };
    suppressClickRef.current = true;
    setDrag(info);
    setMenu(null);
    computeDrop(x, y);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* не поддерживается */
    }
  };

  // актуальные обработчики для глобальных слушателей
  const latest = useRef({ finish: () => {} });
  latest.current.finish = () => {
    const d = dragRef.current;
    const t = dropRef.current;
    const b = boardRef.current;
    if (!d || !t || !b) return;
    const col = b.columns.find((c) => c.id === t.colId);
    if (!col) return;
    if (d.info.kind === 'card') moveCard(d.info.id, t.colId, t.index);
    else {
      const task = mapTasks.find((m) => mapKey(m) === d.info.id);
      if (task) moveMapTo(task, col);
    }
  };

  const onItemPointerDown = (e: ReactPointerEvent<HTMLElement>, kind: DragKind, id: string) => {
    if (dragRef.current) return;
    const target = e.target as HTMLElement;
    const viaHandle = !!target.closest('[data-drag-handle]');
    if (!viaHandle && target.closest('[data-nodrag]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.currentTarget;
    if (viaHandle) {
      e.preventDefault();
      startDrag(el, kind, id, e.clientX, e.clientY, e.pointerId);
      return;
    }
    const mouse = e.pointerType === 'mouse';
    const p = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, el, kind, id, mouse } as NonNullable<typeof pendingRef.current>;
    if (!mouse) {
      // долгое нажатие на сенсорном экране
      p.timer = setTimeout(() => {
        if (pendingRef.current !== p) return;
        pendingRef.current = null;
        startDrag(el, kind, id, pointerRef.current.x, pointerRef.current.y, p.pointerId);
      }, 380);
    }
    pointerRef.current = { x: e.clientX, y: e.clientY };
    pendingRef.current = p;
  };

  useEffect(() => {
    const clearPending = () => {
      const p = pendingRef.current;
      if (p?.timer) clearTimeout(p.timer);
      pendingRef.current = null;
    };
    const endDrag = (commitDrop: boolean) => {
      if (commitDrop) latest.current.finish();
      dragRef.current = null;
      dropRef.current = null;
      setDrag(null);
      setDrop(null);
      setTimeout(() => (suppressClickRef.current = false), 60);
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) {
        if (e.pointerId !== d.pointerId) return;
        pointerRef.current = { x: e.clientX, y: e.clientY };
        positionGhost(e.clientX, e.clientY);
        computeDrop(e.clientX, e.clientY);
        return;
      }
      const p = pendingRef.current;
      if (!p || p.pointerId !== e.pointerId) return;
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
      if (p.mouse && dist > 5) {
        clearPending();
        startDrag(p.el, p.kind, p.id, e.clientX, e.clientY, p.pointerId);
      } else if (!p.mouse && dist > 8) clearPending();
    };
    const onUp = (e: PointerEvent) => {
      const p = pendingRef.current;
      if (p && p.pointerId === e.pointerId) clearPending();
      const d = dragRef.current;
      if (d && d.pointerId === e.pointerId) endDrag(e.type === 'pointerup');
    };
    const onTouchMove = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) endDrag(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      clearPending();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('touchmove', onTouchMove);
    };
  }, [computeDrop]);

  // автопрокрутка у краёв во время перетаскивания
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    let lastStep = 0;
    const tick = () => {
      const { x, y } = pointerRef.current;
      const sc = scrollerRef.current;
      let moved = false;
      if (sc) {
        // у края — перелистываем ровно на одну колонку, с паузой, чтобы карточку можно было «положить»
        const r = sc.getBoundingClientRect();
        const edge = Math.min(48, r.width * 0.1);
        const now = performance.now();
        const col = sc.querySelector<HTMLElement>('[data-col-id]');
        const step = col ? col.offsetWidth + 12 : r.width * 0.8;
        const dir = x < r.left + edge ? -1 : x > r.right - edge ? 1 : 0;
        if (dir && now - lastStep > 900) {
          sc.scrollBy({ left: dir * step, behavior: 'smooth' });
          lastStep = now;
          moved = true;
        }
      }
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const list = el?.closest<HTMLElement>('[data-col-id]')?.querySelector<HTMLElement>('[data-col-list]');
      if (list) {
        const r = list.getBoundingClientRect();
        if (y < r.top + 40) {
          list.scrollTop -= 10;
          moved = true;
        } else if (y > r.bottom - 40) {
          list.scrollTop += 10;
          moved = true;
        }
      }
      if (moved) computeDrop(x, y);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging, computeDrop]);

  // ---------- Рендер ----------

  if (!board) {
    return (
      <div className="page kb-page">
        <div className="page-header">
          <IconTile section="board" size="sm" className="ph-tile" />
          <h1>Доска задач</h1>
        </div>
        <div className="page-body">
          <div className="empty">Загрузка…</div>
        </div>
      </div>
    );
  }

  const editCard = editCardId ? board.cards.find((c) => c.id === editCardId) : undefined;
  const editMap = editMapKey ? mapTasks.find((t) => mapKey(t) === editMapKey) : undefined;
  const statusTitle = (s: TaskStatus) => board.columns.find((c) => c.status === s)?.title ?? STATUS_FALLBACK[s];
  const filtersActive = !!q || prio !== 'all' || source !== 'all';

  const ghostItem = drag
    ? drag.kind === 'card'
      ? board.cards.find((c) => c.id === drag.id)
      : mapTasks.find((t) => mapKey(t) === drag.id)
    : undefined;
  const dragMap = drag?.kind === 'map' ? mapTasks.find((t) => mapKey(t) === drag.id) : undefined;

  const onCardClick = (fn: () => void) => () => {
    if (suppressClickRef.current) return;
    fn();
  };

  return (
    <div className="page kb-page">
      <div className="page-header">
        <IconTile section="board" size="sm" className="ph-tile" />
        <h1>Доска задач</h1>
        <div className="grow" />
        <div className="row">
          <button className="icon-btn" title="Обновить задачи из карт" onClick={reloadMaps} disabled={loadingMaps}>
            <RefreshCw className={loadingMaps ? 'spin' : undefined} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={addColumn}>
            <Plus size={16} /> <span className="kb-hide-xs">Колонка</span>
          </button>
        </div>
      </div>

      <div className="kb-toolbar">
        <div className="kb-search">
          <Search size={16} />
          <input className="input" placeholder="Поиск по задачам" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="kb-search-clear" onClick={() => setQuery('')} aria-label="Очистить">
              <X size={14} />
            </button>
          )}
        </div>
        <select className="select kb-prio-select" value={prio} onChange={(e) => setPrio(e.target.value as PrioFilter)}>
          <option value="all">Любой приоритет</option>
          <option value="1">Высокий</option>
          <option value="2">Средний</option>
          <option value="3">Низкий</option>
          <option value="0">Без приоритета</option>
        </select>
        <div className="segmented">
          {(
            [
              ['all', 'Все'],
              ['board', 'Доска'],
              ['maps', 'Из карт'],
            ] as [SourceFilter, string][]
          ).map(([v, l]) => (
            <button key={v} className={source === v ? 'active' : ''} onClick={() => setSource(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="page-body kb-body">
        <div ref={scrollerRef} className={`kb-columns${drag ? ' is-dragging' : ''}`}>
          {columnsData.map(({ col, cards, maps }) => {
            const over = drop?.colId === col.id;
            const deny = over && drag?.kind === 'map' && !col.status;
            const accept = over && !deny && !(drag?.kind === 'map' && dragMap?.task.status === col.status);
            let k = 0;
            const items: ReactNode[] = [];
            for (const card of cards) {
              const isDragged = drag?.kind === 'card' && drag.id === card.id;
              if (!isDragged) {
                if (over && drag?.kind === 'card' && drop!.index === k) items.push(<div key="drop" className="kb-drop-line" />);
                k++;
              }
              items.push(
                <CardItem
                  key={card.id}
                  card={card}
                  dragging={isDragged}
                  onPointerDown={(e) => onItemPointerDown(e, 'card', card.id)}
                  onClick={onCardClick(() => setEditCardId(card.id))}
                  onMenu={(e) => cardMenu(e, card)}
                />,
              );
            }
            if (over && drag?.kind === 'card' && drop!.index >= k) items.push(<div key="drop" className="kb-drop-line" />);
            for (const t of maps) {
              const key = mapKey(t);
              items.push(
                <MapItem
                  key={key}
                  task={t}
                  dragging={drag?.kind === 'map' && drag.id === key}
                  onPointerDown={(e) => onItemPointerDown(e, 'map', key)}
                  onClick={onCardClick(() => setEditMapKey(key))}
                  onMenu={(e) => mapMenu(e, t)}
                />,
              );
            }
            const count = cards.length + maps.length;
            return (
              <section
                key={col.id}
                data-col-id={col.id}
                className={`kb-col${accept ? ' is-over' : ''}${deny ? ' is-deny' : ''}`}
                style={{ ['--col' as string]: col.color ?? 'var(--text-3)' }}
              >
                <header className="kb-col-head">
                  <span className="kb-dot" style={{ background: 'var(--col)' }} />
                  <h2 className="kb-col-title ellipsis" onDoubleClick={() => renameColumn(col)} title={col.title}>
                    {col.title}
                  </h2>
                  <span className="badge">{count}</span>
                  <div className="grow" />
                  <button className="icon-btn kb-col-btn" onClick={() => setAddingIn(col.id)} title="Добавить карточку">
                    <Plus />
                  </button>
                  <button className="icon-btn kb-col-btn" onClick={(e) => columnMenu(e, col)} title="Действия с колонкой">
                    <Ellipsis />
                  </button>
                </header>
                <div className="kb-col-list" data-col-list>
                  {items}
                  {count === 0 && !(over && drag) && (
                    <div className="kb-col-empty">{filtersActive ? 'Ничего не найдено' : 'Пока пусто'}</div>
                  )}
                </div>
                <div className="kb-col-foot">
                  {addingIn === col.id ? (
                    <AddCardInput
                      onAdd={(text) => addCard(col.id, text)}
                      onClose={() => setAddingIn(null)}
                    />
                  ) : (
                    <button className="kb-add-btn" onClick={() => setAddingIn(col.id)}>
                      <Plus size={16} /> Добавить карточку
                    </button>
                  )}
                </div>
              </section>
            );
          })}
          <button className="kb-new-col" onClick={addColumn}>
            <Plus size={18} /> Новая колонка
          </button>
        </div>
      </div>

      {drag && ghostItem && (
        <div
          ref={(el) => {
            ghostRef.current = el;
            if (el && dragRef.current) positionGhost(pointerRef.current.x, pointerRef.current.y);
          }}
          className="kb-ghost"
          style={{ width: drag.w }}
        >
          {drag.kind === 'card' ? (
            <CardItem card={ghostItem as BoardCard} ghost />
          ) : (
            <MapItem task={ghostItem as MapTask} ghost />
          )}
        </div>
      )}

      {menu && <PopMenu state={menu} onClose={() => setMenu(null)} />}

      {editCard && (
        <CardModal
          card={editCard}
          columns={board.columns}
          allLabels={allLabels}
          onPatch={(p) => patchCard(editCard.id, p)}
          onMove={(colId) => moveCard(editCard.id, colId, -1)}
          onDelete={() => deleteCard(editCard.id)}
          onClose={() => {
            const c = boardRef.current?.cards.find((x) => x.id === editCard.id);
            if (c && !c.title.trim()) patchCard(c.id, { title: 'Без названия' });
            setEditCardId(null);
          }}
        />
      )}

      {editMap && (
        <MapTaskModal
          task={editMap}
          statusTitle={statusTitle}
          onSave={(info) => {
            saveMapTask(editMap, info);
            setEditMapKey(null);
          }}
          onClose={() => setEditMapKey(null)}
        />
      )}
    </div>
  );
}

// ---------- Карточки ----------

interface ItemHandlers {
  dragging?: boolean;
  ghost?: boolean;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick?: () => void;
  onMenu?: (e: ReactMouseEvent) => void;
}

function DueChip({ due, done }: { due: string; done?: boolean }) {
  const st = dueState(due, done);
  return (
    <span className={`kb-meta kb-due${st ? ' is-' + st : ''}`}>
      <CalendarDays size={13} />
      {st === 'today' ? 'Сегодня' : formatShortDate(due)}
    </span>
  );
}

function ItemShell({
  kind,
  id,
  priority,
  dragging,
  ghost,
  onPointerDown,
  onClick,
  onMenu,
  children,
}: ItemHandlers & { kind: DragKind; id: string; priority?: number; children: ReactNode }) {
  const pc = priority ? PRIORITY_META[priority]?.color : undefined;
  return (
    <article
      className={`kb-card${dragging ? ' is-dragging' : ''}${ghost ? ' is-ghost' : ''}`}
      data-drag-kind={ghost ? undefined : kind}
      data-drag-id={ghost ? undefined : id}
      style={pc ? { ['--prio' as string]: pc } : undefined}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      {pc && <span className="kb-prio-bar" />}
      <div className="kb-card-main">{children}</div>
      <div className="kb-card-side" data-nodrag>
        <button className="kb-card-btn" onClick={(e) => onMenu?.(e)} aria-label="Меню" data-nodrag>
          <Ellipsis size={16} />
        </button>
        <span className="kb-handle" data-drag-handle aria-label="Перетащить" title="Перетащить">
          <GripVertical size={16} />
        </span>
      </div>
    </article>
  );
}

function CardItem({ card, ...h }: ItemHandlers & { card: BoardCard }) {
  const total = card.checklist?.length ?? 0;
  const done = card.checklist?.filter((i) => i.done).length ?? 0;
  return (
    <ItemShell kind="card" id={card.id} priority={card.priority} {...h}>
      {!!card.labels?.length && (
        <div className="kb-labels">
          {card.labels.map((l) => (
            <span key={l} className="kb-label">
              {l}
            </span>
          ))}
        </div>
      )}
      <div className="kb-card-title">{card.title || 'Без названия'}</div>
      {(card.due || total > 0 || card.description || card.priority) && (
        <div className="kb-card-meta">
          {!!card.priority && PRIORITY_META[card.priority] && (
            <span className="kb-meta" style={{ color: PRIORITY_META[card.priority].color }}>
              <span className="kb-dot" style={{ background: PRIORITY_META[card.priority].color }} />
              {PRIORITY_META[card.priority].label}
            </span>
          )}
          {card.due && <DueChip due={card.due} done={total > 0 && done === total} />}
          {total > 0 && (
            <span className={`kb-meta${done === total ? ' is-done' : ''}`}>
              <ListChecks size={13} />
              {done}/{total}
            </span>
          )}
          {card.description && (
            <span className="kb-meta" title="Есть описание">
              <AlignLeft size={13} />
            </span>
          )}
        </div>
      )}
    </ItemShell>
  );
}

function MapItem({ task, ...h }: ItemHandlers & { task: MapTask }) {
  const t = task.task;
  const crumbs = task.path.length > 2 ? ['…', ...task.path.slice(-2)] : task.path;
  return (
    <ItemShell kind="map" id={mapKey(task)} priority={t.priority} {...h}>
      <div className="kb-map-badge" title={[task.docTitle, ...task.path].join(' › ')}>
        <Network size={12} />
        <span className="kb-map-doc ellipsis">{task.docTitle || 'Без названия'}</span>
        {crumbs.length > 0 && <span className="kb-map-path ellipsis">› {crumbs.join(' › ')}</span>}
      </div>
      <div className={`kb-card-title${t.status === 'done' ? ' is-done' : ''}`}>{task.text || 'Без названия'}</div>
      <div className="kb-card-meta">
        {!!t.priority && PRIORITY_META[t.priority] && (
          <span className="kb-meta" style={{ color: PRIORITY_META[t.priority].color }}>
            <span className="kb-dot" style={{ background: PRIORITY_META[t.priority].color }} />
            {PRIORITY_META[t.priority].label}
          </span>
        )}
        {t.due && <DueChip due={t.due} done={t.status === 'done'} />}
        {t.assignee && <span className="kb-meta">@{t.assignee}</span>}
        <button
          className="kb-meta kb-open-map"
          data-nodrag
          onClick={(e) => {
            e.stopPropagation();
            openDoc(task.docId, task.topicId);
          }}
        >
          <ExternalLink size={13} /> В карте
        </button>
      </div>
      {t.progress != null && t.progress > 0 && (
        <div className="kb-progress" title={`${t.progress}%`}>
          <span style={{ width: `${Math.min(100, t.progress)}%` }} />
        </div>
      )}
    </ItemShell>
  );
}

function AddCardInput({ onAdd, onClose }: { onAdd: (t: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  const submit = () => {
    if (text.trim()) onAdd(text);
    setText('');
    ref.current?.focus();
  };
  return (
    <div className="kb-add-form">
      <textarea
        ref={ref}
        className="textarea kb-add-text"
        rows={2}
        placeholder="Название карточки…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') onClose();
        }}
        onBlur={() => {
          if (!text.trim()) setTimeout(onClose, 120);
        }}
      />
      <div className="row">
        <button className="btn btn-primary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Добавить
        </button>
        <button className="icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={onClose} aria-label="Отмена">
          <X />
        </button>
      </div>
    </div>
  );
}

// ---------- Всплывающее меню ----------

function PopMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const a = state.anchor;
    let left = a.right - w;
    left = Math.max(8, Math.min(left, window.innerWidth - 8 - w));
    let top = a.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - 6 - h);
    setPos({ left, top });
  }, [state]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="kb-menu-backdrop" onPointerDown={onClose} />
      <div ref={ref} className="menu kb-menu" style={pos}>
        {state.entries.map((e, i) => {
          if (e.kind === 'sep') return <div key={i} className="sep" />;
          if (e.kind === 'header') return <div key={i} className="kb-menu-header">{e.label}</div>;
          if (e.kind === 'colors')
            return (
              <div key={i} className="kb-swatches">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`kb-swatch${e.value === c ? ' active' : ''}`}
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => {
                      e.onPick(c);
                      onClose();
                    }}
                  />
                ))}
              </div>
            );
          return (
            <button
              key={i}
              className={e.danger ? 'btn-danger' : undefined}
              onClick={() => {
                onClose();
                e.onClick();
              }}
            >
              <span className="kb-menu-icon">{e.icon}</span>
              <span className="grow ellipsis">{e.label}</span>
              {e.active && <Check size={16} className="kb-menu-check" />}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------- Приоритет ----------

function PrioritySelect({ value, onChange }: { value?: number; onChange: (v: number | undefined) => void }) {
  const opts: [number, string, string | undefined][] = [
    [0, 'Нет', undefined],
    [1, 'Высокий', PRIORITY_META[1].color],
    [2, 'Средний', PRIORITY_META[2].color],
    [3, 'Низкий', PRIORITY_META[3].color],
  ];
  return (
    <div className="segmented kb-prio-seg">
      {opts.map(([v, l, c]) => (
        <button key={v} className={(value ?? 0) === v ? 'active' : ''} onClick={() => onChange(v || undefined)}>
          {c && <span className="kb-dot" style={{ background: c }} />}
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------- Редактор карточки ----------

function CardModal({
  card,
  columns,
  allLabels,
  onPatch,
  onMove,
  onDelete,
  onClose,
}: {
  card: BoardCard;
  columns: BoardColumn[];
  allLabels: string[];
  onPatch: (p: Partial<BoardCard>) => void;
  onMove: (colId: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [labelText, setLabelText] = useState('');
  const [checkText, setCheckText] = useState('');
  const labels = card.labels ?? [];
  const checklist = card.checklist ?? [];
  const done = checklist.filter((i) => i.done).length;

  const addLabel = (l: string) => {
    const v = l.trim();
    if (!v || labels.includes(v)) return;
    onPatch({ labels: [...labels, v] });
  };
  const addCheck = () => {
    const v = checkText.trim();
    if (!v) return;
    onPatch({ checklist: [...checklist, { id: uid(), text: v, done: false }] });
    setCheckText('');
  };
  const suggestions = allLabels.filter((l) => !labels.includes(l)).slice(0, 8);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal kb-modal" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row kb-modal-top">
          <input
            className="kb-title-input"
            value={card.title}
            placeholder="Название карточки"
            onChange={(e) => onPatch({ title: e.target.value })}
            autoFocus={!card.title}
          />
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X />
          </button>
        </div>

        <div className="kb-grid">
          <div>
            <label className="label">Колонка</label>
            <select className="select" value={card.columnId} onChange={(e) => onMove(e.target.value)}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Срок</label>
            <div className="row">
              <input
                type="date"
                className={`input kb-date${dueState(card.due) ? ' is-' + dueState(card.due) : ''}`}
                value={card.due ?? ''}
                onChange={(e) => onPatch({ due: e.target.value || undefined })}
              />
              {card.due && (
                <button className="icon-btn" onClick={() => onPatch({ due: undefined })} aria-label="Убрать срок">
                  <X />
                </button>
              )}
            </div>
          </div>
        </div>

        <label className="label">Приоритет</label>
        <PrioritySelect value={card.priority} onChange={(v) => onPatch({ priority: v })} />

        <label className="label">Описание</label>
        <textarea
          className="textarea"
          rows={3}
          placeholder="Подробности, ссылки, заметки…"
          value={card.description ?? ''}
          onChange={(e) => onPatch({ description: e.target.value || undefined })}
        />

        <label className="label">Метки</label>
        <div className="kb-label-edit">
          {labels.map((l) => (
            <span key={l} className="chip active">
              {l}
              <button className="kb-chip-x" onClick={() => onPatch({ labels: labels.filter((x) => x !== l) })} aria-label="Убрать метку">
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            className="input kb-inline-input"
            placeholder="Новая метка + Enter"
            value={labelText}
            onChange={(e) => setLabelText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLabel(labelText);
                setLabelText('');
              }
            }}
          />
        </div>
        {suggestions.length > 0 && (
          <div className="kb-label-suggest">
            {suggestions.map((l) => (
              <button key={l} className="chip" onClick={() => addLabel(l)}>
                <Plus size={12} />
                {l}
              </button>
            ))}
          </div>
        )}

        <label className="label">
          Чек-лист {checklist.length > 0 && <span className="faint">· {done}/{checklist.length}</span>}
        </label>
        {checklist.length > 0 && (
          <div className="kb-progress kb-progress-lg">
            <span style={{ width: `${(done / checklist.length) * 100}%` }} />
          </div>
        )}
        <div className="kb-checklist">
          {checklist.map((it) => (
            <div key={it.id} className={`kb-check-row${it.done ? ' is-done' : ''}`}>
              <button
                className={`kb-check${it.done ? ' on' : ''}`}
                onClick={() => onPatch({ checklist: checklist.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)) })}
                aria-label={it.done ? 'Снять отметку' : 'Отметить'}
              >
                {it.done && <Check size={13} strokeWidth={3} />}
              </button>
              <input
                className="kb-check-text"
                value={it.text}
                onChange={(e) => onPatch({ checklist: checklist.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)) })}
              />
              <button className="icon-btn kb-check-del" onClick={() => onPatch({ checklist: checklist.filter((x) => x.id !== it.id) })} aria-label="Удалить пункт">
                <Trash2 />
              </button>
            </div>
          ))}
          <div className="row">
            <input
              className="input"
              placeholder="Добавить пункт"
              value={checkText}
              onChange={(e) => setCheckText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCheck();
                }
              }}
            />
            <button className="btn btn-sm" onClick={addCheck} disabled={!checkText.trim()}>
              <Plus size={15} />
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost btn-danger" onClick={onDelete}>
            <Trash2 size={16} /> Удалить
          </button>
          <div className="grow" />
          <button className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Редактор задачи из карты ----------

function MapTaskModal({
  task,
  statusTitle,
  onSave,
  onClose,
}: {
  task: MapTask;
  statusTitle: (s: TaskStatus) => string;
  onSave: (t: TaskInfo) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TaskInfo>({ ...task.task });
  const set = (p: Partial<TaskInfo>) => setDraft((d) => ({ ...d, ...p }));
  const progress = draft.progress ?? 0;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal kb-modal" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row kb-modal-top">
          <div className="grow">
            <div className="kb-map-badge">
              <Network size={12} />
              <span className="kb-map-doc ellipsis">{task.docTitle || 'Без названия'}</span>
              {task.path.length > 0 && <span className="kb-map-path ellipsis">› {task.path.join(' › ')}</span>}
            </div>
            <h2 className="kb-map-title">{task.text || 'Без названия'}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X />
          </button>
        </div>

        <label className="label">Статус</label>
        <div className="segmented kb-status-seg">
          {(['todo', 'doing', 'done'] as TaskStatus[]).map((s) => (
            <button
              key={s}
              className={draft.status === s ? 'active' : ''}
              onClick={() => set(s === 'done' ? { status: s, progress: 100 } : { status: s })}
            >
              {statusTitle(s)}
            </button>
          ))}
        </div>

        <label className="label">Приоритет</label>
        <PrioritySelect value={draft.priority} onChange={(v) => set({ priority: v })} />

        <label className="label">Срок</label>
        <div className="row">
          <input
            type="date"
            className={`input kb-date${dueState(draft.due, draft.status === 'done') ? ' is-' + dueState(draft.due, draft.status === 'done') : ''}`}
            value={draft.due ?? ''}
            onChange={(e) => set({ due: e.target.value || undefined })}
          />
          {draft.due && (
            <button className="icon-btn" onClick={() => set({ due: undefined })} aria-label="Убрать срок">
              <X />
            </button>
          )}
        </div>

        <label className="label">
          Прогресс <span className="faint">· {progress}%</span>
        </label>
        <input
          type="range"
          className="kb-range"
          min={0}
          max={100}
          step={5}
          value={progress}
          style={{ ['--p' as string]: `${progress}%` }}
          onChange={(e) => set({ progress: Number(e.target.value) })}
        />

        <div className="modal-actions kb-modal-actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              onClose();
              openDoc(task.docId, task.topicId);
            }}
          >
            <ArrowRight size={16} /> Открыть в карте
          </button>
          <div className="grow" />
          <button className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => onSave(draft)}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
