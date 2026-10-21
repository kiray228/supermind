/**
 * Точные будильники: без USE_EXACT_ALARM (политика Play) разрешение на Android 14+ после установки выключено,
 * а плагин уведомлений при schedule() с точным уведомлением сам открывает системный экран настроек.
 * Каждый вызов schedule() должен явно передавать isExactNotification (true — только если разрешение уже есть).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

test('каждое планирование уведомления указывает isExactNotification', () => {
  let calls = 0;
  for (const file of sources('src')) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\b\w+\.schedule\(\{/g)) {
      calls++;
      // тело вызова — до закрывающей «});» на том же уровне отступа
      const body = src.slice(m.index!, src.indexOf('\n    });', m.index!) + 1 || undefined);
      assert.match(body, /isExactNotification:/, `${file}: schedule() без isExactNotification`);
    }
  }
  assert.ok(calls >= 3, 'вызовы schedule() найдены');
});
