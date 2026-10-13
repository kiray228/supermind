// Сборка сервера в один ESM-файл dist/index.mjs (Neon Function, Node 24).
// Зависимостей из npm у сервера нет — в файл попадает только src/, модули node:* остаются импортами.
// Сборщик — rolldown, который уже стоит в корне проекта вместе с Vite (отдельно ставить не нужно).
//   cd server && npm run bundle
// Выкладка по-прежнему: neon functions deploy supermind --src src/index.ts … (CLI собирает сам);
// этот файл — чтобы проверить сборку локально или выложить готовый dist/index.mjs.
import { rolldown } from 'rolldown';
import { builtinModules } from 'node:module';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = 'dist/index.mjs';

const bundle = await rolldown({
  input: 'src/index.ts',
  cwd: root,
  platform: 'node',
  // встроенные модули Node — не встраивать (и с префиксом node:, и без)
  external: [/^node:/, ...builtinModules],
  logLevel: 'warn',
});
await bundle.write({ file: out, format: 'esm', sourcemap: false, minify: false });
await bundle.close();

const { size } = await stat(new URL('../' + out, import.meta.url));
console.log(`server/${out}: ${(size / 1024).toFixed(1)} КБ`);
