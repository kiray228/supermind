/** Конец фразы по паузе (модуль чистый — тесты гоняют его в Node) */
/** Пауза после последнего распознанного слова, после которой фраза считается законченной */
export const SILENCE_MS = 1600;

/**
 * Тишина после речи: таймер сбрасывается с каждым новым словом. На Android распознаватель
 * с промежуточными результатами работает как диктовка и сам паузу не замечает, на iPhone — тоже, поэтому конец фразы ловим сами.
 */
export function silenceTimer(ms: number, onSilent: () => void) {
  let h: ReturnType<typeof setTimeout> | undefined;
  return {
    /** услышали новое слово */
    bump() {
      clearTimeout(h);
      h = setTimeout(onSilent, ms);
    },
    clear() {
      clearTimeout(h);
    },
  };
}
