// Виджеты «Финансы» и «Фокус»: данные для виджетов, ссылки iPhone, нативные файлы и альтернативные иконки
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import './fixtures/srcHooks.ts';

const { financeWidget, focusIdle } = await import('../src/native/widgetCore.ts');
const { emptyFinance } = await import('../src/finance/model.ts');
const { actionFromUrl } = await import('../src/native/widgetUrl.ts');

type Fin = ReturnType<typeof emptyFinance>;
type Tx = Fin['transactions'][number];

function finance(): Fin {
  const d = emptyFinance();
  const acc = d.accounts[0].id;
  const tx = (id: string, date: string, amount: number, type: Tx['type'] = 'expense'): Tx => ({ id, type, amount, accountId: acc, date, tags: [], createdAt: 1, updatedAt: 1 });
  d.transactions = [
    tx('a', '2026-11-19', 1500),
    tx('b', '2026-11-19', 500),
    tx('c', '2026-11-03', 10000),
    tx('d', '2026-11-19', 99999, 'income'),
    tx('e', '2026-10-31', 7000),
  ];
  return d;
}

test('финансы: траты сегодня и за месяц, без доходов и чужих месяцев', () => {
  const w = financeWidget(finance(), '2026-11-19')!;
  assert.equal(w.d, '2026-11-19');
  assert.equal(w.m, '2026-11');
  assert.equal(w.cur, 'KZT');
  assert.equal(w.td, 2000);
  assert.equal(w.mo, 12000);
  assert.match(w.tds, /^2\s?000 ₸$/);
  assert.equal(w.lim, undefined);
  assert.equal(w.p, undefined);
});

test('финансы: бюджет месяца — доля, остаток и перерасход', () => {
  const d = finance();
  d.budgets = [{ id: 'b', limit: 20000, updatedAt: 1 }];
  const ok = financeWidget(d, '2026-11-19')!;
  assert.equal(ok.lim, 20000);
  assert.equal(ok.p, 0.6);
  assert.match(ok.lfs!, /^8\s?000 ₸$/);
  assert.equal(ok.over, undefined);
  assert.equal(ok.lv, 'ok');
  d.budgets = [{ id: 'b', limit: 10000, updatedAt: 1 }];
  const over = financeWidget(d, '2026-11-19')!;
  assert.equal(over.over, 1);
  assert.match(over.lfs!, /^2\s?000 ₸$/);
  assert.equal(over.lv, 'over');
  // бюджет категории — не общий бюджет месяца
  d.budgets = [{ id: 'c', categoryId: 'food', limit: 10000, updatedAt: 1 }];
  assert.equal(financeWidget(d, '2026-11-19')!.lim, undefined);
});

test('финансы: нет данных — виджет без сумм; основная валюта из настроек', () => {
  assert.equal(financeWidget(null, '2026-11-19'), null);
  const d = finance();
  d.prefs.mainCurrency = 'USD';
  assert.equal(financeWidget(d, '2026-11-19')!.cur, 'USD');
});

test('фокус в покое: минуты помодоро или секундомер', () => {
  assert.deepEqual(focusIdle('pomo', 25), { min: 25 });
  assert.deepEqual(focusIdle('pomo', undefined), { min: 25 });
  assert.deepEqual(focusIdle('stopwatch', 50), { sw: 1, min: 50 });
});

test('ссылки виджетов: новая трата и старт фокуса', () => {
  assert.deepEqual(actionFromUrl('supermind://add_expense'), { type: 'add_expense' });
  assert.deepEqual(actionFromUrl('supermind://focus?action=start'), { type: 'focus', action: 'start' });
  assert.deepEqual(actionFromUrl('supermind://focus?action=stop'), { type: 'focus', action: 'stop' });
  assert.equal(actionFromUrl('supermind://focus?action=erase'), null);
  assert.equal(actionFromUrl('supermind://focus'), null);
});

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('iPhone: виджеты в наборе, плагин иконки зарегистрирован, иконки в каталоге', () => {
  const bundle = read('ios/App/SuperMindWidget/SuperMindWidget.swift');
  assert.match(bundle, /FinanceWidget\(\)/);
  assert.match(bundle, /FocusWidget\(\)/);
  assert.match(read('ios/App/App/MainViewController.swift'), /registerPluginInstance\(AppIconPlugin\(\)\)/);
  const setup = read('ios/scripts/setup-targets.rb');
  for (const n of ['Dark', 'Light', 'Green', 'Sunset', 'Purple']) {
    assert.ok(existsSync(new URL(`../ios/App/App/Assets.xcassets/AppIcon-${n}.appiconset/Contents.json`, import.meta.url)), n);
    assert.match(setup, new RegExp(`AppIcon-${n}`));
  }
  assert.match(read('ios/App/App/AppIconPlugin.swift'), /setAlternateIconName/);
});

test('Android: виджеты и иконки в манифесте, у каждой иконки — ярлыки значка', () => {
  const m = read('android/app/src/main/AndroidManifest.xml');
  assert.match(m, /android:name="\.FinanceWidget"/);
  assert.match(m, /android:name="\.FocusWidget"/);
  const aliases = [...m.matchAll(/<activity-alias[\s\S]*?<\/activity-alias>/g)].map((x) => x[0]);
  assert.equal(aliases.length, 6);
  assert.equal(aliases.filter((a) => /android:enabled="true"/.test(a)).length, 1, 'включена только иконка по умолчанию');
  for (const a of aliases) {
    assert.match(a, /android\.intent\.category\.LAUNCHER/);
    assert.match(a, /android\.app\.shortcuts/);
    assert.match(a, /android:targetActivity="\.MainActivity"/);
  }
  // запуск — только через иконки: у самой MainActivity нет LAUNCHER (иначе две иконки)
  const main = m.match(/<activity\s[^>]*android:name="\.MainActivity"[\s\S]*?<\/activity>/)![0];
  assert.doesNotMatch(main, /category\.LAUNCHER/);
  const java = read('android/app/src/main/java/app/twomind/mindmap/AppIconPlugin.java');
  for (const a of aliases) assert.ok(java.includes(a.match(/android:name="\.(\w+)"/)![1]), 'плагин знает ' + a.match(/android:name="\.(\w+)"/)![1]);
});

test('Android: казахские подписи виджетов — для всех строк', () => {
  const names = (p: string) => new Set([...read(p).matchAll(/<string name="(\w+)"/g)].map((x) => x[1]));
  const ru = names('android/app/src/main/res/values/widget.xml');
  for (const l of ['values-en', 'values-kk']) {
    const tr = names(`android/app/src/main/res/${l}/widget.xml`);
    const missing = [...ru].filter((n) => !tr.has(n));
    assert.deepEqual(missing, [], l);
  }
});
