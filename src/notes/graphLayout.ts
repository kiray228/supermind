/**
 * Раскладка графа заметок: «пружины» по связям + взаимное отталкивание (Barnes–Hut, O(n log n))
 * + слабое притяжение к центру, чтобы одиночки и отдельные кучки не разлетались.
 * Как в d3-force: «температура» alpha остывает, движение затухает; перетаскивание снова «нагревает».
 * Модуль чистый — тесты гоняют его в Node.
 */

export interface GNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** закреплён (перетаскивается пальцем) */
  fx?: number;
  fy?: number;
  /** число связей */
  deg: number;
}

export interface GLink {
  s: number;
  t: number;
  /** сила связи 0…1 */
  w: number;
}

export interface LayoutOpts {
  /** отталкивание (чем больше — тем просторнее) */
  charge?: number;
  /** длина «пружины» сильной связи; слабые — длиннее */
  linkDistance?: number;
  /** притяжение к центру */
  gravity?: number;
}

const THETA2 = 0.81; // θ = 0.9
const DIST_MAX2 = 900 * 900;
const VELOCITY_DECAY = 0.6;
const ALPHA_MIN = 0.003;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);

interface Quad {
  x0: number;
  y0: number;
  size: number;
  /** сумма зарядов и центр масс */
  m: number;
  cx: number;
  cy: number;
  /** лист: один узел (или несколько совпавших) */
  leaf: number[] | null;
  kids: (Quad | null)[] | null;
}

/** Золотой угол: узлы без сохранённых координат раскладываются спиралью — без случайности, раскладка воспроизводима */
export function spiralPosition(i: number): { x: number; y: number } {
  const r = 12 * Math.sqrt(0.5 + i);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

export class ForceLayout {
  nodes: GNode[];
  links: GLink[];
  alpha = 1;
  /** высота / ширина экрана: на высоком экране граф сжимается по горизонтали и вытягивается по вертикали */
  aspect = 1;
  private charge: number;
  private dist: number;
  private gravity: number;
  private bias: number[];
  private strength: number[];

  constructor(nodes: GNode[], links: GLink[], opts: LayoutOpts = {}) {
    this.nodes = nodes;
    this.links = links;
    this.charge = opts.charge ?? 140;
    this.dist = opts.linkDistance ?? 46;
    this.gravity = opts.gravity ?? 0.035;
    for (const n of nodes) n.deg = 0;
    for (const l of links) {
      nodes[l.s].deg++;
      nodes[l.t].deg++;
    }
    // как в d3: пружина к узлу со множеством связей слабее, а лёгкий конец двигается больше
    this.strength = links.map((l) => 0.7 / Math.min(nodes[l.s].deg, nodes[l.t].deg));
    this.bias = links.map((l) => nodes[l.s].deg / (nodes[l.s].deg + nodes[l.t].deg));
  }

  /** Ещё движется (стоит рисовать дальше) */
  get active(): boolean {
    return this.alpha >= ALPHA_MIN;
  }

  /** «Подогреть» — после перетаскивания или изменения графа */
  reheat(a = 0.3) {
    this.alpha = Math.max(this.alpha, a);
  }

  tick(): void {
    const { nodes, links, alpha } = this;
    if (!nodes.length) return;
    this.alpha += (0 - this.alpha) * ALPHA_DECAY;

    // пружины
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      const a = nodes[l.s];
      const b = nodes[l.t];
      let dx = b.x + b.vx - a.x - a.vx || jiggle(i);
      let dy = b.y + b.vy - a.y - a.vy || jiggle(i + 1);
      const d = Math.sqrt(dx * dx + dy * dy);
      const target = this.dist * (1.6 - 0.9 * Math.min(1, l.w * 2));
      const k = ((d - target) / d) * alpha * this.strength[i];
      dx *= k;
      dy *= k;
      const bb = this.bias[i];
      b.vx -= dx * bb;
      b.vy -= dy * bb;
      a.vx += dx * (1 - bb);
      a.vy += dy * (1 - bb);
    }

    // отталкивание
    const root = this.buildTree();
    for (let i = 0; i < nodes.length; i++) this.repel(root, i, alpha);

    // к центру (по осям — с учётом формы экрана)
    const sa = Math.sqrt(Math.min(3, Math.max(1 / 3, this.aspect)));
    const gx = this.gravity * alpha * sa;
    const gy = (this.gravity * alpha) / sa;
    for (const n of nodes) {
      n.vx -= n.x * gx;
      n.vy -= n.y * gy;
    }

    // движение
    for (const n of nodes) {
      if (n.fx !== undefined && n.fy !== undefined) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = n.vy = 0;
        continue;
      }
      n.vx *= VELOCITY_DECAY;
      n.vy *= VELOCITY_DECAY;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  /** Прогнать без отрисовки (до остывания или maxTicks) */
  run(maxTicks = 400): number {
    let n = 0;
    while (this.active && n < maxTicks) {
      this.tick();
      n++;
    }
    return n;
  }

  private buildTree(): Quad {
    const { nodes } = this;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of nodes) {
      if (n.x < x0) x0 = n.x;
      if (n.y < y0) y0 = n.y;
      if (n.x > x1) x1 = n.x;
      if (n.y > y1) y1 = n.y;
    }
    const size = Math.max(x1 - x0, y1 - y0, 1) * 1.0001;
    const root: Quad = { x0, y0, size, m: 0, cx: 0, cy: 0, leaf: null, kids: null };
    for (let i = 0; i < nodes.length; i++) insert(root, nodes, i, 0);
    accumulate(root, nodes);
    return root;
  }

  private repel(q: Quad, i: number, alpha: number) {
    const n = this.nodes[i];
    const dx = q.cx - n.x;
    const dy = q.cy - n.y;
    let d2 = dx * dx + dy * dy;
    // далёкая клетка — как один заряд в центре масс
    if (!q.leaf && q.kids && (q.size * q.size) / THETA2 < d2) {
      if (d2 < DIST_MAX2) {
        if (d2 < 1) d2 = Math.sqrt(d2 + 1);
        const k = (-this.charge * alpha * q.m) / d2;
        n.vx += dx * k;
        n.vy += dy * k;
      }
      return;
    }
    if (q.leaf) {
      for (const j of q.leaf) {
        if (j === i) continue;
        const o = this.nodes[j];
        let ex = o.x - n.x;
        let ey = o.y - n.y;
        if (!ex && !ey) {
          ex = jiggle(i * 31 + j);
          ey = jiggle(i * 17 + j * 7);
        }
        let e2 = ex * ex + ey * ey;
        if (e2 >= DIST_MAX2) continue;
        if (e2 < 1) e2 = Math.sqrt(e2 + 1);
        const k = (-this.charge * alpha) / e2;
        n.vx += ex * k;
        n.vy += ey * k;
      }
      return;
    }
    for (const c of q.kids!) if (c) this.repel(c, i, alpha);
  }
}

/** Крошечный детерминированный сдвиг для совпавших точек */
function jiggle(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 1e-3;
}

function insert(q: Quad, nodes: GNode[], i: number, depth: number) {
  if (!q.kids && !q.leaf) {
    q.leaf = [i];
    return;
  }
  if (q.leaf) {
    const first = nodes[q.leaf[0]];
    // совпавшие точки или слишком глубоко — копим в листе
    if (depth > 40 || (first.x === nodes[i].x && first.y === nodes[i].y)) {
      q.leaf.push(i);
      return;
    }
    const old = q.leaf;
    q.leaf = null;
    q.kids = [null, null, null, null];
    for (const j of old) place(q, nodes, j, depth);
  }
  place(q, nodes, i, depth);
}

function place(q: Quad, nodes: GNode[], i: number, depth: number) {
  const h = q.size / 2;
  const n = nodes[i];
  const right = n.x >= q.x0 + h ? 1 : 0;
  const bottom = n.y >= q.y0 + h ? 1 : 0;
  const k = right + bottom * 2;
  let c = q.kids![k];
  if (!c) c = q.kids![k] = { x0: q.x0 + right * h, y0: q.y0 + bottom * h, size: h, m: 0, cx: 0, cy: 0, leaf: null, kids: null };
  insert(c, nodes, i, depth + 1);
}

function accumulate(q: Quad, nodes: GNode[]) {
  if (q.leaf) {
    let x = 0;
    let y = 0;
    for (const j of q.leaf) {
      x += nodes[j].x;
      y += nodes[j].y;
    }
    q.m = q.leaf.length;
    q.cx = x / q.m;
    q.cy = y / q.m;
    return;
  }
  let m = 0;
  let x = 0;
  let y = 0;
  for (const c of q.kids!) {
    if (!c) continue;
    accumulate(c, nodes);
    m += c.m;
    x += c.cx * c.m;
    y += c.cy * c.m;
  }
  q.m = m;
  q.cx = m ? x / m : 0;
  q.cy = m ? y / m : 0;
}

/** Рамка вокруг узлов — чтобы вписать граф в экран */
export function bounds(nodes: { x: number; y: number }[]): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!nodes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x);
    y1 = Math.max(y1, n.y);
  }
  return { x0, y0, x1, y1 };
}
