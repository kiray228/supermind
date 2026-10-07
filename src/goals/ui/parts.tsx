import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { useTasks } from '../../tasks/store';
import { makeTaskLookup, type GoalsData, type LifeArea, type TaskLookup } from '../model';

/** Поиск задач по id (обновляется вместе с задачами) */
export function useTaskLookup(): TaskLookup {
  const tasks = useTasks((s) => s.data?.tasks);
  return useMemo(() => makeTaskLookup(tasks), [tasks]);
}

export function areaOf(d: GoalsData, id: string | undefined): LifeArea | undefined {
  return id ? d.areas.find((a) => a.id === id) : undefined;
}

export const areaColor = (a: LifeArea | undefined) => a?.color ?? 'var(--accent)';

/** Окно (на телефоне — шторка снизу). Вложенные окна выводятся рядом, а не внутри — так карточка задачи откроется поверх */
export function Sheet({ onClose, className, children, title, head }: { onClose: () => void; className?: string; children: ReactNode; title?: ReactNode; head?: ReactNode }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal gl-modal' + (className ? ' ' + className : '')} role="dialog">
        {(title || head) && (
          <div className="row gl-modal-head">
            {head ?? <h2 className="grow">{title}</h2>}
            <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
              <X />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Кольцо прогресса */
export function ProgressRing({ pct, size = 48, stroke = 4, color, children, className }: { pct: number; size?: number; stroke?: number; color?: string; children?: ReactNode; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className={'gl-ring' + (className ? ' ' + className : '')} style={{ width: size, height: size, '--rc': color ?? 'var(--accent)' } as CSSProperties}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
        <circle className="gl-ring-bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="gl-ring-fg"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="gl-ring-in">{children}</span>
    </span>
  );
}

export function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  return (
    <span className="gl-bar" style={{ '--rc': color ?? 'var(--accent)' } as CSSProperties}>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}
