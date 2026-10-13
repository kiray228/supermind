/**
 * Подключить первым, а модули src — через await import(): в src импорты без расширения
 * ('../utils/mapTasks'), а utils/mapTasks тянет браузерное хранилище — подменяем его заглушкой.
 */
import { registerHooks } from 'node:module';

const stub = new URL('./mapTasksStub.ts', import.meta.url).href;

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.endsWith('/utils/mapTasks')) return { url: stub, shortCircuit: true };
    if (spec.startsWith('.') && !/\.[a-z]+$/i.test(spec)) {
      try {
        return next(spec + '.ts', ctx);
      } catch {
        /* не .ts — как есть */
      }
    }
    return next(spec, ctx);
  },
});
