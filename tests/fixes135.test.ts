/**
 * Исправления 1.35: повторы задач (пропуск, перенос одного повтора, «выполнено» на будущий повтор),
 * безопасные ссылки в картах, CSV без формул, валюты без курса, подписка на двух устройствах,
 * сроки целей в напоминаниях, копии карт для отмены, один шаг отмены на новую тему — поверх настоящих хранилищ.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const tasks = await import('../src/tasks/store.ts');
const model = await import('../src/tasks/model.ts');
const ics = await import('../src/tasks/ics.ts');
const { safeUrl, isSafeUrl } = await import('../src/utils/url.ts');
const { clone } = await import('../src/utils/tree.ts');
const io = await import('../src/io/index.ts');
const opml = await import('../src/io/opml.ts');
const csv = await import('../src/finance/csv.ts');
const fin = await import('../src/finance/model.ts');
const finStore = await import('../src/finance/store.ts');
const goalsModel = await import('../src/goals/model.ts');
const { goalReminders } = await import('../src/goals/reminders.ts');
const docs = await import('../src/store/docStore.ts');
const { todayYmd, addDaysYmd } = await import('../src/utils/mapTasks.ts');

const today = todayYmd();
const day = (n: number) => addDaysYmd(today, n);
const task = (id: string) => tasks.getTask(id)!;

before(async () => {
  await tasks.ensureTasks();
});

describe('повторы задач', () => {
  test('пропуск будущего повтора: его нет в списках и напоминаниях, остальные на месте; «Вернуть» возвращает', () => {
    const t = tasks.addTask({ title: 'Зарядка', date: today, repeat: { freq: 'daily', interval: 1 }, reminders: [540] })!;
    assert.ok(tasks.skipOccurrence(t.id, day(2)));
    assert.deepEqual(model.occurrences(task(t.id), today, day(4)), [today, day(1), day(3), day(4)]);
    assert.equal(task(t.id).date, today, 'текущий повтор не тронут');
    const from = new Date(`${day(2)}T00:00:00`).getTime();
    assert.equal(model.reminderFires([task(t.id)], from, from + 86400000 - 1).length, 0, 'напоминания в пропущенный день нет');
    assert.ok(model.reminderFires([task(t.id)], from + 86400000, from + 2 * 86400000 - 1).length > 0);
  });

  test('пропуск текущего повтора — к следующему, мимо уже пропущенных', () => {
    const t = tasks.addTask({ title: 'Пробежка', date: today, repeat: { freq: 'daily', interval: 1 } })!;
    tasks.skipOccurrence(t.id, day(1));
    tasks.skipOccurrence(t.id, today);
    assert.equal(task(t.id).date, day(2));
    assert.ok(!(task(t.id).repeat!.skip ?? []).includes(day(1)), 'прошедшие пропуски убираются');
  });

  test('выполнение: следующая дата мимо пропуска', () => {
    const t = tasks.addTask({ title: 'Полив', date: today, repeat: { freq: 'daily', interval: 1 } })!;
    tasks.skipOccurrence(t.id, day(1));
    tasks.toggleDone(t.id);
    assert.equal(task(t.id).date, day(2));
  });

  test('перенос одного повтора: отдельная задача на новую дату, серия без него', () => {
    const t = tasks.addTask({ title: 'Планёрка', date: today, time: '10:00', repeat: { freq: 'weekly', interval: 1 }, tags: ['работа'], checklist: [{ id: 'c1', text: 'повестка', done: true }] })!;
    const next = model.occurrences(task(t.id), day(1), day(8))[0];
    const copy = tasks.moveOccurrence(t.id, next, addDaysYmd(next, 1))!;
    assert.notEqual(copy.id, t.id);
    assert.equal(copy.date, addDaysYmd(next, 1));
    assert.equal(copy.time, '10:00');
    assert.equal(copy.repeat, undefined);
    assert.deepEqual(copy.tags, ['работа']);
    assert.equal(copy.checklist[0].done, false, 'пункты — не отмеченные');
    assert.ok(!model.occurrences(task(t.id), day(1), day(8)).includes(next));
    // текущий повтор переносится как раньше — сама задача
    assert.equal(tasks.moveOccurrence(t.id, today, day(1))!.id, t.id);
    assert.equal(task(t.id).date, day(1));
  });

  test('«Выполнено» из уведомления о будущем повторе отмечает именно его, а не просроченный', () => {
    const t = tasks.addTask({ title: 'Таблетки', date: day(-2), repeat: { freq: 'daily', interval: 1 } })!;
    assert.ok(tasks.completeOccurrence(t.id, today));
    assert.equal(task(t.id).date, day(-2), 'просроченный остался');
    assert.ok(task(t.id).repeat!.skip!.includes(today));
    assert.equal(tasks.completeOccurrence(t.id, today), false, 'второй раз — уже выполнен');
    const log = tasks.tasksData()!.log.filter((l) => l.taskId === t.id);
    assert.equal(log.at(-1)!.date, today);
  });

  test('экспорт в календарь: пропущенные — EXDATE', () => {
    const t = tasks.addTask({ title: 'Йога', date: today, repeat: { freq: 'daily', interval: 1 } })!;
    tasks.skipOccurrence(t.id, day(3));
    const out = ics.buildIcs([task(t.id)]);
    assert.ok(out.includes(`EXDATE;VALUE=DATE:${day(3).replace(/-/g, '')}`));
  });
});

describe('безопасные ссылки', () => {
  test('веб, почта, телефон — да; javascript:, data:, file: — нет; без схемы — https', () => {
    assert.equal(safeUrl('https://a.ru/x'), 'https://a.ru/x');
    assert.equal(safeUrl('mailto:a@b.cd'), 'mailto:a@b.cd');
    assert.equal(safeUrl('tel:+77001234567'), 'tel:+77001234567');
    assert.equal(safeUrl('site.kz/путь'), 'https://site.kz/путь');
    assert.equal(safeUrl('localhost:8080/x'), 'https://localhost:8080/x');
    assert.equal(safeUrl('javascript:alert(1)'), null);
    assert.equal(safeUrl(' JavaScript:alert(1)'), null);
    assert.equal(safeUrl('data:text/html,<b>'), null);
    assert.equal(safeUrl('file:///C:/x'), null);
    assert.equal(safeUrl(''), null);
    assert.ok(isSafeUrl('http://x') && !isSafeUrl('vbscript:x'));
  });

  test('импорт карты: опасные ссылки отбрасываются', async () => {
    const json = JSON.stringify({ title: 'К', sheets: [{ root: { id: 'r', text: 'Корень', link: 'javascript:alert(1)', children: [{ id: 'a', text: 'А', link: 'example.com', children: [] }] } }] });
    const doc = await io.importFile(new File([json], 'k.json'));
    const root = doc.sheets[0].root;
    assert.equal(root.link, undefined);
    assert.equal(root.children[0].link, 'https://example.com');
    // OPML разбирается DOMParser'ом браузера; в Node — @xmldom, если установлен
    const g = globalThis as { DOMParser?: unknown };
    if (!g.DOMParser) g.DOMParser = (await import('@xmldom/xmldom').catch(() => null))?.DOMParser;
    if (!g.DOMParser) return;
    const t = opml.opmlToTopic(`<opml><body><outline text="X" url="javascript:alert(1)"/><outline text="Y" url="https://y.kz"/></body></opml>`);
    const links = JSON.stringify(t);
    assert.ok(!links.includes('javascript:'));
    assert.ok(links.includes('https://y.kz'));
  });
});

describe('копии для отмены', () => {
  test('глубокая копия: структура новая, большие строки (картинки) — общие', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(100000);
    const doc = { a: { image: { src: big }, list: [1, { x: 2 }] }, n: null, u: undefined as undefined };
    const c = clone(doc);
    assert.deepEqual(c, doc);
    assert.notEqual(c.a, doc.a);
    assert.notEqual(c.a.list, doc.a.list);
    c.a.list.push(3);
    assert.equal(doc.a.list.length, 2);
    assert.ok('u' in c);
    const d = new Date(0);
    assert.notEqual(clone({ d }).d, d, 'не простые объекты — как раньше, через structuredClone');
  });
});

describe('карта: отмена', () => {
  test('новая тема с текстом — один шаг «Отменить»; «Отменить» во время ввода не возвращает набранное', () => {
    const doc = docs.newDoc('Тест');
    docs.useDoc.getState().open(doc);
    const st = () => docs.useDoc.getState();
    const root = st().sheet()!.root.id;
    const id = st().addChild(root)!;
    st().setText(id, 'Идея');
    st().setEditing(null);
    assert.equal(st().sheet()!.root.children.length, 1);
    st().undo();
    assert.equal(st().sheet()!.root.children.length, 0, 'один шаг — и темы нет');
    st().redo();
    assert.equal(st().sheet()!.root.children[0].text, 'Идея');
    // правка текста позже — уже отдельный шаг
    st().setText(id, 'Идея 2');
    st().undo();
    assert.equal(st().sheet()!.root.children[0].text, 'Идея');
    // ввод открыт, нажали «Отменить» — поле закроется без записи, «Повторить» цел
    st().setEditing(id);
    st().undo();
    assert.equal(docs.takeDroppedEdit(id), true);
    assert.equal(docs.takeDroppedEdit(id), false, 'один раз');
    assert.ok(st().future.length > 0);
    st().close();
  });
});

describe('финансы', () => {
  test('CSV: ячейки-формулы — с апострофом, числа — как есть', () => {
    assert.equal(csv.safeText('=HYPERLINK("x")'), `'=HYPERLINK("x")`);
    assert.equal(csv.safeText('+7 700'), `'+7 700`);
    assert.equal(csv.safeText('@user'), `'@user`);
    assert.equal(csv.safeText('Магнум'), 'Магнум');
  });

  test('валюта без курса — видна; с курсом — нет', async () => {
    await finStore.ensureFinance();
    const data = () => finStore.useFinance.getState().data!;
    finStore.saveAccount({ id: 'usd', name: 'Доллары', currency: 'USD', emoji: '💵', color: '#22c55e', type: 'card', initial: 0 } as never);
    finStore.addTransaction({ type: 'expense', amount: 10, accountId: 'usd', date: today, tags: [] } as never);
    assert.deepEqual(fin.missingRates(data(), { from: today, to: today }), ['USD']);
    assert.deepEqual(fin.missingRates(data(), { from: day(1), to: day(2) }), [], 'вне периода — не считается');
    finStore.setFinancePrefs({ rates: { ...data().prefs.rates, USD: 500 } });
    assert.deepEqual(fin.missingRates(data(), { from: today, to: today }), []);
  });

  test('подписка: «Оплачено» дважды за один срок — одна операция; id одинаковый на любом устройстве', async () => {
    const data = () => finStore.useFinance.getState().data!;
    const acc = data().accounts[0];
    finStore.saveSubscription({ id: 'sub1', name: 'Музыка', amount: 990, accountId: acc.id, period: 'month', every: 1, nextDate: today, remindDays: 1 } as never);
    const t1 = finStore.paySubscription('sub1')!;
    assert.equal(t1.id, `sub-sub1-${today}`);
    // «другое устройство» не знало об оплате: срок тот же — id тот же, синхронизация сольёт
    const n = data().transactions.filter((t) => t.subscriptionId === 'sub1').length;
    assert.equal(n, 1);
    assert.notEqual(data().subscriptions.find((s) => s.id === 'sub1')!.nextDate, today, 'срок сдвинулся');
  });
});

describe('сроки целей', () => {
  const lookup = goalsModel.makeTaskLookup([]);
  const goal = (p: Record<string, unknown>) => goalsModel.normalizeGoal({ id: 'g' + Math.random(), title: 'Марафон', emoji: '🏃', status: 'active', mode: 'manual', manual: 40, ...p } as never);

  test('за неделю, накануне и в день срока — с прогрессом; этапы — свои', () => {
    const g = goal({ deadline: day(7), stages: [{ id: 's1', title: 'База', deadline: day(1), steps: [{ id: 'x', title: 'шаг', done: false }], taskIds: [] }] });
    const d = { ...goalsModel.emptyGoalsData(), goals: [g] };
    const r = goalReminders(d, lookup, today, day(7));
    const goalOnes = r.filter((x) => x.key.startsWith(`goal|${g.id}|`));
    assert.deepEqual(goalOnes.map((x) => x.day), [today, day(6), day(7)]);
    assert.match(goalOnes[0].title, /^🏃 Через неделю срок: Марафон$/);
    assert.match(goalOnes[0].body, /Прогресс 40%/);
    assert.match(goalOnes[2].title, /Сегодня срок/);
    const stage = r.filter((x) => x.key.includes(':s1'));
    assert.deepEqual(stage.map((x) => x.day), [today, day(1)]);
    assert.match(stage[0].title, /Завтра срок: Марафон: База/);
  });

  test('достигнутая (100%), выполненная или в архиве — без напоминаний', () => {
    const d = { ...goalsModel.emptyGoalsData(), goals: [goal({ deadline: day(1), manual: 100 }), goal({ deadline: day(1), status: 'done' }), goal({ deadline: day(1), status: 'archived' })] };
    assert.equal(goalReminders(d, lookup, today, day(7)).length, 0);
  });
});
