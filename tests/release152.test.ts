/** 1.52: своя нижняя панель, «Здоровье и спорт», разряды в суммах, сумма в другой валюте */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './tsResolve.ts';

const nav = await import('../src/store/phoneNav.ts');
const { groupDigits, fmtInputNum, parseMoneyInput, convertAmount, rateText } = await import('../src/finance/model.ts');

test('панель: ровно три разных раздела, неизвестное отбрасывается', () => {
  assert.deepEqual(nav.normTabs(undefined), ['today', 'home', 'notes']);
  assert.deepEqual(nav.normTabs(['finance', 'finance', 'nope', 'health']), ['finance', 'health', 'today']);
  assert.deepEqual(nav.normTabs(['a', 'b']), ['today', 'home', 'notes']);
  assert.equal(nav.normTabs(['today', 'home', 'notes', 'finance']).length, 3);
});

test('панель: подсветка и «назад» при своих разделах', () => {
  const tabs = nav.normTabs(['today', 'finance', 'health']);
  assert.equal(nav.phoneTab('finance', tabs), 'finance');
  assert.equal(nav.phoneTab('health', tabs), 'health');
  assert.equal(nav.phoneTab('tasks', tabs), 'today');
  // «Мозга» и «Карт» нет в панели — их разделы в «Ещё»
  assert.equal(nav.phoneTab('notes', tabs), 'more');
  assert.equal(nav.phoneTab('goals', tabs), 'more');
  assert.equal(nav.phoneTab('editor', tabs), 'more');
  assert.ok(nav.isPhoneTab('finance', tabs) && nav.isPhoneTab('more', tabs));
  assert.ok(!nav.isPhoneTab('home', tabs));
  // раздел из «Ещё» — назад в «Ещё»; с вкладки «Финансы» в Цели — назад в «Финансы»
  assert.equal(nav.nextBackTab('more', 'notes', null, tabs), 'more');
  assert.equal(nav.nextBackTab('finance', 'goals', null, tabs), 'finance');
  // задачи стоят в панели сами — они своя вкладка, а не часть «Сегодня»
  const t2 = nav.normTabs(['tasks', 'home', 'notes']);
  assert.equal(nav.phoneTab('tasks', t2), 'tasks');
  assert.equal(nav.phoneTab('calendar', t2), 'more');
});

test('«Ещё» показывает разделы, которых нет в панели', () => {
  const more = nav.moreBlocks(['today', 'finance', 'health']);
  assert.ok(more.includes('home') && more.includes('notes'));
  assert.ok(!more.includes('finance') && !more.includes('today'));
});

test('первый запуск: «Сегодня» первым, затем выбранное', () => {
  assert.deepEqual(nav.tabsFromInterests(['finance', 'health']), ['today', 'finance', 'health']);
  assert.deepEqual(nav.tabsFromInterests(['finance']), ['today', 'finance', 'home']);
  assert.deepEqual(nav.tabsFromInterests([]), ['today', 'home', 'notes']);
});

test('у каждого раздела панели есть подпись и экран', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const t of nav.TAB_BLOCKS) {
    assert.ok(nav.TAB_INFO[t].label && nav.TAB_INFO[t].title, t);
    assert.match(app, new RegExp(`view === '${t}' &&`), `нет экрана для ${t}`);
  }
});

test('«Здоровье и спорт»: какие привычки туда попадают', async () => {
  const { isHealthHabit } = await import('../src/habits/health.ts');
  for (const name of ['Пить воду', 'Тренировка', 'Сон до 23:00', 'Бег по утрам', 'Витамины', '10 000 шагов', 'Йога']) assert.ok(isHealthHabit({ name }), name);
  for (const name of ['Чтение', 'Позвонить маме', 'Весна', 'Английский']) assert.ok(!isHealthHabit({ name }), name);
  assert.ok(isHealthHabit({ name: 'Моя штука', icon: '🏋️' }));
});

test('разряды в поле суммы: 10000 → 10 000, и сумма читается как прежде', () => {
  assert.equal(groupDigits('10000'), '10 000');
  assert.equal(groupDigits('1234567,5'), '1 234 567,5');
  assert.equal(groupDigits('100 000 0'), '1 000 000');
  assert.equal(groupDigits('0,05'), '0,05');
  // выражения и сокращения — как ввели
  assert.equal(groupDigits('1200+350'), '1200+350');
  assert.equal(groupDigits('4,5к'), '4,5к');
  assert.equal(groupDigits(''), '');
  assert.equal(parseMoneyInput(groupDigits('1234567,5')), 1234567.5);
  assert.equal(fmtInputNum(12500.5), '12 500,5');
  assert.equal(fmtInputNum(undefined), '');
});

test('сумма в другой валюте: тенге со счёта в юанях', () => {
  // 1 ¥ = 70 ₸, 1 $ = 500 ₸ (основная — тенге)
  const prefs = { mainCurrency: 'KZT', rates: { CNY: 70, USD: 500 } };
  assert.equal(convertAmount(7000, 'KZT', 'CNY', prefs), 100);
  assert.equal(convertAmount(100, 'CNY', 'KZT', prefs), 7000);
  assert.equal(convertAmount(10, 'USD', 'CNY', prefs)!.toFixed(4), (5000 / 70).toFixed(4));
  assert.equal(convertAmount(5, 'EUR', 'KZT', prefs), null);
  assert.equal(convertAmount(5, 'EUR', 'EUR', prefs), 5);
  // курс — от «дорогой» валюты
  assert.equal(rateText('KZT', 'CNY', prefs), '1 ¥ = 70 ₸');
  assert.equal(rateText('EUR', 'KZT', prefs), '');
});

test('быстрый ввод: подсказка даты совпадает с тем, что сохранится', async () => {
  const { parseTask } = await import('../src/tasks/parse.ts');
  const { snapToRule } = await import('../src/tasks/model.ts');
  // суббота 14 ноября 2026
  const p = parseTask('Купить подарок маме завтра в 18:30 каждый понедельник', new Date(2026, 10, 14, 12, 0));
  assert.equal(p.title, 'Купить подарок маме');
  assert.equal(p.time, '18:30');
  assert.deepEqual(p.repeat, { freq: 'weekly', interval: 1, weekdays: [1] });
  // «завтра» — воскресенье, но повтор по понедельникам переносит на понедельник: так задачу запишет addTask
  assert.equal(p.date, '2026-11-15');
  assert.equal(snapToRule(p.repeat!, p.date!), '2026-11-16');
  // окно быстрого ввода показывает именно перенесённую дату
  const qa = readFileSync(new URL('../src/tasks/ui/QuickAdd.tsx', import.meta.url), 'utf8');
  assert.match(qa, /const date = repeat && rawDate \? snapToRule\(repeat, rawDate\) : rawDate;/);
  assert.doesNotMatch(qa, /\bdate=\{rawDate\}|whenLabel\(\{ date: rawDate/);
});

test('быстрый ввод: «20 числа» и «каждое 20 число»', async () => {
  const { parseTask } = await import('../src/tasks/parse.ts');
  const now = new Date(2026, 10, 14, 12, 0);
  const a = parseTask('Оплатить интернет каждый месяц 20 числа', now);
  assert.equal(a.title, 'Оплатить интернет');
  assert.equal(a.date, '2026-11-20');
  assert.deepEqual(a.repeat, { freq: 'monthly', interval: 1 });
  const b = parseTask('Оплатить интернет каждое 20 число', now);
  assert.equal(b.date, '2026-11-20');
  assert.deepEqual(b.repeat, { freq: 'monthly', interval: 1 });
  // число уже прошло — в следующем месяце
  assert.equal(parseTask('Сдать отчёт к 5-му числу', now).date, '2026-12-05');
  // «к 20 числу» при повторе — не время 20:00
  assert.equal(parseTask('Оплатить каждый месяц к 20 числу', now).time, undefined);
  // в ноябре нет 31-го — последний день месяца
  assert.equal(parseTask('Аренда 31 числа', now).date, '2026-11-30');
  assert.equal(parseTask('Купить 20 штук', now).date, undefined);
});

test('цель «на этот год», заведённая в ноябре, не просит сразу «ускориться»', async () => {
  const { behindPace } = await import('../src/goals/model.ts');
  const nov14 = new Date(2026, 10, 14, 12).getTime();
  const g = { start: '2026-01-01', deadline: '2026-12-31', createdAt: nov14 };
  assert.equal(behindPace(g, 0, '2026-11-14'), false);
  // прошло полсрока с создания, а прогресс 0 — пора
  assert.equal(behindPace(g, 0, '2026-12-10'), true);
  // старая цель с января: в ноябре при 10% — отстаёт
  assert.equal(behindPace({ ...g, createdAt: new Date(2026, 0, 2).getTime() }, 10, '2026-11-14'), true);
  assert.equal(behindPace(g, 100, '2026-12-30'), false);
});

test('трата в основной валюте со счёта в другой: в отчётах — ровно та сумма, что ввели', async () => {
  const { emptyFinance, txMain } = await import('../src/finance/model.ts');
  const d = emptyFinance();
  d.prefs = { ...d.prefs, mainCurrency: 'KZT', rates: { CNY: 66.57 } };
  d.accounts = [{ ...d.accounts[0], currency: 'CNY' }];
  const acc = d.accounts[0].id;
  // ввели 7 000 ₸, со счёта списалось 105,16 ¥ — обратный пересчёт дал бы 7 000,50 ₸
  const tx = { id: 't1', type: 'expense' as const, amount: 105.16, accountId: acc, date: '2026-11-14', tags: [], orig: { amount: 7000, currency: 'KZT' }, createdAt: 1, updatedAt: 1 };
  assert.equal(txMain(d, tx), 7000);
  // без orig — обычный пересчёт по курсу
  const { orig: _o, ...plain } = tx;
  assert.equal(Math.round(txMain(d, plain) * 100) / 100, 7000.5);
});

test('знакомство: без аккаунта не обещаем облако', () => {
  const ob = readFileSync(new URL('../src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
  assert.match(ob, /useCloud\(\(s\) => !!s\.account\)/);
  assert.match(ob, /\? 'Вы вошли в аккаунт/);
  assert.match(ob, /: 'Всё хранится на этом устройстве/);
});

test('политика конфиденциальности — на экране входа и в настройках', () => {
  const auth = readFileSync(new URL('../src/ui/AuthGate.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/views/Settings.tsx', import.meta.url), 'utf8');
  assert.match(auth, /Политикой конфиденциальности/);
  assert.match(settings, /PRIVACY_URL/);
});
