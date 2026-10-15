/**
 * Окружение для интеграционных тестов модулей приложения под Node:
 * — импорты без расширения ('./store') → .ts / .tsx;
 * — .tsx переводится в JS (TypeScript, JSX → react/jsx-runtime);
 * — стили (.css) — пустые модули; модуль ИИ — заглушка (ответы задаёт тест);
 * — IndexedDB — fake-indexeddb, localStorage — в памяти.
 * Подключать первым, а модули src — через await import().
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const aiStub = new URL('./aiStub.ts', import.meta.url).href;
const EMPTY = 'data:text/javascript,export default {}';

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.endsWith('.css')) return { url: EMPTY, shortCircuit: true };
    if (/\/ai\/claude$/.test(spec)) return { url: aiStub, shortCircuit: true };
    if (spec.startsWith('.') && !/\.[a-z]+$/i.test(spec)) {
      for (const ext of ['.ts', '.tsx']) {
        try {
          return next(spec + ext, ctx);
        } catch {
          /* пробуем следующее расширение */
        }
      }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.endsWith('.tsx')) {
      const src = readFileSync(fileURLToPath(url), 'utf8');
      const out = ts.transpileModule(src, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
        fileName: fileURLToPath(url),
      });
      return { format: 'module', source: out.outputText, shortCircuit: true };
    }
    return next(url, ctx);
  },
});

// localStorage и окно — минимально, как в браузере
const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};
g.sessionStorage ??= g.localStorage;
