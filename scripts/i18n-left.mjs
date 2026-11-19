// Русский текст, ещё не обёрнутый в t()/tn(): node scripts/i18n-left.mjs [папка или файл…] [--all]
// Комментарии пропускаются. Часть строк остаётся русской намеренно (разбор речи и дат, синонимы, промпты ИИ).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const all = process.argv.includes('--all');
const walk = (p, out = []) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f), out);
  else if (/\.(ts|tsx)$/.test(p) && !p.includes('i18n')) out.push(p);
  return out;
};
const files = (args.length ? args : ['src']).flatMap((a) => walk(a));
const CYR = /[А-Яа-яЁё]/;
let total = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const hits = [];
  // вырезаем комментарии, сохраняя переводы строк
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    if (!CYR.test(line)) return;
    // строки в t('…') / tn(…) не считаются
    const rest = line.replace(/\bt\(\s*(['"`])(?:\.|(?!\1).)*\1/g, '').replace(/\btn\([^)]*\)/g, '');
    if (CYR.test(rest)) hits.push(`${i + 1}: ${line.trim().slice(0, 140)}`);
  });
  if (hits.length) {
    total += hits.length;
    console.log(`${hits.length}\t${f}`);
    if (all) for (const h of hits) console.log('   ' + h);
  }
}
console.log(`всего строк с непереведённым текстом: ${total}`);
