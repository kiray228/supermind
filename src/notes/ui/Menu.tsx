import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type MenuAnchor = HTMLElement | { x: number; y: number };

/**
 * Всплывающее меню поверх экрана (в body). Позиция подгоняется под видимую область
 * (на iPhone — над клавиатурой). Любой пункт закрывает меню. keepFocus — не снимать фокус с поля ввода.
 */
export function NtMenu({ anchor, onClose, children, keepFocus, className = '' }: { anchor: MenuAnchor; onClose: () => void; children: ReactNode; keepFocus?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vv = window.visualViewport;
    const vt = vv?.offsetTop ?? 0;
    const vh = vv?.height ?? window.innerHeight;
    const vw = window.innerWidth;
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const w = el.offsetWidth;
    const h = el.scrollHeight;
    const below = vt + vh - r.bottom - 8;
    const above = r.top - vt - 8;
    const down = below >= Math.min(h, 260) || below >= above;
    const maxHeight = Math.max(120, down ? below - 4 : above - 4);
    const top = down ? r.bottom + 4 : Math.max(vt + 8, r.top - 4 - Math.min(h, maxHeight));
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    setPos({ left, top, maxHeight });
  }, [anchor]);

  const keep = keepFocus ? (e: { preventDefault(): void }) => e.preventDefault() : undefined;

  return createPortal(
    <>
      <div className="menu-layer nt-shield" onPointerDown={(e) => (e.preventDefault(), onClose())} />
      <div
        ref={ref}
        className={`menu nt-menu ${className}`}
        style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { left: -9999, top: 0 }}
        onPointerDown={keep}
        onMouseDown={keep}
        onClick={onClose}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export function MenuItem({ icon, label, onClick, danger, active, hint }: { icon?: ReactNode; label: string; onClick: () => void; danger?: boolean; active?: boolean; hint?: string }) {
  return (
    <button className={`nt-mi${danger ? ' danger' : ''}${active ? ' active' : ''}`} onClick={onClick}>
      <span className="nt-mi-ic">{icon}</span>
      <span className="grow ellipsis">{label}</span>
      {hint && <span className="nt-mi-hint">{hint}</span>}
    </button>
  );
}

export const MenuSep = () => <div className="sep" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <div className="nt-mlabel">{children}</div>;
