/**
 * Панель навигации как в iOS: большой заголовок раздела, который при прокрутке
 * сворачивается в компактный (17 pt) внутри стеклянной полосы.
 *
 * Работает для всех разделов сразу: слушаем прокрутку `.page-body` (или любого
 * элемента с атрибутом `data-navscroll`) и ставим разделу класс `is-scrolled`.
 * Внешний вид — в src/app.css и src/ui/appearance.css.
 */

const SCROLLERS = '.page-body, [data-navscroll]';

function update(el: HTMLElement) {
  const page = el.closest<HTMLElement>('.page');
  if (!page) return;
  const was = page.classList.contains('is-scrolled');
  const y = el.scrollTop;
  // запас прокрутки: если содержимого мало, не сворачиваем — иначе заголовок «дрожит»
  const room = el.scrollHeight - el.clientHeight;
  const next = was ? y > 4 : y > 14 && room > 72;
  if (next === was) return;
  if (next) fitCompactTitle(page);
  page.classList.toggle('is-scrolled', next);
}

const TITLE = ':scope > h1, :scope > .tk-title-btn, :scope > .nt-title-btn';

/** Компактный заголовок — по центру, но не наезжая на кнопки; если места мало — слева */
function fitCompactTitle(page: HTMLElement) {
  const header = page.querySelector<HTMLElement>(':scope > .page-header');
  if (!header || !window.matchMedia('(max-width: 760px)').matches) return;
  const title = header.querySelector(TITLE);
  const hr = header.getBoundingClientRect();
  const mid = hr.left + hr.width / 2;
  let left = 16;
  let right = 16;
  for (const c of Array.from(header.children)) {
    if (c === title || c.classList.contains('grow') || c.classList.contains('segmented')) continue;
    const r = c.getBoundingClientRect();
    if (!r.width || r.top > hr.top + hr.height * 0.6) continue;
    if (r.left >= mid) right = Math.max(right, hr.right - r.left + 8);
    else left = Math.max(left, r.right - hr.left + 8);
  }
  const centered = hr.width - Math.max(left, right) * 2;
  const narrow = centered < 110;
  const max = narrow ? hr.width - right - 16 : centered;
  header.style.setProperty('--nb-max', `${Math.max(0, Math.round(max))}px`);
  header.classList.toggle('nb-left', narrow);
}

let started = false;

export function initLargeTitles(): void {
  if (started) return;
  started = true;
  let frame = 0;
  let target: HTMLElement | null = null;
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(SCROLLERS)) return;
      target = el;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (target) update(target);
      });
    },
    { capture: true, passive: true },
  );
}
