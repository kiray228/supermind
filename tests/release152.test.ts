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

test('политика конфиденциальности — на экране входа и в настройках', () => {
  const auth = readFileSync(new URL('../src/ui/AuthGate.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/views/Settings.tsx', import.meta.url), 'utf8');
  assert.match(auth, /Политикой конфиденциальности/);
  assert.match(settings, /PRIVACY_URL/);
});
