// Устройства: кто может скачать приложение, у того оно должно работать и помещаться на экран.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('минимальная iOS не ниже 16.4: в коде регулярки с lookbehind и color-mix в стилях', () => {
  // Safari до 16.4 не разбирает (?<=…)/(?<!…) — модуль с такой регуляркой не загружается вовсе,
  // а color-mix (с 16.2) на старых iOS выпадает — пропадают фоны и цвета. Vite 8 собирает под safari16.4.
  const src = walk('src').filter((f) => /\.(ts|tsx)$/.test(f)).map(read).join('\n');
  assert.ok(/\(\?<[=!]/.test(src), 'lookbehind больше не используется — минимальную iOS можно снова понизить');
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const targets = [...pbx.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map((m) => m[1]);
  assert.ok(targets.length > 0);
  for (const t of targets) {
    const [maj, min = '0'] = t.split('.');
    assert.ok(+maj > 16 || (+maj === 16 && +min >= 4), `IPHONEOS_DEPLOYMENT_TARGET = ${t}, нужно ≥ 16.4`);
  }
  // сборка: iOS не ниже 16.4 (lookbehind), Android WebView от Chrome 87 — синтаксис переводится вниз
  const tgt = read('vite.config.ts').match(/target: \[([^\]]+)\]/);
  assert.ok(tgt, 'build.target не задан — Vite соберёт под chrome111, и старые Android не запустятся');
  assert.match(tgt[1], /'safari16\.4'/);
  assert.match(tgt[1], /'chrome87'/);
});

test('Google Play: микрофон не обязателен — приложение видно на планшетах и Chromebook без микрофона', () => {
  const m = read('android/app/src/main/AndroidManifest.xml');
  assert.match(m, /<uses-feature android:name="android\.hardware\.microphone" android:required="false" \/>/);
  // ни одна возможность не объявлена обязательной
  assert.ok(!/<uses-feature[^>]*android:required="true"/.test(m));
});

test('боковые безопасные зоны (вырез камеры в альбомной ориентации) учтены', () => {
  const css = read('src/ui/devices.css');
  assert.match(css, /--safe-left: env\(safe-area-inset-left, 0px\)/);
  assert.match(css, /--safe-right: env\(safe-area-inset-right, 0px\)/);
  for (const sel of ['.app', '.editor', '.tabbar', '.phone-back', '.ob-root', '.modal-backdrop', '.menu.menu-sheet']) {
    assert.ok(css.includes(`:root ${sel}`), `нет отступа под вырез для ${sel}`);
  }
  assert.match(read('src/App.tsx'), /import '\.\/ui\/devices\.css';/);
});

test('«+ трата» на «Сегодня» не делит класс с полем «Добавить» в задачах', () => {
  // .td-add из tasks.css (серый текст, без отступов) перебивал кнопку, как только открывали задачи
  assert.match(read('src/views/Today.tsx'), /className="td-money-add"/);
  assert.ok(!/^\.td-add\b/m.test(read('src/views/today.css')));
});

test('старые Android WebView: structuredClone и новые методы массивов есть всегда', async () => {
  const { cloneDeep } = await import('../src/polyfills.ts');
  assert.match(read('src/main.tsx'), /^import '\.\/polyfills';/);
  const d = new Date(5);
  const src: Record<string, unknown> = { a: [1, { b: 'x' }], d, m: new Map([['k', { v: 1 }]]), s: new Set([1, 2]), u: new Uint8Array([1, 2]) };
  src.self = src;
  const c = cloneDeep(src);
  assert.notEqual(c, src);
  assert.deepEqual((c.a as unknown[])[1], { b: 'x' });
  assert.notEqual((c.a as unknown[])[1], (src.a as unknown[])[1]);
  assert.ok(c.d instanceof Date && (c.d as Date).getTime() === 5 && c.d !== d);
  assert.equal((c.m as Map<string, { v: number }>).get('k')!.v, 1);
  assert.notEqual((c.m as Map<string, unknown>).get('k'), (src.m as Map<string, unknown>).get('k'));
  assert.deepEqual([...(c.s as Set<number>)], [1, 2]);
  assert.deepEqual([...(c.u as Uint8Array)], [1, 2]);
  assert.equal(c.self, c);
  assert.throws(() => cloneDeep({ f: () => 1 }));
});

test('Health Connect: приложение просит только шаги и сон', () => {
  // каждое разрешение здоровья нужно обосновать в Play Console — лишние из плагина вырезаем
  const m = read('android/app/src/main/AndroidManifest.xml');
  const plugin = read('node_modules/@capgo/capacitor-health/android/src/main/AndroidManifest.xml');
  const keep = ['READ_STEPS', 'READ_SLEEP'];
  for (const [, p] of plugin.matchAll(/android\.permission\.health\.([A-Z0-9_]+)/g)) {
    if (keep.includes(p)) assert.match(m, new RegExp(`health\.${p}" />`));
    else assert.match(m, new RegExp(`health\.${p}" tools:node="remove"`), `не вырезано ${p}`);
  }
});
