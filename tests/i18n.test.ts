// Английский интерфейс: у каждой строки в t('…') и tn(…) есть перевод, подстановки совпадают
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../src/i18n/en/index.ts';
import { langFromSystem, t, tn } from '../src/i18n/index.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
const LIT = String.raw`('(?:\.|[^'\])*'|"(?:\.|[^"\])*"|\`(?:\.|[^\`\$])*\`)`;
const lit = (s: string) => Function(`return ${s}`)() as string;
const files = walk('src').filter((f) => !f.includes(join('src', 'i18n')));

function keys() {
  const out = new Map<string, string>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(new RegExp(String.raw`\bt\(\s*${LIT}`, 'g'))) out.set(lit(m[1]), f);
    for (const m of src.matchAll(new RegExp(String.raw`\btn\([^,()]+(?:\([^()]*\))?[^,()]*,\s*${LIT},\s*${LIT},\s*${LIT}`, 'g'))) out.set(`${lit(m[1])}|${lit(m[2])}|${lit(m[3])}`, f);
  }
  return out;
}

test('у каждой строки интерфейса есть английский перевод', () => {
  const missing = [...keys()].filter(([k]) => !(k in en)).map(([k, f]) => `${f}: ${k}`);
  assert.deepEqual(missing, [], `нет перевода (${missing.length}):\n${missing.slice(0, 40).join('\n')}`);
});

test('подстановки {…} в переводе те же, что в русском', () => {
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = Object.entries(en).filter(([ru, e]) => vars(ru) !== vars(e)).map(([ru, e]) => `${ru} → ${e}`);
  assert.deepEqual(bad, []);
});

test('в английском словаре нет кириллицы', () => {
  const bad = Object.entries(en).filter(([, e]) => /[А-Яа-яЁё]/.test(e)).map(([ru, e]) => `${ru} → ${e}`);
  assert.deepEqual(bad, []);
});

test('язык: русский для русскоязычных систем, иначе английский; в тестах — русский', () => {
  assert.equal(langFromSystem(['en-US', 'ru-RU']), 'ru');
  assert.equal(langFromSystem(['kk-KZ']), 'ru');
  assert.equal(langFromSystem(['en-BE']), 'en');
  assert.equal(langFromSystem(['de-DE', 'en']), 'en');
  assert.equal(t('Добавлено: {name}', { name: 'Вода' }), 'Добавлено: Вода');
  assert.equal(`${tn(1, 'задача', 'задачи', 'задач')} ${tn(3, 'задача', 'задачи', 'задач')} ${tn(11, 'задача', 'задачи', 'задач')}`, 'задача задачи задач');
});
