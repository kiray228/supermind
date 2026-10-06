import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * Всплывающее меню поверх всего экрана (в body): окна с прокруткой его не обрезают.
 * Открывается под кнопкой, а если места внизу мало — над ней. Касание мимо или «Назад» закрывает.
 */
export function Popover({
  anchor,
  onClose,
  align = 'left',
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ left?: number; right?: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const vt = window.visualViewport?.offsetTop ?? 0;
    const below = vh + vt - r.bottom - 12;
    const above = r.top - vt - 12;
    const down = below >= 220 || below >= above;
    const h = { left: undefined as number | undefined, right: undefined as number | undefined };
    if (align === 'right') h.right = Math.max(8, window.innerWidth - r.right);
    else h.left = Math.max(8, Math.min(r.left, window.innerWidth - 248));
    setPos(down ? { ...h, top: r.bottom + 6, maxHeight: below } : { ...h, bottom: window.innerHeight - r.top + 6, maxHeight: above });
  }, [anchor, align]);

  return createPortal(
    <>
      <div className="menu-layer pop-shield" onPointerDown={onClose} />
      {pos && (
        <div className="td-pop pop-float" style={{ left: pos.left, right: pos.right, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }} onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </>,
    document.body,
  );
}
