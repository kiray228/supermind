/**
 * Перетаскивание задач пальцем (мышью — обычный drag-and-drop браузера): строка «поднимается»,
 * едет за пальцем, место под пальцем подсвечивается, у края экрана список сам прокручивается.
 * Приёмники — группы, колонки канбана, квадранты матрицы (DropZone в Tasks.tsx регистрирует себя здесь).
 */

interface Zone {
  el: HTMLElement;
  onDrop: (taskId: string) => void;
  setOver: (v: boolean) => void;
}

const zones = new Set<Zone>();

/** Приёмник: вернуть функцию снятия */
export function registerDropZone(z: Zone): () => void {
  zones.add(z);
  return () => void zones.delete(z);
}

const zoneAt = (x: number, y: number): Zone | null => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  // самый вложенный приёмник под пальцем
  let best: Zone | null = null;
  for (const z of zones) if (z.el.contains(el) && (!best || best.el.contains(z.el))) best = z;
  return best;
};

/** Ближайший прокручиваемый предок по оси */
function scroller(el: Element | null, axis: 'x' | 'y'): HTMLElement | null {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    const st = getComputedStyle(n);
    const ov = axis === 'y' ? st.overflowY : st.overflowX;
    if ((ov === 'auto' || ov === 'scroll') && (axis === 'y' ? n.scrollHeight > n.clientHeight : n.scrollWidth > n.clientWidth)) return n;
  }
  return null;
}

let active = false;

/** Начать перетаскивание строки задачи пальцем из точки (x, y) */
export function startTouchDrag(taskId: string, row: HTMLElement, x: number, y: number) {
  if (active) return;
  active = true;
  const r = row.getBoundingClientRect();
  const dx = x - r.left;
  const dy = y - r.top;
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.classList.add('tk-drag-ghost');
  Object.assign(ghost.style, { position: 'fixed', left: '0', top: '0', width: `${r.width}px`, margin: '0', zIndex: '1000', pointerEvents: 'none' });
  document.body.appendChild(ghost);
  row.classList.add('tk-drag-src');
  let px = x;
  let py = y;
  let over: Zone | null = null;
  /** шаг прокрутки у края (таймер, а не кадры: так же и в фоне, и в тестах) */
  let raf: ReturnType<typeof setTimeout> | 0 = 0;
  /** прокрутка «по колонкам» (scroll-snap) возвращала бы сдвиг назад — на время перетаскивания выключаем */
  const unsnapped = new Map<HTMLElement, string>();
  const scrollBy = (s: HTMLElement, axis: 'x' | 'y', v: number) => {
    if (!unsnapped.has(s)) {
      unsnapped.set(s, s.style.scrollSnapType);
      s.style.scrollSnapType = 'none';
    }
    if (axis === 'y') s.scrollTop += v;
    else s.scrollLeft += v;
  };

  const place = () => {
    ghost.style.transform = `translate(${px - dx}px, ${py - dy}px) rotate(1.5deg)`;
  };
  place();

  const setOver = (z: Zone | null) => {
    if (z === over) return;
    over?.setOver(false);
    over = z;
    if (z) {
      z.setOver(true);
      navigator.vibrate?.(6);
    }
  };

  // у края — прокрутка того, что под пальцем (список вниз-вверх, канбан вбок)
  const EDGE = 56;
  const tick = () => {
    raf = 0;
    if (!active) return;
    let moved = false;
    const vy = py < EDGE ? -1 : py > window.innerHeight - EDGE ? 1 : 0;
    const vx = px < EDGE ? -1 : px > window.innerWidth - EDGE ? 1 : 0;
    // у самого края палец часто над полями страницы — что прокручивать, ищем чуть внутрь
    if (vy) {
      const s = scroller(document.elementFromPoint(px, py - vy * EDGE), 'y');
      if (s) {
        scrollBy(s, 'y', vy * 12);
        moved = true;
      }
    }
    if (vx) {
      const s = scroller(document.elementFromPoint(px - vx * EDGE, py), 'x');
      if (s) {
        scrollBy(s, 'x', vx * 14);
        moved = true;
      }
    }
    if (moved) {
      setOver(zoneAt(px, py));
      raf = setTimeout(tick, 16);
    }
  };

  const move = (e: PointerEvent) => {
    px = e.clientX;
    py = e.clientY;
    place();
    setOver(zoneAt(px, py));
    if (!raf) raf = setTimeout(tick, 16);
  };
  const block = (e: TouchEvent) => e.cancelable && e.preventDefault();
  const end = (drop: boolean) => {
    if (!active) return;
    active = false;
    if (raf) clearTimeout(raf);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('touchmove', block);
    const z = over;
    setOver(null);
    ghost.remove();
    row.classList.remove('tk-drag-src');
    for (const [s, v] of unsnapped) s.style.scrollSnapType = v;
    if (drop && z) z.onDrop(taskId);
  };
  const up = () => end(true);
  const cancel = () => end(false);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('touchmove', block, { passive: false });
  setOver(zoneAt(px, py));
}
