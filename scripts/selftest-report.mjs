// Отчёт самопроверки (CI): разбирает строки «SMTEST {json}» из журналов обоих запусков,
// пишет таблицу в сводку GitHub Actions и report.md, падает, если есть провалы или запуск не закончился.
// Использование: node scripts/selftest-report.mjs ios|android папка-результатов
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [platform, dir = 'selftest-out'] = process.argv.slice(2);
const title = platform === 'ios' ? 'iPhone (симулятор)' : 'Android (эмулятор)';

const events = (n) => {
  const file = join(dir, `${platform}-phase${n}.log`);
  if (!existsSync(file)) return [];
  return [...readFileSync(file, 'utf8').matchAll(/SMTEST (\{.*\})/g)].flatMap((m) => {
    try {
      return [JSON.parse(m[1])];
    } catch {
      return [];
    }
  });
};

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
let failed = 0;
let lines = [`## Самопроверка: ${title}`, ''];

for (const n of [1, 2]) {
  const ev = events(n);
  const done = ev.find((e) => e.kind === 'done');
  const checks = ev.filter((e) => e.kind === 'pass' || e.kind === 'fail');
  const errs = ev.filter((e) => e.kind === 'error');
  const bad = checks.filter((e) => e.kind === 'fail').length;
  failed += bad + (done ? 0 : 1);
  lines.push(`### Запуск ${n}${n === 2 ? ' — после перезапуска приложения' : ''}`);
  lines.push(done ? `Проверок: ${checks.length}, ✅ ${checks.length - bad}, ❌ ${bad}` : '❌ **Запуск не закончился** (приложение зависло, упало или не открылось)');
  lines.push('', '| | Проверка | Подробности |', '|---|---|---|');
  for (const c of checks) lines.push(`| ${c.kind === 'pass' ? '✅' : '❌'} | ${esc(c.name)} | ${esc(c.kind === 'pass' ? (c.detail ?? `${c.ms} мс`) : c.message)} |`);
  if (errs.length) {
    lines.push('', '**Ошибки на странице:**');
    for (const e of errs.slice(0, 20)) lines.push('- `' + esc(e.message).slice(0, 300) + '`');
  }
  lines.push('');
}

const shots = existsSync(join(dir, 'shots')) ? readdirSync(join(dir, 'shots')).filter((f) => f.startsWith(platform)) : [];
lines.push(`Снимков экрана: ${shots.length} — в артефакте «selftest-${platform}».`, '');

const md = lines.join('\n');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `report-${platform}.md`), md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
console.log(md);
if (failed) {
  console.error(`::error::Самопроверка ${title}: провалов — ${failed}`);
  process.exit(1);
}
