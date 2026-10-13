/**
 * В исходниках импорты без расширения ('../utils/tree') — так понимает Vite, но не Node.
 * Подключить до динамического import() модулей из src.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (!spec.startsWith('.')) throw e;
      return next(spec + '.ts', ctx);
    }
  },
});
