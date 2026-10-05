/**
 * iOS Safari (и часть Android WebView) открывают экранную клавиатуру, только если
 * фокус ставится синхронно в обработчике касания. Поле редактирования темы появляется
 * позже (после рендера), поэтому в момент касания фокусируем скрытое поле-«заглушку»,
 * а редактор потом забирает фокус себе — клавиатура остаётся открытой.
 */
let proxy: HTMLInputElement | null = null;

export function primeKeyboard() {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  if (!proxy) {
    proxy = document.createElement('input');
    proxy.type = 'text';
    proxy.setAttribute('aria-hidden', 'true');
    proxy.tabIndex = -1;
    Object.assign(proxy.style, {
      position: 'fixed', top: '30%', left: '0', width: '1px', height: '1px', opacity: '0',
      fontSize: '16px', border: '0', padding: '0', pointerEvents: 'none',
    });
    document.body.appendChild(proxy);
  }
  proxy.focus({ preventScroll: true });
  // если редактор так и не открылся — убрать клавиатуру
  const el = proxy;
  setTimeout(() => {
    if (document.activeElement === el) el.blur();
  }, 900);
}
