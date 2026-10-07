import { useEffect, useState } from 'react';

/** Сенсорный экран (палец, а не мышь) */
export const isTouchUI = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Лёгкий тактильный отклик (Android; на iPhone в браузере вибрации нет — тихо пропускается) */
export function haptic(ms = 8) {
  if (!isTouchUI()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}

/** Насколько экранная клавиатура перекрывает низ окна (px). 0 — клавиатуры нет или окно уже ужато системой */
export function keyboardInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)));
}

/** Видимая область окна (без клавиатуры): верх и высота в координатах окна */
export function visibleViewport(): { top: number; height: number } {
  const vv = window.visualViewport;
  return vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: window.innerHeight };
}

/** Перекрытие клавиатурой + высота видимой области, обновляются при открытии/закрытии клавиатуры */
export function useKeyboardInset(): { inset: number; height: number } {
  const [s, setS] = useState(() => ({ inset: keyboardInset(), height: visibleViewport().height }));
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = { inset: keyboardInset(), height: Math.round(visibleViewport().height) };
        setS((p) => (p.inset === next.inset && p.height === next.height ? p : next));
      });
    };
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    window.addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, []);
  return s;
}
