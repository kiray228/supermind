/** 1.38: регулярный доход, ручной порядок привычек, отпечаток (вне Android — выключен) */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const fin = await import('../src/finance/model.ts');
const finStore = await import('../src/finance/store.ts');
const hm = await import('../src/habits/model.ts');
const lock = await import('../src/ui/lock.ts');
const { todayYmd, addDaysYmd } = await import('../src/utils/mapTasks.ts');

describe('регулярный доход', () => {
  test('«Получено» записывает доход; в ближайших — поступление; расходы в месяц его не включают', async () => {
    await finStore.ensureFinance();
    const data = () => finStore.useFinance.getState().data!;
    const acc = data().accounts[0];
    const today = todayYmd();
    finStore.saveSubscription({ id: 'salary', name: 'Зарплата', income: true, amount: 500000, accountId: acc.id, period: 'month', every: 1, nextDate: today, active: true, remindDays: 0 } as never);
    finStore.saveSubscription({ id: 'net', name: 'Интернет', amount: 7000, accountId: acc.id, period: 'month', every: 1, nextDate: addDaysYmd(today, 2), active: true, remindDays: 1 } as never);
    const up = fin.upcomingPayments(data(), today, addDaysYmd(today, 5));
    assert.equal(up.find((p) => p.subscriptionId === 'salary')!.income, true);
    assert.equal(up.find((p) => p.subscriptionId === 'net')!.income, undefined);
    const t = finStore.paySubscription('salary')!;
    assert.equal(t.type, 'income');
    assert.equal(t.amount, 500000);
    const s = fin.summarize(data(), { from: today, to: today });
    assert.ok(s.income >= 500000);
    assert.equal(s.expense, 0, 'доход не попал в расходы');
    assert.notEqual(data().subscriptions.find((x) => x.id === 'salary')!.nextDate, today);
  });

  test('напоминание о поступлении — «💰 … Поступление сегодня · +…»', async () => {
    const tasks = await import('../src/tasks/store.ts');
    await tasks.ensureTasks();
    tasks.setPrefs({ notify: true });
    await finStore.flushFinance();
    const sync = await import('../src/tasks/sync.ts');
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const planned = await sync.planReminders(from.getTime(), from.getTime() + 40 * 86400000);
    const sal = planned.find((p) => p.extra.payId && String(p.title).includes('Зарплата'));
    assert.ok(sal, 'есть напоминание о зарплате');
    assert.match(sal!.title, /^💰 Зарплата/);
    assert.match(sal!.body, /^Поступление сегодня · \+/);
    const net = planned.find((p) => p.extra.payId && String(p.title).includes('Интернет'))!;
    assert.match(net.title, /^💳/);
  });
});

describe('порядок привычек', () => {
  const H = (id: string, p: Record<string, unknown> = {}) => ({ id, name: id, color: '#000', ...p });

  test('выше/ниже: у всех активных — номера по порядку, архив не трогаем', () => {
    const list = [H('a'), H('b'), H('c'), H('z', { archived: true })];
    const ch = hm.moveHabitOrder(list, 'c', -1);
    const ord = new Map(ch.map((h) => [h.id, h.order]));
    assert.equal(ord.get('c'), 1);
    assert.equal(ord.get('b'), 2);
    assert.ok(!ord.has('z'));
    assert.deepEqual(hm.moveHabitOrder(list, 'a', -1), [], 'выше первой — некуда');
    const applied = list.map((h) => ch.find((x) => x.id === h.id) ?? h);
    assert.deepEqual(hm.byOrder(hm.activeHabits(applied)).map((h) => h.id), ['a', 'c', 'b']);
  });

  test('в дне: сначала по времени, без времени и при одном времени — ручной порядок', () => {
    const list = [H('x', { order: 2 }), H('y', { order: 0 }), H('t1', { time: '08:00', order: 5 }), H('t2', { time: '08:00', order: 1 }), H('t0', { time: '07:00', order: 9 })];
    assert.deepEqual([...list].sort(hm.compareByTime).map((h) => h.id), ['t0', 't2', 't1', 'y', 'x']);
  });
});

describe('отпечаток', () => {
  test('вне Android — недоступен и не открывает', async () => {
    assert.equal(await lock.biometricAvailable(), false);
    lock.setBiometric(true);
    await lock.setPin('2580');
    lock.lockNow();
    assert.equal(await lock.unlockWithBiometric(), false);
    assert.equal(lock.useLock.getState().locked, true);
    lock.disableLock();
    lock.setBiometric(false);
  });
});
