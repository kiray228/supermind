import type { ID, LineStyle, ShapeType, Sheet, StructureType, Topic } from '../types';
import { getTheme, type LevelStyle, type Theme } from '../themes';
import { fontString, textWidth, wrapText } from './measure';

export type Level = 'central' | 'main' | 'sub' | 'floating';

export interface ResolvedStyle {
  fill: string;
  textColor: string;
  borderColor: string;
  borderWidth: number;
  shape: ShapeType;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

export interface NodeContent {
  /** центр строк текста по X (относительно узла) */
  textCX: number;
  /** базовая линия первой строки */
  textY: number;
  lineH: number;
  markers: { id: string; x: number; y: number; size: number }[];
  task?: { x: number; y: number; size: number };
  icons: { kind: 'note' | 'link'; x: number; y: number; size: number }[];
  labels: { text: string; x: number; y: number; w: number; h: number }[];
  image?: { x: number; y: number; w: number; h: number };
  meta?: { x: number; y: number; w: number; h: number; due?: string; progress?: number };
}

export interface LNode {
  id: ID;
  topic: Topic;
  parentId: ID | null;
  rootId: ID;
  depth: number;
  index: number;
  level: Level;
  x: number;
  y: number;
  w: number;
  h: number;
  /** направление роста по горизонтали */
  side: 1 | -1;
  /** направление роста по вертикали (для орг/таймлайна/рыбьей кости) */
  vdir: 1 | -1;
  color: string;
  style: ResolvedStyle;
  lines: string[];
  content: NodeContent;
  /** количество скрытых потомков (если свёрнуто) */
  hidden: number;
  /** где рисовать кнопку свёртки */
  toggle?: { x: number; y: number };
}

export interface LEdge {
  from: ID;
  to: ID;
  d: string;
  color: string;
  width: number;
  filled?: boolean;
}

export interface LExtra {
  d: string;
  color: string;
  width: number;
  filled?: boolean;
  arrow?: boolean;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult {
  nodes: Map<ID, LNode>;
  order: LNode[];
  edges: LEdge[];
  extras: LExtra[];
  bounds: Bounds;
  theme: Theme;
}

const MIN_W: Record<Level, number> = { central: 90, main: 44, sub: 30, floating: 60 };

function resolveLevel(theme: Theme, level: Level): LevelStyle {
  return level === 'central' ? theme.central : level === 'main' ? theme.main : level === 'floating' ? theme.floating : theme.sub;
}

export function formatDue(due: string): string {
  const [, m, d] = due.split('-');
  return `${Number(d)}.${m}`;
}

// ---------- Измерение узла ----------

function measure(n: LNode) {
  const t = n.topic;
  const s = n.style;
  const fs = s.fontSize;
  const font = fontString(fs, s.bold, s.italic);
  const maxW = n.level === 'central' ? fs * 14 : fs * 16;
  const lines = wrapText(t.text || '', font, maxW);
  const lineH = Math.round(fs * 1.32);
  let textW = 0;
  for (const l of lines) textW = Math.max(textW, textWidth(l, font));
  if (!t.text) textW = Math.max(textW, fs * 1.5);
  const textH = lines.length * lineH;

  const ms = Math.round(fs * 1.12);
  const gap = Math.max(4, fs * 0.3);
  const markers = t.markers ?? [];
  const hasTask = !!t.task;
  const icons: ('note' | 'link')[] = [];
  if (t.note) icons.push('note');
  if (t.link) icons.push('link');

  const leftW = (markers.length + (hasTask ? 1 : 0)) * (ms + gap);
  const rightW = icons.length * (ms * 0.9 + gap);
  const rowW = leftW + textW + rightW;
  const rowH = Math.max(textH, ms);

  const labelH = Math.round(fs * 0.95 + 6);
  const labelFont = fontString(fs * 0.72, true);
  const labelWs = (t.labels ?? []).map((l) => textWidth(l, labelFont) + 14);
  const labelsW = labelWs.reduce((a, b) => a + b, 0) + Math.max(0, labelWs.length - 1) * 4;

  let img: { w: number; h: number } | undefined;
  if (t.image) {
    // размеры из чужого файла могут быть пустыми или кривыми — иначе NaN разломал бы всю карту
    const iw = t.image.w > 0 ? t.image.w : 200;
    const ih = t.image.h > 0 ? t.image.h : 150;
    const maxIw = Math.max(120, Math.min(320, iw));
    const k = Math.min(1, maxIw / iw);
    img = { w: iw * k, h: ih * k };
  }

  const hasMeta = !!t.task && (t.task.due || (t.task.progress ?? 0) > 0);
  const metaH = hasMeta ? Math.round(fs * 0.9 + 4) : 0;
  const metaW = hasMeta ? fs * 5.5 : 0;

  const contentW = Math.max(rowW, img?.w ?? 0, labelsW, metaW);
  let contentH = rowH;
  if (img) contentH += img.h + gap;
  if (labelWs.length) contentH += labelH + gap;
  if (hasMeta) contentH += metaH + gap;

  let px = fs * 0.85;
  let py = fs * 0.55;
  if (s.shape === 'underline' || s.shape === 'none') {
    px = fs * 0.3;
    py = fs * 0.32;
  } else if (s.shape === 'ellipse') {
    px = fs * 1.5;
    py = fs * 0.95;
  } else if (s.shape === 'diamond') {
    px = fs * 2.2;
    py = fs * 1.4;
  } else if (s.shape === 'hexagon') {
    px = fs * 1.4;
  } else if (s.shape === 'pill') {
    px = fs * 1.15;
  }
  if (n.level === 'central') {
    px *= 1.35;
    py *= 1.35;
  }
  const w = Math.max(MIN_W[n.level], contentW + px * 2);
  const h = contentH + py * 2;

  // раскладка содержимого
  const c: NodeContent = { textCX: 0, textY: 0, lineH, markers: [], icons: [], labels: [] };
  let cy = py;
  if (img) {
    c.image = { x: (w - img.w) / 2, y: cy, w: img.w, h: img.h };
    cy += img.h + gap;
  }
  const rowX = (w - rowW) / 2;
  const rowMid = cy + rowH / 2;
  let x = rowX;
  if (hasTask) {
    c.task = { x, y: rowMid - ms / 2, size: ms };
    x += ms + gap;
  }
  for (const id of markers) {
    c.markers.push({ id, x, y: rowMid - ms / 2, size: ms });
    x += ms + gap;
  }
  c.textCX = x + textW / 2;
  // базовая линия: центр блока текста
  c.textY = rowMid - textH / 2 + lineH * 0.5 + fs * 0.36;
  x += textW + gap;
  for (const k of icons) {
    c.icons.push({ kind: k, x, y: rowMid - (ms * 0.9) / 2, size: ms * 0.9 });
    x += ms * 0.9 + gap;
  }
  cy += rowH + gap;
  if (labelWs.length) {
    let lx = (w - labelsW) / 2;
    (t.labels ?? []).forEach((l, i) => {
      c.labels.push({ text: l, x: lx, y: cy, w: labelWs[i], h: labelH });
      lx += labelWs[i] + 4;
    });
    cy += labelH + gap;
  }
  if (hasMeta) {
    c.meta = { x: (w - metaW) / 2, y: cy, w: metaW, h: metaH, due: t.task!.due, progress: t.task!.progress };
  }
  n.w = Math.round(w);
  n.h = Math.round(h);
  n.lines = lines;
  n.content = c;
}

// ---------- Основная функция ----------

export function layoutSheet(sheet: Sheet): LayoutResult {
  const theme = getTheme(sheet.themeId);
  const sp = sheet.spacing ?? 1;
  const nodes = new Map<ID, LNode>();
  const order: LNode[] = [];
  const edges: LEdge[] = [];
  const extras: LExtra[] = [];
  const lineStyleDefault: LineStyle = sheet.lineStyle ?? theme.lineStyle;

  const build = (t: Topic, parent: LNode | null, depth: number, index: number, rootLevel: Level, rootId: ID): LNode => {
    const level: Level = depth === 0 ? rootLevel : depth === 1 ? 'main' : 'sub';
    const base = resolveLevel(theme, level);
    let color: string;
    if (!parent) color = t.style?.lineColor ?? theme.lineColor;
    else if (depth === 1 && sheet.rainbow) color = t.style?.lineColor ?? theme.palette[index % theme.palette.length];
    else color = t.style?.lineColor ?? parent.color;

    const st: ResolvedStyle = { ...base, italic: false, strike: false };
    if (level === 'main' && sheet.shapes?.main) st.shape = sheet.shapes.main;
    if (level === 'sub' && sheet.shapes?.sub) st.shape = sheet.shapes.sub;
    if (st.shape === 'underline') st.fill = 'transparent';
    if (sheet.rainbow && depth >= 1) {
      if (level === 'main') {
        if (theme.fillMainWithBranch) {
          st.fill = color;
          st.textColor = '#ffffff';
          st.borderColor = 'transparent';
        } else if (st.borderWidth > 0) st.borderColor = color;
      } else if (level === 'sub' && st.borderWidth > 0 && st.shape !== 'underline' && st.shape !== 'none') {
        st.borderColor = color;
      }
    }
    const o = t.style ?? {};
    if (o.fill !== undefined) st.fill = o.fill;
    if (o.textColor !== undefined) st.textColor = o.textColor;
    if (o.borderColor !== undefined) st.borderColor = o.borderColor;
    if (o.borderWidth !== undefined) st.borderWidth = o.borderWidth;
    if (o.shape !== undefined) st.shape = o.shape;
    if (typeof o.fontSize === 'number' && o.fontSize > 0) st.fontSize = o.fontSize;
    if (o.bold !== undefined) st.bold = o.bold;
    if (o.italic !== undefined) st.italic = o.italic;
    if (o.strike !== undefined) st.strike = o.strike;
    if (t.task?.status === 'done' && o.strike === undefined) st.strike = false;

    const n: LNode = {
      id: t.id, topic: t, parentId: parent?.id ?? null, rootId, depth, index, level,
      x: 0, y: 0, w: 0, h: 0, side: 1, vdir: 1, color, style: st, lines: [],
      content: { textCX: 0, textY: 0, lineH: 0, markers: [], icons: [], labels: [] },
      hidden: 0,
    };
    measure(n);
    nodes.set(n.id, n);
    order.push(n);
    if (t.collapsed) n.hidden = countDesc(t);
    else t.children.forEach((c, i) => build(c, n, depth + 1, i, rootLevel, rootId));
    return n;
  };

  const kids = (n: LNode): LNode[] => (n.topic.collapsed ? [] : n.topic.children.map((c) => nodes.get(c.id)!));

  // ---------- построение рёбер ----------
  const lineStyleOf = (p: LNode): LineStyle => p.topic.style?.lineStyle ?? lineStyleDefault;
  const lineWidthOf = (p: LNode, c: LNode) => (c.topic.style?.lineWidth ?? p.topic.style?.lineWidth ?? (p.depth === 0 ? theme.lineWidth * 1.15 : theme.lineWidth * 0.8));

  const anchorH = (n: LNode, dir: 1 | -1, outgoing: boolean, fromCenter = false) => {
    if (fromCenter) return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
    const ul = n.style.shape === 'underline';
    const x = outgoing ? (dir > 0 ? n.x + n.w : n.x) : dir > 0 ? n.x : n.x + n.w;
    return { x, y: ul ? n.y + n.h : n.y + n.h / 2 };
  };

  const edgeH = (p: LNode, c: LNode, dir: 1 | -1, fromCenter = false) => {
    const a = anchorH(p, dir, true, fromCenter);
    if (fromCenter) a.x += dir * Math.min(p.w * 0.25, 30);
    const b = anchorH(c, dir, false);
    edges.push(makeEdge(p, c, a, b, 'h', lineStyleOf(p), lineWidthOf(p, c)));
  };
  const edgeV = (p: LNode, c: LNode, vdir: 1 | -1) => {
    const a = { x: p.x + p.w / 2, y: vdir > 0 ? p.y + p.h : p.y };
    const b = { x: c.x + c.w / 2, y: vdir > 0 ? c.y : c.y + c.h };
    edges.push(makeEdge(p, c, a, b, 'v', lineStyleOf(p), lineWidthOf(p, c)));
  };
  const edgeIndent = (p: LNode, c: LNode, indent: number, vdir: 1 | -1) => {
    const ax = p.x + Math.min(indent * 0.55, p.w / 2);
    const ay = vdir > 0 ? p.y + p.h : p.y;
    const by = c.style.shape === 'underline' ? c.y + c.h : c.y + c.h / 2;
    const r = Math.min(8, Math.abs(by - ay));
    const d = `M${ax},${ay} V${by - vdir * r} Q${ax},${by} ${ax + r},${by} H${c.x}`;
    edges.push({ from: p.id, to: c.id, d, color: c.color, width: lineWidthOf(p, c) });
  };

  function makeEdge(p: LNode, c: LNode, a: { x: number; y: number }, b: { x: number; y: number }, orient: 'h' | 'v', style: LineStyle, width: number): LEdge {
    const color = c.color;
    if (style === 'straight') return { from: p.id, to: c.id, d: `M${a.x},${a.y} L${b.x},${b.y}`, color, width };
    if (style === 'elbow' || style === 'rounded-elbow') {
      const r = style === 'rounded-elbow' ? 10 : 0;
      if (orient === 'h') {
        const mx = a.x + (b.x - a.x) * 0.5;
        const dy = b.y - a.y;
        const rr = Math.min(r, Math.abs(dy) / 2, Math.abs(b.x - mx));
        if (rr < 0.5) return { from: p.id, to: c.id, d: `M${a.x},${a.y} H${mx} V${b.y} H${b.x}`, color, width };
        const sx = Math.sign(b.x - a.x) || 1;
        const sy = Math.sign(dy);
        return {
          from: p.id, to: c.id, color, width,
          d: `M${a.x},${a.y} H${mx - sx * rr} Q${mx},${a.y} ${mx},${a.y + sy * rr} V${b.y - sy * rr} Q${mx},${b.y} ${mx + sx * rr},${b.y} H${b.x}`,
        };
      }
      const my = a.y + (b.y - a.y) * 0.5;
      const dx = b.x - a.x;
      const rr = Math.min(r, Math.abs(dx) / 2, Math.abs(b.y - my));
      if (rr < 0.5) return { from: p.id, to: c.id, d: `M${a.x},${a.y} V${my} H${b.x} V${b.y}`, color, width };
      const sy = Math.sign(b.y - a.y) || 1;
      const sx = Math.sign(dx);
      return {
        from: p.id, to: c.id, color, width,
        d: `M${a.x},${a.y} V${my - sy * rr} Q${a.x},${my} ${a.x + sx * rr},${my} H${b.x - sx * rr} Q${b.x},${my} ${b.x},${my + sy * rr} V${b.y}`,
      };
    }
    // кривые
    let c1: { x: number; y: number }, c2: { x: number; y: number };
    if (orient === 'h') {
      const dx = (b.x - a.x) * 0.5;
      c1 = { x: a.x + dx, y: a.y };
      c2 = { x: b.x - dx * 0.6, y: b.y };
      if (p.depth === 0) {
        c1 = { x: a.x + dx * 0.4, y: a.y + (b.y - a.y) * 0.15 };
        c2 = { x: a.x + dx * 0.9, y: b.y };
      }
    } else {
      const dy = (b.y - a.y) * 0.5;
      c1 = { x: a.x, y: a.y + dy };
      c2 = { x: b.x, y: b.y - dy };
    }
    if (style === 'taper') {
      const w0 = width * (p.depth === 0 ? 2.6 : 1.7);
      const w1 = width * 0.35;
      if (orient === 'h') {
        return {
          from: p.id, to: c.id, color, width, filled: true,
          d: `M${a.x},${a.y - w0} C${c1.x},${c1.y - w0} ${c2.x},${c2.y - w1} ${b.x},${b.y - w1} L${b.x},${b.y + w1} C${c2.x},${c2.y + w1} ${c1.x},${c1.y + w0} ${a.x},${a.y + w0} Z`,
        };
      }
      return {
        from: p.id, to: c.id, color, width, filled: true,
        d: `M${a.x - w0},${a.y} C${c1.x - w0},${c1.y} ${c2.x - w1},${c2.y} ${b.x - w1},${b.y} L${b.x + w1},${b.y} C${c2.x + w1},${c2.y} ${c1.x + w0},${c1.y} ${a.x + w0},${a.y} Z`,
      };
    }
    return { from: p.id, to: c.id, d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`, color, width };
  }

  // ---------- горизонтальное дерево ----------
  const hGap = (n: LNode) => (n.depth === 0 ? 64 : 34) * sp;
  const vGap = (n: LNode) => (n.depth === 0 ? 22 : n.depth === 1 ? 12 : 8) * sp;
  const shCache = new Map<ID, number>();
  const subH = (n: LNode): number => {
    let v = shCache.get(n.id);
    if (v !== undefined) return v;
    const ks = kids(n);
    v = ks.length ? Math.max(n.h, ks.reduce((s, c) => s + subH(c), 0) + vGap(n) * (ks.length - 1)) : n.h;
    shCache.set(n.id, v);
    return v;
  };
  const placeH = (n: LNode, nearX: number, cy: number, dir: 1 | -1, brace = false) => {
    n.side = dir;
    n.x = dir > 0 ? nearX : nearX - n.w;
    n.y = cy - n.h / 2;
    const ks = kids(n);
    if (!ks.length) return;
    const gap = hGap(n) * (brace ? 1.3 : 1);
    const total = ks.reduce((s, c) => s + subH(c), 0) + vGap(n) * (ks.length - 1);
    let y = cy - total / 2;
    for (const c of ks) {
      const h = subH(c);
      placeH(c, dir > 0 ? n.x + n.w + gap : n.x - gap, y + h / 2, dir, brace);
      y += h + vGap(n);
    }
    if (brace) {
      const first = ks[0];
      const last = ks[ks.length - 1];
      const x0 = dir > 0 ? n.x + n.w + gap * 0.35 : n.x - gap * 0.35;
      const top = first.y + 2;
      const bot = last.y + last.h - 2;
      extras.push({ d: bracePath(x0, top, bot, (n.y + n.h / 2), dir, gap * 0.45), color: ks[0].color, width: theme.lineWidth });
    } else ks.forEach((c) => edgeH(n, c, dir));
  };

  // ---------- вертикальное дерево (орг) ----------
  const swCache = new Map<ID, number>();
  const sibGapV = 18 * sp;
  const subW = (n: LNode): number => {
    let v = swCache.get(n.id);
    if (v !== undefined) return v;
    const ks = kids(n);
    v = ks.length ? Math.max(n.w, ks.reduce((s, c) => s + subW(c), 0) + sibGapV * (ks.length - 1)) : n.w;
    swCache.set(n.id, v);
    return v;
  };
  const placeV = (n: LNode, cx: number, y: number) => {
    n.x = cx - n.w / 2;
    n.y = y;
    n.vdir = 1;
    const ks = kids(n);
    if (!ks.length) return;
    const total = ks.reduce((s, c) => s + subW(c), 0) + sibGapV * (ks.length - 1);
    let x = cx - total / 2;
    const gy = (n.depth === 0 ? 56 : 40) * sp;
    for (const c of ks) {
      const w = subW(c);
      placeV(c, x + w / 2, n.y + n.h + gy);
      x += w + sibGapV;
    }
    ks.forEach((c) => edgeV(n, c, 1));
  };

  // ---------- дерево отступами ----------
  const indent = 28 * sp;
  const iGap = 10 * sp;
  const indW = (n: LNode): number => {
    const ks = kids(n);
    return Math.max(n.w, ...ks.map((c) => indent + indW(c)));
  };
  const indH = (n: LNode): number => {
    const ks = kids(n);
    return n.h + ks.reduce((s, c) => s + iGap + indH(c), 0);
  };
  /** Размещает узел и потомков отступами; y — верх блока */
  const placeIndent = (n: LNode, x: number, y: number) => {
    n.x = x;
    n.y = y;
    n.vdir = 1;
    let cy = y + n.h + iGap;
    for (const c of kids(n)) {
      placeIndent(c, x + indent, cy);
      edgeIndent(n, c, indent, 1);
      cy += indH(c) + iGap;
    }
  };
  /** Блок детей над узлом (для таймлайна): дети сверху вниз, низ блока — bottom */
  const placeIndentChildrenAbove = (p: LNode, bottom: number) => {
    const ks = kids(p);
    const total = ks.reduce((s, c) => s + indH(c) + iGap, 0);
    let cy = bottom - total;
    for (const c of ks) {
      placeIndent(c, p.x + indent, cy);
      // ребро вверх от родителя
      const ax = p.x + Math.min(indent * 0.55, p.w / 2);
      const ay = p.y;
      const by = c.style.shape === 'underline' ? c.y + c.h : c.y + c.h / 2;
      const r = Math.min(8, Math.abs(by - ay));
      edges.push({ from: p.id, to: c.id, d: `M${ax},${ay} V${by + r} Q${ax},${by} ${ax + r},${by} H${c.x}`, color: c.color, width: lineWidthOf(p, c) });
      cy += indH(c) + iGap;
    }
  };

  // ---------- раскладка корня по структуре ----------
  const layoutRoot = (root: LNode, structure: StructureType, cx: number, cy: number) => {
    root.x = cx - root.w / 2;
    root.y = cy - root.h / 2;
    const ks = kids(root);
    switch (structure) {
      case 'map': {
        const sides = mapSides(root.topic);
        const right = ks.filter((c) => sides.get(c.id) !== 'left');
        const left = ks.filter((c) => sides.get(c.id) === 'left');
        const side = (arr: LNode[], dir: 1 | -1) => {
          const total = arr.reduce((s, c) => s + subH(c), 0) + vGap(root) * Math.max(0, arr.length - 1);
          let y = cy - total / 2;
          for (const c of arr) {
            const h = subH(c);
            placeH(c, dir > 0 ? root.x + root.w + hGap(root) : root.x - hGap(root), y + h / 2, dir);
            edgeH(root, c, dir, true);
            y += h + vGap(root);
          }
        };
        side(right, 1);
        side(left, -1);
        break;
      }
      case 'logic-right':
      case 'logic-left':
      case 'brace': {
        const dir = structure === 'logic-left' ? -1 : 1;
        placeH(root, dir > 0 ? root.x : root.x + root.w, cy, dir, structure === 'brace');
        break;
      }
      case 'org':
        placeV(root, cx, root.y);
        break;
      case 'tree': {
        const gap = 36 * sp;
        const widths = ks.map((c) => indW(c));
        const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, ks.length - 1);
        let x = cx - total / 2;
        const y = root.y + root.h + 56 * sp;
        ks.forEach((c, i) => {
          placeIndent(c, x, y);
          edgeV(root, c, 1);
          x += widths[i] + gap;
        });
        break;
      }
      case 'timeline': {
        const gap = 40 * sp;
        let x = root.x + root.w + 60 * sp;
        ks.forEach((c, i) => {
          const blockW = Math.max(c.w, ...kids(c).map((k) => indent + indW(k)));
          c.x = x;
          c.y = cy - c.h / 2;
          if (i % 2 === 0) {
            // дети снизу
            let yy = c.y + c.h + 24 * sp;
            for (const k of kids(c)) {
              placeIndent(k, c.x + indent, yy);
              edgeIndent(c, k, indent, 1);
              yy += indH(k) + iGap;
            }
          } else placeIndentChildrenAbove(c, c.y - 24 * sp);
          x += blockW + gap;
        });
        const endX = Math.max(x, root.x + root.w + 120);
        extras.push({ d: `M${root.x + root.w},${cy} H${endX}`, color: theme.lineColor, width: theme.lineWidth * 1.6, arrow: true });
        break;
      }
      case 'fishbone': {
        // голова справа, хребет уходит влево
        let ax = root.x - 50 * sp;
        let minX = ax;
        for (let i = 0; i < ks.length; i += 2) {
          const pair = ks.slice(i, i + 2);
          let pairW = 0;
          pair.forEach((m, j) => {
            const vdir: 1 | -1 = j === 0 ? -1 : 1;
            m.vdir = vdir;
            const ch = kids(m);
            const chH = ch.reduce((s, c) => s + subH(c), 0) + vGap(m) * Math.max(0, ch.length - 1);
            const boneLen = Math.max(70 * sp, chH + 40 * sp);
            const slant = boneLen * 0.55;
            const tipX = ax - slant;
            const tipY = vdir * boneLen;
            m.x = tipX - m.w / 2;
            m.y = vdir < 0 ? tipY - m.h : tipY;
            extras.push({ d: `M${ax},${cy} L${tipX},${cy + tipY}`, color: m.color, width: theme.lineWidth * 1.3 });
            // дети вдоль кости
            let off = 24 * sp;
            let maxW = 0;
            const ordered = ch;
            for (const c of ordered) {
              const h = subH(c);
              const yMid = vdir < 0 ? cy - boneLen + off + h / 2 : cy + boneLen - off - h / 2;
              const t = Math.abs(yMid - cy) / boneLen;
              const boneX = ax - slant * t;
              placeH(c, boneX - 14 * sp, yMid, -1);
              edges.push({ from: m.id, to: c.id, d: `M${boneX},${yMid} H${c.x + c.w}`, color: c.color, width: theme.lineWidth * 0.8 });
              maxW = Math.max(maxW, subTreeWidthH(c) + 14 * sp + slant * t);
              off += h + vGap(m);
            }
            pairW = Math.max(pairW, slant + m.w / 2, maxW);
          });
          ax -= pairW + 30 * sp;
          minX = Math.min(minX, ax);
        }
        extras.push({ d: `M${root.x},${cy} H${Math.min(minX + 20, root.x - 80)}`, color: theme.lineColor, width: theme.lineWidth * 2 });
        break;
      }
    }
  };

  const subTreeWidthH = (n: LNode): number => {
    const ks = kids(n);
    if (!ks.length) return n.w;
    return n.w + hGap(n) + Math.max(...ks.map(subTreeWidthH));
  };

  // центральная тема
  const root = build(sheet.root, null, 0, 0, 'central', sheet.root.id);
  layoutRoot(root, sheet.structure, 0, 0);

  // плавающие темы — логическая схема вправо
  for (const f of sheet.floating) {
    const fr = build(f, null, 0, 0, 'floating', f.id);
    const st: StructureType = sheet.structure === 'org' || sheet.structure === 'tree' ? 'org' : sheet.structure === 'logic-left' ? 'logic-left' : 'logic-right';
    layoutRoot(fr, st, f.x, f.y);
  }

  // кнопки свёртки
  for (const n of order) {
    if (!n.topic.children.length) continue;
    const isMainRoot = n.depth === 0 && n.level === 'central';
    // у центральной темы карты кнопки нет — кроме случая, когда её всё же свернули (Ctrl+/, «Структура», импорт):
    // иначе вся карта пропадала без способа развернуть её касанием
    if (isMainRoot && sheet.structure === 'map' && !n.topic.collapsed) continue;
    const structure: StructureType = n.level === 'floating' || nodes.get(n.rootId)?.level === 'floating'
      ? (sheet.structure === 'org' || sheet.structure === 'tree' ? 'org' : 'logic-right')
      : sheet.structure;
    const below = { x: n.x + n.w / 2, y: n.y + n.h + 9 };
    const indentPos = (up: boolean) => ({ x: n.x + Math.min(indent * 0.55, n.w / 2), y: up ? n.y - 9 : n.y + n.h + 9 });
    if (structure === 'org') n.toggle = below;
    else if (structure === 'tree') n.toggle = n.depth === 0 ? below : indentPos(false);
    else if (structure === 'timeline' && n.depth >= 1) {
      const main = n.depth === 1 ? n : null;
      n.toggle = indentPos(!!main && n.index % 2 === 1);
    } else if (structure === 'fishbone' && n.depth <= 1) {
      if (n.depth === 0) continue;
      n.toggle = n.vdir < 0 ? { x: n.x + n.w / 2, y: n.y - 9 } : below;
    } else {
      const ul = n.style.shape === 'underline';
      n.toggle = { x: n.side > 0 ? n.x + n.w + 9 : n.x - 9, y: ul ? n.y + n.h : n.y + n.h / 2 };
    }
  }

  // границы
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of order) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  return { nodes, order, edges, extras, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, theme };
}

/**
 * Стороны основных тем в «Интеллект-карте»: явно заданные (topic.side) остаются,
 * остальные распределяются поровну — первые направо, следующие налево.
 */
export function mapSides(root: Topic): Map<ID, 'left' | 'right'> {
  const res = new Map<ID, 'left' | 'right'>();
  const kids = root.children;
  const explicitRight = kids.filter((c) => c.side === 'right').length;
  const free = kids.filter((c) => !c.side);
  const needRight = Math.max(0, Math.ceil(kids.length / 2) - explicitRight);
  free.forEach((c, i) => res.set(c.id, i < needRight ? 'right' : 'left'));
  kids.forEach((c) => c.side && res.set(c.id, c.side));
  return res;
}

function countDesc(t: Topic): number {
  return t.children.reduce((s, c) => s + 1 + countDesc(c), 0);
}

/** Фигурная скобка от top до bottom, острие в mid, направление dir */
function bracePath(x: number, top: number, bottom: number, mid: number, dir: 1 | -1, depth: number): string {
  const d = depth * dir;
  const m = Math.max(top + 8, Math.min(bottom - 8, mid));
  const q = Math.min(12, (m - top) / 2, (bottom - m) / 2);
  return [
    `M${x + d},${top}`,
    `Q${x},${top} ${x},${top + q}`,
    `V${m - q}`,
    `Q${x},${m} ${x - d * 0.6},${m}`,
    `Q${x},${m} ${x},${m + q}`,
    `V${bottom - q}`,
    `Q${x},${bottom} ${x + d},${bottom}`,
  ].join(' ');
}

/** Прямоугольник, охватывающий поддерево темы */
export function subtreeBounds(lay: LayoutResult, id: ID): Bounds | null {
  const n = lay.nodes.get(id);
  if (!n) return null;
  let minX = n.x, minY = n.y, maxX = n.x + n.w, maxY = n.y + n.h;
  const rec = (t: Topic) => {
    if (t.collapsed) return;
    for (const c of t.children) {
      const cn = lay.nodes.get(c.id);
      if (!cn) continue;
      minX = Math.min(minX, cn.x);
      minY = Math.min(minY, cn.y);
      maxX = Math.max(maxX, cn.x + cn.w);
      maxY = Math.max(maxY, cn.y + cn.h);
      rec(c);
    }
  };
  rec(n.topic);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export { bracePath };
