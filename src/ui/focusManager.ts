/** Фокус в окнах и листах для клавиатуры и экранного диктора */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let focusManaged = false;
/**
 * Окна и листы для клавиатуры и экранного диктора: фокус переходит в открывшееся окно, Tab не уходит
 * на страницу под ним, после закрытия фокус возвращается туда, где был. Окно без роли получает role="dialog".
 * На сенсорных экранах в поле сами не встаём (иначе выскакивала бы клавиатура) — только по клавише Tab.
 */
export function installFocusManager() {
  if (focusManaged || typeof document === 'undefined') return;
  focusManaged = true;
  const coarse = () => window.matchMedia?.('(pointer: coarse)').matches;
  const back = new WeakMap<Element, HTMLElement>();
  const topOverlay = () => {
    const all = document.querySelectorAll<HTMLElement>('.modal-backdrop');
    return all[all.length - 1] ?? null;
  };
  const prepare = (ov: HTMLElement) => {
    const active = document.activeElement as HTMLElement | null;
    if (active && !ov.contains(active)) back.set(ov, active);
    const box = ov.querySelector<HTMLElement>('.modal, .dlg-as, [role=dialog], [role=alertdialog]') ?? ov;
    if (!box.getAttribute('role')) box.setAttribute('role', 'dialog');
    if (!box.hasAttribute('aria-modal')) box.setAttribute('aria-modal', 'true');
    // окно само ставит фокус (autofocus, свой эффект) — не мешаем
    setTimeout(() => {
      if (!ov.isConnected || ov.contains(document.activeElement) || coarse()) return;
      const first = box.querySelector<HTMLElement>('[autofocus]') ?? box.querySelector<HTMLElement>(FOCUSABLE);
      if (first) first.focus({ preventScroll: true });
      else {
        box.tabIndex = -1;
        box.focus({ preventScroll: true });
      }
    }, 60);
  };
  const restore = (ov: Element) => {
    const el = back.get(ov);
    if (el?.isConnected && !topOverlay()) el.focus({ preventScroll: true });
  };
  new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) if (n instanceof HTMLElement) for (const ov of n.matches('.modal-backdrop') ? [n] : [...n.querySelectorAll<HTMLElement>('.modal-backdrop')]) prepare(ov);
      for (const n of m.removedNodes) if (n instanceof HTMLElement) for (const ov of n.matches('.modal-backdrop') ? [n] : [...n.querySelectorAll('.modal-backdrop')]) restore(ov);
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab') return;
      const ov = topOverlay();
      if (!ov) return;
      const items = [...ov.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = ov.contains(document.activeElement);
      if (!inside || (e.shiftKey && document.activeElement === first)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    true,
  );
}
