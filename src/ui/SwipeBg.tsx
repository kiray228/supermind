/** Фон под сдвигаемой строкой: слева — главное действие (зелёный), справа — «Удалить» (красный). */
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Check, Trash2 } from 'lucide-react';
import './swipe.css';

export function SwipeBg({
  dx,
  armed,
  onDelete,
  rightLabel = 'Готово',
  rightIcon,
  deleteLabel = 'Удалить',
}: {
  dx: number;
  armed: boolean;
  onDelete: (e: ReactMouseEvent) => void;
  rightLabel?: string;
  rightIcon?: ReactNode;
  deleteLabel?: string;
}) {
  if (!dx) return null;
  return dx > 0 ? (
    <div className="sw-bg sw-bg-right" aria-hidden>
      <span className={`sw-act${armed ? ' armed' : ''}`}>
        {rightIcon ?? <Check size={22} strokeWidth={2.6} />}
        <span>{rightLabel}</span>
      </span>
    </div>
  ) : (
    <div className="sw-bg sw-bg-del">
      <button className={`sw-act sw-del${armed ? ' armed' : ''}`} onClick={onDelete} aria-label={deleteLabel}>
        <Trash2 size={21} strokeWidth={2.4} />
        <span>{deleteLabel}</span>
      </button>
    </div>
  );
}
