/**
 * Замеры запуска: отметки performance.mark('sm:…') — видны в DevTools (Performance) и в консоли:
 * через 5 с после запуска строка с временами (console.debug).
 */
export function mark(name: string) {
  try {
    performance.mark('sm:' + name);
  } catch {
    /* старый браузер */
  }
}

/** Выполнить, когда браузер свободен (после первой отрисовки), но не позже timeout */
export function whenIdle(fn: () => void, timeout = 2000) {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 200);
}

/** Через 5 с после запуска — одна строка с временами (console.debug: в браузере видна на уровне Verbose, в Android — в logcat) */
export function reportPerf() {
  setTimeout(() => {
    try {
      const rows = [...performance.getEntriesByType('mark'), ...performance.getEntriesByType('paint')]
        .filter((e) => e.name.startsWith('sm:') || e.entryType === 'paint')
        .sort((a, b) => a.startTime - b.startTime)
        .map((e) => `${e.name.replace('sm:', '')} ${Math.round(e.startTime)}`);
      console.debug('[SuperMind] запуск, мс: ' + rows.join(' · '));
    } catch {
      /* нет Performance API */
    }
  }, 5000);
}
