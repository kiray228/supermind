import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import type { ID, Sheet } from '../types';
import { layoutSheet, subtreeBounds, type LayoutResult, type LNode } from '../layout/layout';
import { useDoc } from '../store/docStore';
import { BoundaryView, NodeView, RelationshipView, SummaryView, Toggle } from './render';
import { fontString, FONT_FAMILY } from '../layout/measure';
import { isAncestor } from '../utils/tree';

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface MapCanvasHandle {
  fit(animate?: boolean): void;
  zoomBy(f: number): void;
  setZoom(k: number): void;
  centerOn(id: ID, zoom?: number): void;
  fitBounds(b: { x: number; y: number; w: number; h: number }, animate?: boolean, maxK?: number): void;
  svg(): SVGSVGElement | null;
  layout(): LayoutResult | null;
  view(): View;
  screenToWorld(x: number, y: number): { x: number; y: number };
}

interface Props {
  sheet: Sheet;
  /** режим создания связи: следующий клик по теме — цель */
  relMode: boolean;
  onRelTarget(id: ID): void;
  onContextMenu(e: { x: number; y: number; topicId: ID | null; worldX: number; worldY: number }): void;
  onOpenNote(id: ID): void;
  onOpenLink(url: string): void;
  /** презентация: id видимого поддерева (остальное приглушено) */
  pitchFocus?: ID | null;
  readOnly?: boolean;
  searchHits?: Set<ID>;
  onViewChange?(v: View): void;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean; onTopic?: boolean }
  | { kind: 'topic'; id: ID; sx: number; sy: number; wx: number; wy: number; offX: number; offY: number; active: boolean; floating: boolean }
  | { kind: 'pinch'; d0: number; k0: number; cx: number; cy: number; vx: number; vy: number }
  | { kind: 'select'; sx: number; sy: number; x: number; y: number };

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(props, ref) {
  const { sheet, relMode, onRelTarget, onContextMenu, onOpenNote, onOpenLink, pitchFocus, readOnly, searchHits, onViewChange } = props;
  const lay = useMemo(() => layoutSheet(sheet), [sheet]);
  const selection = useDoc((s) => s.selection);
  const editingId = useDoc((s) => s.editingId);
  const selectedRel = useDoc((s) => s.selectedRel);
  const focusReq = useDoc((s) => s.focusReq);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [animating, setAnimating] = useState(false);
  const [hover, setHover] = useState<ID | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [dropTarget, setDropTarget] = useState<{ id: ID; zone: 'child' | 'before' | 'after' } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragWorld, setDragWorld] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);

  const rect = () => wrapRef.current!.getBoundingClientRect();
  const toWorld = useCallback((cx: number, cy: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  }, []);

  const animateTo = (v: View, animate = true, mark = true) => {
    viewRef.current = v;
    if (mark) interacted.current = true;
    if (animate) {
      setAnimating(true);
      setTimeout(() => setAnimating(false), 420);
    }
    setView(v);
  };

  const fitBounds = useCallback((b: { x: number; y: number; w: number; h: number }, animate = true, maxK = 1.15) => {
    const el = wrapRef.current;
    if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const pad = Math.min(80, W * 0.08);
    const k = Math.max(0.1, Math.min(maxK, (W - pad * 2) / Math.max(1, b.w), (H - pad * 2) / Math.max(1, b.h)));
    animateTo({ k, x: W / 2 - (b.x + b.w / 2) * k, y: H / 2 - (b.y + b.h / 2) * k }, animate);
  }, []);

  const fit = useCallback((animate = true) => fitBounds(lay.bounds, animate), [lay, fitBounds]);

  const centerOn = useCallback(
    (id: ID, zoom?: number) => {
      const n = lay.nodes.get(id);
      const el = wrapRef.current;
      if (!n || !el) return;
      const k = zoom ?? viewRef.current.k;
      animateTo({ k, x: el.clientWidth / 2 - (n.x + n.w / 2) * k, y: el.clientHeight / 2 - (n.y + n.h / 2) * k });
    },
    [lay],
  );

  const zoomAt = (f: number, cx?: number, cy?: number, animate = false) => {
    const el = wrapRef.current!;
    const v = viewRef.current;
    const k = Math.max(0.08, Math.min(4, v.k * f));
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    const wx = (px - v.x) / v.k;
    const wy = (py - v.y) / v.k;
    animateTo({ k, x: px - wx * k, y: py - wy * k }, animate);
  };

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (f) => zoomAt(f, undefined, undefined, true),
    setZoom: (k) => zoomAt(k / viewRef.current.k, undefined, undefined, true),
    centerOn,
    fitBounds,
    svg: () => svgRef.current,
    layout: () => lay,
    view: () => viewRef.current,
    screenToWorld: toWorld,
  }));

  // первичное центрирование (повторяется при изменении размера, пока пользователь не двигал карту)
  const didFit = useRef<string | null>(null);
  const interacted = useRef(false);
  const ready = useRef(false);
  const initialFit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !el.clientWidth) return;
    const b = lay.bounds;
    const small = el.clientWidth < 600;
    const pad = small ? 24 : 60;
    const fitsK = Math.min((el.clientWidth - pad) / b.w, (el.clientHeight - pad) / b.h);
    const r = lay.nodes.get(sheet.root.id)!;
    // слишком большая карта — не мельчим, а центрируем на главной теме
    const minK = small ? 0.48 : 0.5;
    const v = fitsK >= 1 || fitsK < minK
      ? (() => {
          const k = fitsK >= 1 ? 1 : minK;
          return { k, x: el.clientWidth / 2 - (r.x + r.w / 2) * k, y: el.clientHeight / 2 - (r.y + r.h / 2) * k };
        })()
      : (() => {
          const k = Math.max(0.1, Math.min(1, fitsK));
          return { k, x: el.clientWidth / 2 - (b.x + b.w / 2) * k, y: el.clientHeight / 2 - (b.y + b.h / 2) * k };
        })();
    viewRef.current = v;
    setView(v);
  }, [lay, sheet.root.id]);
  useEffect(() => {
    if (didFit.current === sheet.id) return;
    didFit.current = sheet.id;
    interacted.current = false;
    initialFit();
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.id]);
  useEffect(() => {
    const el = wrapRef.current!;
    let last = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w === last.w && h === last.h) return;
      if (!interacted.current) initialFit();
      else {
        const v = viewRef.current;
        setView({ ...v, x: v.x + (w - last.w) / 2, y: v.y + (h - last.h) / 2 });
      }
      last = { w, h };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [initialFit]);

  // запрос фокуса на теме
  useEffect(() => {
    if (focusReq) setTimeout(() => centerOn(focusReq.id), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq?.n]);

  // держать выделенную тему в зоне видимости
  useEffect(() => {
    const id = selection[selection.length - 1];
    const n = id && lay.nodes.get(id);
    const el = wrapRef.current;
    if (!n || !el || dragRef.current || !ready.current) return;
    const v = viewRef.current;
    const sx = n.x * v.k + v.x;
    const sy = n.y * v.k + v.y;
    const sw = n.w * v.k;
    const sh = n.h * v.k;
    const m = 56;
    let dx = 0;
    let dy = 0;
    if (sx < m) dx = m - sx;
    else if (sx + sw > el.clientWidth - m) dx = el.clientWidth - m - sx - sw;
    if (sy < m) dy = m - sy;
    else if (sy + sh > el.clientHeight - m - 60) dy = el.clientHeight - m - 60 - sy - sh;
    if (dx || dy) animateTo({ ...v, x: v.x + dx, y: v.y + dy }, true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, lay]);

  // колесо: прокрутка = панорама, ctrl/pinch = зум
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      interacted.current = true;
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        const v = viewRef.current;
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    // Safari жесты трекпада
    const onGesture = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGesture);
    el.addEventListener('gesturechange', onGesture);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGesture);
      el.removeEventListener('gesturechange', onGesture);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- поиск цели под курсором ----------
  const hitTopic = (wx: number, wy: number, exclude?: ID): LNode | null => {
    for (let i = lay.order.length - 1; i >= 0; i--) {
      const n = lay.order[i];
      if (exclude && (n.id === exclude || isAncestor(sheet, exclude, n.id))) continue;
      if (wx >= n.x - 6 && wx <= n.x + n.w + 6 && wy >= n.y - 6 && wy <= n.y + n.h + 6) return n;
    }
    return null;
  };

  const zoneFor = (n: LNode, wx: number, wy: number): 'child' | 'before' | 'after' => {
    if (!n.parentId) return 'child';
    const vertical = sheet.structure === 'org' || (sheet.structure === 'tree' && n.depth === 1) || (sheet.structure === 'timeline' && n.depth === 1);
    const t = vertical ? (wx - n.x) / n.w : (wy - n.y) / n.h;
    if (t < 0.28) return 'before';
    if (t > 0.72) return 'after';
    return 'child';
  };

  const clearLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current);
    longPress.current = null;
  };

  // ---------- указатель ----------
  const onPointerDown = (e: React.PointerEvent) => {
    interacted.current = true;
    if ((e.target as HTMLElement).closest('textarea')) return;
    if (e.button === 2) return;
    try {
      wrapRef.current!.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = rect();
    if (pointers.current.size === 2) {
      clearLongPress();
      const [a, b] = [...pointers.current.values()];
      setDrag({
        kind: 'pinch',
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        k0: viewRef.current.k,
        cx: (a.x + b.x) / 2 - r.left,
        cy: (a.y + b.y) / 2 - r.top,
        vx: viewRef.current.x,
        vy: viewRef.current.y,
      });
      setDropTarget(null);
      return;
    }
    if (e.button === 2) return;
    const target = e.target as Element;
    const st = useDoc.getState();
    const toggleEl = target.closest('[data-toggle]');
    if (toggleEl) {
      if (!readOnly) st.toggleCollapse(toggleEl.getAttribute('data-toggle')!);
      return;
    }
    const relEl = target.closest('[data-rel]');
    const topicEl = target.closest('[data-topic]');
    if (topicEl) {
      const id = topicEl.getAttribute('data-topic')!;
      if (relMode) {
        onRelTarget(id);
        return;
      }
      if (target.closest('[data-task-toggle]') && !readOnly) {
        const f = lay.nodes.get(id);
        const cur = f?.topic.task?.status ?? 'todo';
        const next = cur === 'done' ? 'todo' : 'done';
        st.updateTopic(id, { task: { ...f!.topic.task!, status: next, progress: next === 'done' ? 100 : f!.topic.task?.progress } });
        return;
      }
      const icon = target.closest('[data-icon]')?.getAttribute('data-icon');
      if (icon === 'note') {
        st.select(id);
        onOpenNote(id);
        return;
      }
      if (icon === 'link') {
        const n = lay.nodes.get(id);
        if (n?.topic.link) onOpenLink(n.topic.link);
        return;
      }
      if (editingId && editingId !== id) st.setEditing(null);
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (additive) st.select(id, true);
      else if (!selection.includes(id) || selection.length > 1) st.select(id);
      // двойной тап
      const now = Date.now();
      if (lastTap.current.id === id && now - lastTap.current.t < 350 && !readOnly) {
        st.setEditing(id);
        lastTap.current = { id: '', t: 0 };
        return;
      }
      lastTap.current = { id, t: now };
      const w = toWorld(e.clientX, e.clientY);
      const n = lay.nodes.get(id)!;
      const isRoot = id === sheet.root.id;
      if (isRoot || readOnly) {
        setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false, onTopic: true });
      } else {
        const floating = sheet.floating.some((f) => f.id === id);
        setDrag({ kind: 'topic', id, sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y, offX: w.x - n.x, offY: w.y - n.y, active: false, floating });
      }
      if (e.pointerType === 'touch') {
        clearLongPress();
        longPress.current = setTimeout(() => {
          const d = dragRef.current;
          if (d && ((d.kind === 'topic' && !d.active) || (d.kind === 'pan' && !d.moved))) {
            setDrag(null);
            onContextMenu({ x: e.clientX, y: e.clientY, topicId: id, worldX: w.x, worldY: w.y });
          }
        }, 520);
      }
      return;
    }
    if (relEl) {
      st.selectRel(relEl.getAttribute('data-rel'));
      return;
    }
    // фон
    if (relMode) return;
    const now = Date.now();
    if (lastTap.current.id === '__bg' && now - lastTap.current.t < 350 && !readOnly) {
      const w = toWorld(e.clientX, e.clientY);
      st.addFloating(w.x, w.y);
      lastTap.current = { id: '', t: 0 };
      return;
    }
    lastTap.current = { id: '__bg', t: now };
    if (e.shiftKey && !readOnly) {
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ kind: 'select', sx: w.x, sy: w.y, x: w.x, y: w.y });
      return;
    }
    if (editingId) st.setEditing(null);
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false });
    if (e.pointerType === 'touch') {
      clearLongPress();
      longPress.current = setTimeout(() => {
        const d = dragRef.current;
        if (d?.kind === 'pan' && !d.moved) {
          setDrag(null);
          const w = toWorld(e.clientX, e.clientY);
          onContextMenu({ x: e.clientX, y: e.clientY, topicId: null, worldX: w.x, worldY: w.y });
        }
      }, 560);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = dragRef.current;
    if (!d) {
      if (e.pointerType === 'mouse') {
        const el = (e.target as Element).closest('[data-topic]');
        const id = el?.getAttribute('data-topic') ?? null;
        if (id !== hover) setHover(id);
      }
      return;
    }
    if (d.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const r = rect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.max(0.08, Math.min(4, (d.k0 * dist) / d.d0));
      const cx = (a.x + b.x) / 2 - r.left;
      const cy = (a.y + b.y) / 2 - r.top;
      const wx = (d.cx - d.vx) / d.k0;
      const wy = (d.cy - d.vy) / d.k0;
      setView({ k, x: cx - wx * k, y: cy - wy * k });
      return;
    }
    if (d.kind === 'pan') {
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > 4) {
        d.moved = true;
        clearLongPress();
      }
      if (d.moved) setView({ ...viewRef.current, x: d.vx + dx, y: d.vy + dy });
      return;
    }
    if (d.kind === 'select') {
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ ...d, x: w.x, y: w.y });
      return;
    }
    if (d.kind === 'topic') {
      const dist = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
      if (!d.active && dist > 6) {
        d.active = true;
        clearLongPress();
        useDoc.getState().setEditing(null);
        setDrag({ ...d });
      }
      if (d.active) {
        const w = toWorld(e.clientX, e.clientY);
        setDragWorld(w);
        const t = hitTopic(w.x, w.y, d.id);
        setDropTarget(t ? { id: t.id, zone: zoneFor(t, w.x, w.y) } : null);
        // автопрокрутка у краёв
        const r = rect();
        const m = 30;
        const v = viewRef.current;
        let dx = 0, dy = 0;
        if (e.clientX - r.left < m) dx = 8;
        else if (r.right - e.clientX < m) dx = -8;
        if (e.clientY - r.top < m) dy = 8;
        else if (r.bottom - e.clientY < m) dy = -8;
        if (dx || dy) setView({ ...v, x: v.x + dx, y: v.y + dy });
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    clearLongPress();
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pinch') {
      if (pointers.current.size === 1) {
        const [p] = [...pointers.current.values()];
        setDrag({ kind: 'pan', sx: p.x, sy: p.y, vx: viewRef.current.x, vy: viewRef.current.y, moved: true });
      } else setDrag(null);
      return;
    }
    if (pointers.current.size > 0) return;
    const st = useDoc.getState();
    if (d.kind === 'pan') {
      if (!d.moved && !d.onTopic) {
        st.select(null);
        st.selectRel(null);
      }
    } else if (d.kind === 'select') {
      const x0 = Math.min(d.sx, d.x), x1 = Math.max(d.sx, d.x), y0 = Math.min(d.sy, d.y), y1 = Math.max(d.sy, d.y);
      const ids = lay.order.filter((n) => n.x < x1 && n.x + n.w > x0 && n.y < y1 && n.y + n.h > y0).map((n) => n.id);
      st.select(ids);
    } else if (d.kind === 'topic' && d.active) {
      const w = toWorld(e.clientX, e.clientY);
      const dt = dropTarget;
      if (dt) {
        const tn = lay.nodes.get(dt.id)!;
        if (dt.zone === 'child') st.move(d.id, dt.id, tn.topic.children.length);
        else if (tn.parentId) st.move(d.id, tn.parentId, tn.index + (dt.zone === 'after' ? 1 : 0));
      } else {
        const n = lay.nodes.get(d.id)!;
        const nx = w.x - d.offX + n.w / 2;
        const ny = w.y - d.offY + n.h / 2;
        if (d.floating) {
          const f = sheet.floating.find((x) => x.id === d.id)!;
          // плавающая хранит центр корня; сдвигаем на разницу
          st.moveFloating(d.id, f.x + (nx - (n.x + n.w / 2)), f.y + (ny - (n.y + n.h / 2)));
        } else st.detach(d.id, nx, ny);
      }
      st.select(d.id);
    }
    setDrag(null);
    setDropTarget(null);
    setDragWorld(null);
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = (e.target as Element).closest('[data-topic]');
    const id = el?.getAttribute('data-topic') ?? null;
    if (id && !useDoc.getState().selection.includes(id)) useDoc.getState().select(id);
    const w = toWorld(e.clientX, e.clientY);
    onContextMenu({ x: e.clientX, y: e.clientY, topicId: id, worldX: w.x, worldY: w.y });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // мышь: двойной клик обработан в pointerdown; это для надёжности на десктопе
    const el = (e.target as Element).closest('[data-topic]');
    if (el && !readOnly) useDoc.getState().setEditing(el.getAttribute('data-topic'));
  };

  const theme = lay.theme;
  const bg = sheet.background ?? theme.background;
  const selSet = useMemo(() => new Set(selection), [selection]);
  const dimSet = useMemo(() => {
    if (!pitchFocus) return null;
    const keep = new Set<ID>();
    const n = lay.nodes.get(pitchFocus);
    if (!n) return null;
    // предки
    let p: LNode | undefined = n;
    while (p) {
      keep.add(p.id);
      p = p.parentId ? lay.nodes.get(p.parentId) : undefined;
    }
    const rec = (id: ID) => {
      keep.add(id);
      lay.nodes.get(id)?.topic.children.forEach((c) => rec(c.id));
    };
    rec(pitchFocus);
    return keep;
  }, [pitchFocus, lay]);

  const draggingId = drag?.kind === 'topic' && drag.active ? drag.id : null;
  const dragNode = draggingId ? lay.nodes.get(draggingId) : null;
  const vertical = sheet.structure === 'org' || sheet.structure === 'tree';

  return (
    <div
      ref={wrapRef}
      className="map-canvas"
      style={{ background: bg, cursor: relMode ? 'crosshair' : drag?.kind === 'pan' && drag.moved ? 'grabbing' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={onContext}
      onDoubleClick={onDoubleClick}
    >
      <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block', touchAction: 'none', userSelect: 'none' }}>
        <g
          data-export-root
          transform={`translate(${view.x},${view.y}) scale(${view.k})`}
          style={{ transition: animating ? 'transform .4s cubic-bezier(.2,.8,.2,1)' : undefined }}
          fontFamily={FONT_FAMILY}
        >
          {sheet.boundaries.map((b) => (
            <BoundaryView key={b.id} lay={lay} b={b} />
          ))}
          {lay.extras.map((x, i) => (
            <path key={'x' + i} d={x.d} fill={x.filled ? x.color : 'none'} stroke={x.filled ? 'none' : x.color} strokeWidth={x.width} strokeLinecap="round" markerEnd={x.arrow ? 'url(#arrow-spine)' : undefined} opacity={dimSet ? 0.25 : 1} />
          ))}
          {lay.edges.map((ed) => (
            <path
              key={ed.from + '-' + ed.to}
              d={ed.d}
              fill={ed.filled ? ed.color : 'none'}
              stroke={ed.filled ? 'none' : ed.color}
              strokeWidth={ed.filled ? 0 : ed.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={dimSet && !dimSet.has(ed.to) ? 0.12 : draggingId === ed.to ? 0.3 : 1}
              style={{ transition: 'opacity .3s' }}
            />
          ))}
          {sheet.summaries.map((s) => (
            <SummaryView key={s.id} lay={lay} s={s} vertical={vertical} />
          ))}
          {lay.order.map((n) => (
            <NodeView
              key={n.id}
              n={n}
              selected={selSet.has(n.id)}
              editing={editingId === n.id}
              dim={dimSet ? !dimSet.has(n.id) : draggingId === n.id}
              dropHint={dropTarget?.id === n.id ? dropTarget.zone : null}
              highlight={searchHits?.has(n.id)}
            />
          ))}
          {lay.order.map((n) => (
            <Toggle key={'t' + n.id} n={n} visible={!readOnly && (hover === n.id || selSet.has(n.id))} />
          ))}
          {sheet.relationships.map((r) => (
            <RelationshipView key={r.id} lay={lay} r={r} selected={selectedRel === r.id} color={theme.relColor} />
          ))}
          {dragNode && dragWorld && drag?.kind === 'topic' && (
            <g className="no-export" transform={`translate(${dragWorld.x - drag.offX - dragNode.x},${dragWorld.y - drag.offY - dragNode.y})`} opacity={0.75} pointerEvents="none">
              <NodeView n={dragNode} selected editing={false} />
            </g>
          )}
          {drag?.kind === 'select' && (
            <rect className="no-export" x={Math.min(drag.sx, drag.x)} y={Math.min(drag.sy, drag.y)} width={Math.abs(drag.x - drag.sx)} height={Math.abs(drag.y - drag.sy)} fill="rgba(255,74,43,.08)" stroke="#ff4a2b" strokeDasharray="4 3" />
          )}
        </g>
        <defs>
          <marker id="arrow-spine" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={theme.lineColor} />
          </marker>
        </defs>
      </svg>
      {editingId && lay.nodes.get(editingId) && <InlineEditor key={editingId} n={lay.nodes.get(editingId)!} view={view} />}
    </div>
  );
});

// ---------- Редактор текста поверх темы ----------

function InlineEditor({ n, view }: { n: LNode; view: View }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const initial = useRef(useDoc.getState().pendingText ?? n.topic.text);
  const [text, setText] = useState(initial.current);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current!;
    el.focus();
    if (useDoc.getState().pendingText != null) {
      el.setSelectionRange(el.value.length, el.value.length);
      useDoc.setState({ pendingText: null });
    } else el.select();
  }, []);

  const commit = (after?: 'child' | 'sibling') => {
    if (done.current) return;
    done.current = true;
    const st = useDoc.getState();
    if (text !== n.topic.text) st.setText(n.id, text);
    st.setEditing(null);
    if (after === 'child') st.addChild(n.id);
    if (after === 'sibling') st.addSibling(n.id);
  };

  const s = n.style;
  const k = view.k;
  const fs = s.fontSize * k;
  const font = fontString(s.fontSize, s.bold, s.italic);
  void font;
  const minW = Math.max(n.w * k, 80);
  return (
    <textarea
      ref={ref}
      className="inline-editor"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => commit()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          commit('sibling');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          commit('child');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          commit();
        }
      }}
      rows={Math.max(1, text.split('\n').length)}
      style={{
        left: n.x * k + view.x,
        top: n.y * k + view.y,
        minWidth: minW,
        minHeight: n.h * k,
        fontSize: fs,
        fontWeight: s.bold ? 700 : 400,
        fontStyle: s.italic ? 'italic' : undefined,
        color: s.textColor === '#ffffff' && (s.fill === 'transparent' || s.fill === 'none') ? '#111' : s.textColor,
        background: s.fill === 'transparent' || s.fill === 'none' ? 'var(--surface)' : s.fill,
        padding: `${(n.h * k - fs * 1.32 * Math.max(1, text.split('\n').length)) / 2}px ${10 * k}px`,
        lineHeight: 1.32,
        borderRadius: Math.min(10, (n.h * k) / 2.6),
      }}
      spellCheck
      placeholder="Введите текст"
    />
  );
}

export function topicBoundsForPitch(lay: LayoutResult, id: ID) {
  return subtreeBounds(lay, id);
}
