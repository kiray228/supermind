/**
 * Жесты для карточек и строк списков — одинаково во всех разделах:
 * - долгое нажатие — меню действий (а не выделение текста на iPhone);
 * - свайп влево — «Удалить» (длинный свайп удаляет сразу), свайп вправо — главное действие (выполнить/отметить).
 * Разметка свайпа: обёртка `.sw-wrap` (ref = swipe.wrap) с фоном `<SwipeBg>` и сдвигаемой строкой (style = swipe.style).
 */
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

const haptic = () => {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* нет вибрации */
  }
};

/** Долгое нажатие (палец ~0.5 с без сдвига) и правая кнопка мыши; клик после долгого нажатия гасится */
export function useLongPress(fn: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      fired.current = false;
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fired.current = true;
        start.current = null;
        haptic();
        fn();
      }, 480);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel();
    },
    onPointerUp: () => cancel(),
    onPointerCancel: () => cancel(),
    onClickCapture: (e: ReactMouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      // на телефоне меню уже открыто долгим нажатием
      if (fired.current) return;
      cancel();
      fn();
    },
  };
}


type Handlers = {
  onPointerDown?: (e: ReactPointerEvent) => void;
  onPointerMove?: (e: ReactPointerEvent) => void;
  onPointerUp?: (e: ReactPointerEvent) => void;
  onPointerCancel?: (e: ReactPointerEvent) => void;
  onClickCapture?: (e: ReactMouseEvent) => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
};

/** Объединить обработчики нескольких жестов (долгое нажатие + свайп) на одном элементе */
export function mergeHandlers(...list: Handlers[]): Required<Handlers> {
  const call =
    <K extends keyof Handlers>(k: K) =>
    (e: Parameters<NonNullable<Handlers[K]>>[0]) => {
      for (const h of list) (h[k] as ((ev: typeof e) => void) | undefined)?.(e);
    };
  return {
    onPointerDown: call('onPointerDown'),
    onPointerMove: call('onPointerMove'),
    onPointerUp: call('onPointerUp'),
    onPointerCancel: call('onPointerCancel'),
    onClickCapture: call('onClickCapture'),
    onContextMenu: call('onContextMenu'),
  };
}

/**
 * Свайп строки/карточки пальцем (мышью — нет: там меню по правой кнопке).
 * Влево: открывается «Удалить» (OPEN px), дальше половины ширины — удаляется сразу (onDelete после анимации).
 * Вправо: если есть onRight — дальше RIGHT_AT px выполняет его и строка возвращается на место; иначе вправо не двигается.
 */
export function useSwipeActions({ onDelete, onRight }: { onDelete?: () => void; onRight?: () => void }) {
  const OPEN = 96;
  const RIGHT_AT = 84;
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(false);
  /** палец ведёт строку — без анимации сдвига */
  const [dragging, setDragging] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: number; horiz: boolean | null; base: number } | null>(null);
  const moved = useRef(false);
  /** сдвиг на последнем движении пальца (состояние могло ещё не обновиться) */
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const width = () => wrap.current?.offsetWidth ?? 360;

  // открытая кнопка закрывается касанием в любом другом месте
  useEffect(() => {
    if (!dx || drag.current) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setDx(0);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [dx]);

  const remove = () => {
    if (!onDelete) return;
    setGone(true);
    setDx(-width());
    timer.current = setTimeout(onDelete, 180);
  };
  const bind: Handlers = {
    onPointerDown: (e) => {
      moved.current = false;
      if (e.pointerType === 'mouse' || gone) return;
      drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horiz: null, base: dx };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const mx = e.clientX - d.x;
      const my = e.clientY - d.y;
      if (d.horiz === null && Math.abs(mx) + Math.abs(my) > 10) d.horiz = Math.abs(mx) > Math.abs(my) * 1.3;
      if (!d.horiz) return;
      moved.current = true;
      setDragging(true);
      const w = width();
      const min = onDelete ? -w : 0;
      // вправо — с сопротивлением после порога
      const raw = d.base + mx;
      const max = onRight ? RIGHT_AT + 40 : 0;
      last.current = Math.max(min, Math.min(raw > RIGHT_AT ? RIGHT_AT + (raw - RIGHT_AT) * 0.3 : raw, max));
      setDx(last.current);
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      setDragging(false);
      if (!d?.horiz) return;
      const v = last.current;
      if (v >= RIGHT_AT && onRight) {
        setDx(0);
        onRight();
      } else if (v < -width() * 0.5) remove();
      else setDx(v < -56 ? -OPEN : 0);
    },
    onClickCapture: (e) => {
      // после свайпа — не нажатие; открытая кнопка — касание закрывает её
      if (moved.current || dx) {
        moved.current = false;
        e.stopPropagation();
        e.preventDefault();
        if (dx && !drag.current) setDx(0);
      }
    },
  };
  bind.onPointerCancel = bind.onPointerUp;
  return {
    wrap,
    dx,
    gone,
    dragging,
    /** дотянули до «удалить сразу» / до главного действия */
    armed: dx < 0 ? -dx > width() * 0.5 : dx >= RIGHT_AT,
    /** класс обёртки */
    wrapClass: `sw-wrap${dx ? ' swiping' : ''}${dx > 0 ? ' to-right' : ''}${dragging ? ' dragging' : ''}${gone ? ' gone' : ''}`,
    /** стиль сдвигаемой строки */
    style: dx ? { transform: `translateX(${dx}px)` } : undefined,
    /** «Удалить» на открытой кнопке */
    confirmDelete: (e: ReactMouseEvent) => {
      e.stopPropagation();
      remove();
    },
    close: () => setDx(0),
    bind,
  };
}
