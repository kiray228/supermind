import { useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { clearCelebration, useGoals } from '../store';

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#facc15'];

/** Конфетти и значок цели после её выполнения */
export function Celebration() {
  const c = useGoals((s) => s.celebrate);
  useEffect(() => {
    if (!c) return;
    const t = setTimeout(clearCelebration, 3200);
    return () => clearTimeout(t);
  }, [c]);
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        x: Math.random() * 100,
        d: Math.random() * 0.6,
        t: 1.8 + Math.random() * 1.2,
        r: Math.round(Math.random() * 720 - 360),
        dx: Math.round(Math.random() * 120 - 60),
        c: COLORS[i % COLORS.length],
        w: 6 + Math.round(Math.random() * 6),
        round: i % 3 === 0,
      })),
    // новый набор для каждого праздника
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c?.at],
  );
  if (!c) return null;
  return createPortal(
    <div className="gl-celebrate" onPointerDown={clearCelebration} key={c.at}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={'gl-confetti' + (p.round ? ' is-round' : '')}
          style={{ left: `${p.x}%`, width: p.w, height: p.round ? p.w : p.w * 1.6, background: p.c, animationDelay: `${p.d}s`, animationDuration: `${p.t}s`, '--r': `${p.r}deg`, '--dx': `${p.dx}px` } as CSSProperties}
        />
      ))}
      <div className="gl-celebrate-card">
        <div className="gl-celebrate-emoji">{c.emoji || '🏆'}</div>
        <div className="gl-celebrate-title">Цель достигнута!</div>
        <div className="gl-celebrate-sub">{c.title}</div>
      </div>
    </div>,
    document.body,
  );
}
