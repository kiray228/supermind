/**
 * Холст графа заметок: камера (сдвиг, масштаб), жесты (палец, мышь, колесо, щипок),
 * перетаскивание узлов и отрисовка. React передаёт данные через методы — сам холст живёт вне рендера.
 */
import { bounds, ForceLayout, type GLink, type GNode, spiralPosition } from '../graphLayout';

export interface ViewNode {
  id: string;
  label: string;
  color: string;
}

export interface ViewLink {
  a: string;
  b: string;
  w: number;
}

interface Callbacks {
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
}

/** Координаты узлов между открытиями графа — чтобы раскладка не прыгала */
const saved = new Map<string, { x: number; y: number }>();

const TAP_SLOP = 7;
const MIN_K = 0.12;
const MAX_K = 4;

export class GraphView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: Callbacks;
  private nodes: (GNode & ViewNode)[] = [];
  private links: GLink[] = [];
  private byId = new Map<string, number>();
  private adj: Set<number>[] = [];
  private layout: ForceLayout | null = null;

  private w = 0;
  private h = 0;
  private dpr = 1;
  private cam = { x: 0, y: 0, k: 1 };
  private camAnim: { from: { x: number; y: number; k: number }; to: { x: number; y: number; k: number }; t0: number } | null = null;
  /** человек сам двигал камеру — не вписывать граф автоматически */
  private touched = false;
  private fitted = false;

  private sel = -1;
  private hover = -1;
  private highlight: Set<string> | null = null;

  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { kind: 'pan' | 'node' | 'pinch'; node?: number; sx: number; sy: number; t: number; moved: boolean; dist?: number } | null = null;
  private frame = 0;
  private ro: ResizeObserver;
  private colors = { accent: '#007aff', text: '#000', text2: '#666', text3: '#aaa', bg: '#fff' };

  constructor(canvas: HTMLCanvasElement, cb: Callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.cb = cb;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDbl);
    this.resize();
  }

  destroy() {
    this.savePositions();
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('dblclick', this.onDbl);
  }

  // ---------- Данные ----------

  setData(list: ViewNode[], links: ViewLink[]) {
    this.savePositions();
    const selId = this.sel >= 0 ? this.nodes[this.sel]?.id : null;
    let fresh = 0;
    this.nodes = list.map((v, i) => {
      const p = saved.get(v.id);
      if (!p) fresh++;
      const pos = p ?? spiralPosition(i);
      return { ...v, x: pos.x, y: pos.y, vx: 0, vy: 0, deg: 0 };
    });
    this.byId = new Map(this.nodes.map((n, i) => [n.id, i]));
    this.links = [];
    for (const l of links) {
      const s = this.byId.get(l.a);
      const t = this.byId.get(l.b);
      if (s !== undefined && t !== undefined && s !== t) this.links.push({ s, t, w: l.w });
    }
    this.adj = this.nodes.map(() => new Set<number>());
    for (const l of this.links) {
      this.adj[l.s].add(l.t);
      this.adj[l.t].add(l.s);
    }
    this.layout = new ForceLayout(this.nodes, this.links);
    if (this.w && this.h) this.layout.aspect = this.h / this.w;
    // почти всё уже разложено — лёгкий «подогрев», иначе — полный расчёт
    this.layout.alpha = fresh > this.nodes.length * 0.2 ? 1 : 0.25;
    // первые шаги — до показа, чтобы граф не начинался «клубком»
    const t0 = performance.now();
    while (this.layout.active && performance.now() - t0 < 120) this.layout.tick();
    this.sel = selId ? (this.byId.get(selId) ?? -1) : -1;
    if (selId && this.sel < 0) this.cb.onSelect(null);
    this.hover = -1;
    if (!this.touched) this.fit(false);
    this.request();
  }

  setHighlight(ids: Set<string> | null) {
    this.highlight = ids;
    this.request();
  }

  select(id: string | null, center = false) {
    this.sel = id ? (this.byId.get(id) ?? -1) : -1;
    if (center && this.sel >= 0) {
      // в верхней части экрана — снизу карточка заметки
      const n = this.nodes[this.sel];
      const k = Math.max(this.cam.k, 1.2);
      this.animateTo({ x: n.x, y: n.y + (this.h * 0.15) / k, k });
    }
    this.request();
  }

  has(id: string) {
    return this.byId.has(id);
  }

  /** Вписать весь граф в экран */
  fit(animate = true) {
    const b = bounds(this.nodes);
    if (!b || !this.w || !this.h) return;
    // свободная часть холста: сверху — счётчик, справа — кнопки, снизу на телефоне — меню приложения
    const ins = { t: 56, r: 60, b: this.w < 760 ? 104 : 20, l: 12 };
    const aw = Math.max(80, this.w - ins.l - ins.r);
    const ah = Math.max(80, this.h - ins.t - ins.b);
    // запас по бокам — под подписи, снизу — под подпись нижнего узла
    const k = clamp(Math.min((aw - Math.min(150, aw * 0.3)) / Math.max(1, b.x1 - b.x0), (ah - 50) / Math.max(1, b.y1 - b.y0)), MIN_K, 1.6);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2 + 8 / k;
    const to = { x: cx - (ins.l + aw / 2 - this.w / 2) / k, y: cy - (ins.t + ah / 2 - this.h / 2) / k, k };
    if (animate) this.animateTo(to);
    else this.cam = to;
    this.fitted = true;
    this.request();
  }

  zoomBy(f: number) {
    this.touched = true;
    this.animateTo({ ...this.cam, k: clamp(this.cam.k * f, MIN_K, MAX_K) });
  }

  private savePositions() {
    for (const n of this.nodes) saved.set(n.id, { x: n.x, y: n.y });
  }

  // ---------- Камера ----------

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (this.layout && r.width && r.height) {
      // форма экрана заметно изменилась (поворот телефона, окно) — граф мягко перестраивается под неё
      const a = r.height / r.width;
      const was = this.layout.aspect;
      this.layout.aspect = a;
      if (Math.abs(Math.log(a / was)) > 0.25) {
        this.layout.reheat(0.5);
        if (!this.touched) this.fitted = false;
      }
    }
    if (!this.fitted && !this.touched) this.fit(false);
    this.request();
  }

  private animateTo(to: { x: number; y: number; k: number }) {
    this.camAnim = { from: { ...this.cam }, to, t0: performance.now() };
    this.request();
  }

  private toWorld(sx: number, sy: number) {
    return { x: (sx - this.w / 2) / this.cam.k + this.cam.x, y: (sy - this.h / 2) / this.cam.k + this.cam.y };
  }

  private local(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private radius(n: GNode) {
    return 4.5 + Math.sqrt(n.deg) * 2.4;
  }

  /** Узел под точкой экрана (с запасом под палец) */
  private hit(sx: number, sy: number, touch: boolean): number {
    const p = this.toWorld(sx, sy);
    const slop = (touch ? 14 : 6) / this.cam.k;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const d = Math.hypot(n.x - p.x, n.y - p.y) - Math.max(this.radius(n), 3 / this.cam.k);
      if (d < slop && d < bd) [best, bd] = [i, d];
    }
    return best;
  }

  // ---------- Жесты ----------

  private onDown = (e: PointerEvent) => {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.camAnim = null;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.releaseNode();
      this.gesture = { kind: 'pinch', sx: p.x, sy: p.y, t: performance.now(), moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    if (this.pointers.size > 2) return;
    const node = this.hit(p.x, p.y, e.pointerType !== 'mouse');
    this.gesture = { kind: node >= 0 ? 'node' : 'pan', node, sx: p.x, sy: p.y, t: performance.now(), moved: false };
  };

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      // мышь без нажатия — подсветка под курсором
      if (e.pointerType === 'mouse') {
        const h = this.hit(p.x, p.y, false);
        if (h !== this.hover) {
          this.hover = h;
          this.canvas.style.cursor = h >= 0 ? 'pointer' : 'grab';
          this.request();
        }
      }
      return;
    }
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const before = this.toWorld(mid.x, mid.y);
      this.cam.k = clamp(this.cam.k * (dist / (g.dist || dist)), MIN_K, MAX_K);
      g.dist = dist;
      // точка между пальцами остаётся на месте, плюс сдвиг двумя пальцами
      const after = this.toWorld(mid.x, mid.y);
      this.cam.x += before.x - after.x - (p.x - prev.x) / 2 / this.cam.k;
      this.cam.y += before.y - after.y - (p.y - prev.y) / 2 / this.cam.k;
      this.touched = true;
      this.request();
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) < TAP_SLOP) return;
    g.moved = true;
    this.touched = true;
    if (g.kind === 'node' && g.node !== undefined && g.node >= 0) {
      const w = this.toWorld(p.x, p.y);
      const n = this.nodes[g.node];
      n.fx = w.x;
      n.fy = w.y;
      this.layout?.reheat(0.25);
      this.canvas.style.cursor = 'grabbing';
    } else {
      this.cam.x -= (p.x - prev.x) / this.cam.k;
      this.cam.y -= (p.y - prev.y) / this.cam.k;
      this.canvas.style.cursor = 'grabbing';
    }
    this.request();
  };

  private onUp = (e: PointerEvent) => {
    const had = this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!had || !g) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size === 0) this.gesture = null;
      else {
        // остался один палец — продолжаем сдвиг
        const [q] = [...this.pointers.values()];
        this.gesture = { kind: 'pan', sx: q.x, sy: q.y, t: performance.now(), moved: true };
      }
      return;
    }
    this.gesture = null;
    this.canvas.style.cursor = '';
    if (g.kind === 'node') this.releaseNode(g.node);
    if (g.moved || e.type === 'pointercancel') return;
    // нажатие: узел — выбрать (повторно — открыть), пусто — снять выбор
    const node = g.kind === 'node' ? g.node! : -1;
    if (node >= 0 && node === this.sel && e.pointerType !== 'mouse') {
      this.cb.onOpen(this.nodes[node].id);
      return;
    }
    this.sel = node;
    this.cb.onSelect(node >= 0 ? this.nodes[node].id : null);
    // выбранный узел не должен прятаться под карточкой снизу
    if (node >= 0) {
      const n = this.nodes[node];
      const y = (n.y - this.cam.y) * this.cam.k + this.h / 2;
      if (y > this.h * 0.55) this.animateTo({ ...this.cam, y: n.y + (this.h * 0.15) / this.cam.k });
    }
    this.request();
  };

  private onLeave = () => {
    if (this.hover >= 0 && !this.pointers.size) {
      this.hover = -1;
      this.request();
    }
  };

  private onDbl = (e: MouseEvent) => {
    const p = this.local(e);
    const node = this.hit(p.x, p.y, false);
    if (node >= 0) this.cb.onOpen(this.nodes[node].id);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    // тачпад: щипок приходит как ctrl+wheel, прокрутка двумя пальцами — сдвиг
    if (!e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0.5) {
      this.cam.x += e.deltaX / this.cam.k;
      this.cam.y += e.deltaY / this.cam.k;
    } else {
      const before = this.toWorld(p.x, p.y);
      const unit = e.deltaMode === 1 ? 16 : 1;
      this.cam.k = clamp(this.cam.k * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018)), MIN_K, MAX_K);
      const after = this.toWorld(p.x, p.y);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
    }
    this.camAnim = null;
    this.touched = true;
    this.request();
  };

  private releaseNode(i?: number) {
    for (const n of i !== undefined && i >= 0 ? [this.nodes[i]] : this.nodes) {
      if (n?.fx !== undefined) {
        delete n.fx;
        delete n.fy;
        this.layout?.reheat(0.08);
      }
    }
  }

  // ---------- Отрисовка ----------

  private request() {
    if (!this.frame) this.frame = requestAnimationFrame(this.draw);
  }

  private readColors() {
    const cs = getComputedStyle(this.canvas);
    const v = (name: string, def: string) => cs.getPropertyValue(name).trim() || def;
    this.colors = { accent: v('--accent', '#007aff'), text: v('--text', '#000'), text2: v('--text-2', '#666'), text3: v('--text-3', '#999'), bg: v('--bg', '#fff') };
  }

  private draw = () => {
    this.frame = 0;
    if (!this.w || !this.h) return;
    const lay = this.layout;
    // физика: несколько шагов за кадр, но не дольше ~8 мс
    if (lay?.active) {
      const t0 = performance.now();
      do lay.tick();
      while (lay.active && performance.now() - t0 < 8);
      // остыла впервые, а человек ещё ничего не трогал — вписать
      if (!lay.active && !this.touched) this.fit(true);
    }
    if (this.camAnim) {
      const t = Math.min(1, (performance.now() - this.camAnim.t0) / 320);
      const e = 1 - Math.pow(1 - t, 3);
      const { from, to } = this.camAnim;
      this.cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      if (t >= 1) this.camAnim = null;
    }
    this.readColors();
    this.paint();
    if (lay?.active || this.camAnim) this.request();
  };

  private paint() {
    const { ctx, nodes, links, cam, colors, dpr } = this;
    const k = cam.k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const sx = (x: number) => (x - cam.x) * k + this.w / 2;
    const sy = (y: number) => (y - cam.y) * k + this.h / 2;

    const focus = this.sel >= 0 ? this.sel : this.hover;
    const near = focus >= 0 ? this.adj[focus] : null;
    const hl = this.highlight;
    const dim = (i: number) => (near ? i !== focus && !near.has(i) : hl ? !hl.has(nodes[i].id) : false);

    // связи: обычные — одним путём на каждую из трёх яркостей
    ctx.lineCap = 'round';
    const buckets: GLink[][] = [[], [], []];
    const lit: GLink[] = [];
    for (const l of links) {
      if (focus >= 0 && (l.s === focus || l.t === focus)) lit.push(l);
      else buckets[l.w >= 0.3 ? 2 : l.w >= 0.16 ? 1 : 0].push(l);
    }
    const faded = focus >= 0 || !!hl;
    ctx.strokeStyle = colors.text2;
    ctx.lineWidth = Math.max(0.8, Math.min(2, 1.3 * Math.sqrt(k)));
    const alphas = faded ? [0.07, 0.09, 0.12] : [0.38, 0.55, 0.75];
    buckets.forEach((list, bi) => {
      if (!list.length) return;
      ctx.globalAlpha = alphas[bi];
      ctx.beginPath();
      for (const l of list) {
        const a = nodes[l.s];
        const b = nodes[l.t];
        ctx.moveTo(sx(a.x), sy(a.y));
        ctx.lineTo(sx(b.x), sy(b.y));
      }
      ctx.stroke();
    });
    if (lit.length) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = colors.accent;
      for (const l of lit) {
        ctx.lineWidth = 1 + l.w * 3.2;
        ctx.beginPath();
        ctx.moveTo(sx(nodes[l.s].x), sy(nodes[l.s].y));
        ctx.lineTo(sx(nodes[l.t].x), sy(nodes[l.t].y));
        ctx.stroke();
      }
    }

    // узлы
    const pad = 40;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const x = sx(n.x);
      const y = sy(n.y);
      if (x < -pad || y < -pad || x > this.w + pad || y > this.h + pad) continue;
      const r = Math.max(2.5, this.radius(n) * k);
      ctx.globalAlpha = dim(i) ? 0.18 : 1;
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (i === this.sel || (hl && hl.has(n.id) && !near)) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = i === this.sel ? colors.text : colors.accent;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // подписи: сначала важные (выбранная, соседи, найденные, крупные узлы), без наложений
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const order = nodes.map((_, i) => i);
    const prio = (i: number) => (i === focus ? 4 : near?.has(i) ? 3 : hl?.has(nodes[i].id) ? 2 : 0) + nodes[i].deg / 100;
    order.sort((a, b) => prio(b) - prio(a));
    const taken: [number, number, number, number][] = [];
    // небольшой граф подписан целиком (насколько позволяет место), большой — при приближении
    const showAll = k >= 1.3 || nodes.length <= 60;
    const maxLabels = 160;
    let shown = 0;
    for (const i of order) {
      if (shown >= maxLabels) break;
      const n = nodes[i];
      const p = prio(i);
      const important = p >= 2;
      if (!important && dim(i)) continue;
      if (!important && !showAll && !(k >= 0.55 && n.deg >= 3)) continue;
      const x = sx(n.x);
      const r = Math.max(2.5, this.radius(n) * k);
      const cy = sy(n.y);
      if (x < -100 || cy < -20 || x > this.w + 100 || cy > this.h + 20) continue;
      const strong = i === focus;
      ctx.font = `${strong ? 650 : 500} ${strong ? 13 : 12}px -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif`;
      const text = n.label.length > 32 ? n.label.slice(0, 31) + '…' : n.label;
      const tw = ctx.measureText(text).width;
      // под узлом, а если занято — над ним
      const at = (y: number): [number, number, number, number] => [x - tw / 2 - 2, y - 1, x + tw / 2 + 2, y + 15];
      const free = (b: [number, number, number, number]) => !taken.some((t) => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1]);
      let y = cy + r + 3;
      if (!strong && !free(at(y))) {
        y = cy - r - 17;
        if (!free(at(y))) continue;
      }
      taken.push(at(y));
      shown++;
      ctx.strokeStyle = colors.bg;
      ctx.lineWidth = 3.5;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = strong ? colors.text : colors.text2;
      ctx.fillText(text, x, y);
    }
    ctx.globalAlpha = 1;
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
