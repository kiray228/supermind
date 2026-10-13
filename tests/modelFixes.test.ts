import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/srcHooks.ts';

const { goalProgress, goalProgressRaw, normalizeGoal } = await import('../src/goals/model.ts');
const { cleanHabit, isCounter, timesOf } = await import('../src/habits/model.ts');
const { balances, detachTransfers, emptyFinance } = await import('../src/finance/model.ts');
const { computeWeek } = await import('../src/review/weekly.ts');

type Habit = Parameters<typeof cleanHabit>[0];
type Tx = Parameters<typeof detachTransfers>[0][number];

describe('процент цели', () => {
  const goal = (current: number) => normalizeGoal({ id: 'g', mode: 'target', target: { start: 0, target: 200, current, unit: 'км', step: 1 } } as Parameters<typeof normalizeGoal>[0]);
  const none = () => undefined;

  test('99,5% показывается как 99, а не 100', () => {
    assert.equal(goalProgress(goal(199), none), 99);
    assert.equal(goalProgressRaw(goal(199), none), 99.5);
  });

  test('дошли до конца — 100', () => {
    assert.equal(goalProgress(goal(200), none), 100);
    assert.equal(goalProgress(goal(101), none), 51);
  });
});

describe('несколько раз в день', () => {
  const base: Habit = { id: 'x', name: 'Витамины', color: '#000' };

  test('одинаковые времена — обычная привычка, не скрытый счётчик', () => {
    const out = cleanHabit({ ...base, times: ['08:00', '08:00'], target: 2, time: '08:00' });
    assert.equal(isCounter(out), false);
    assert.equal(out.target, undefined);
    assert.equal(out.time, '08:00');
    assert.deepEqual(timesOf(out), []);
  });

  test('разные времена — цель по числу времён', () => {
    const out = cleanHabit({ ...base, times: ['20:00', '08:00', '08:00'], target: 3 });
    assert.deepEqual(out.times, ['08:00', '20:00']);
    assert.equal(out.target, 2);
  });

  test('обычный счётчик без времён не меняется', () => {
    assert.equal(cleanHabit({ ...base, target: 8 }).target, 8);
  });
});

describe('удаление счёта', () => {
  const tx = (p: Partial<Tx> & { id: string }): Tx => ({ type: 'transfer', amount: 0, accountId: 'a-card', date: '2026-10-01', tags: [], createdAt: 1, updatedAt: 1, ...p });

  test('переводы с оставшимся счётом становятся расходом/доходом, остаток не меняется', () => {
    const f = emptyFinance();
    f.accounts.push({ id: 'pig', name: 'Копилка', emoji: '', color: '', currency: 'KZT', initial: 0, order: 2, updatedAt: 1 });
    f.transactions.push(
      tx({ id: 'i', type: 'income', amount: 100000, accountId: 'a-card' }),
      tx({ id: 'to', amount: 60000, accountId: 'a-card', toAccountId: 'pig' }),
      tx({ id: 'from', amount: 5000, accountId: 'pig', toAccountId: 'a-cash', toAmount: 4000 }),
      tx({ id: 'other', amount: 1000, accountId: 'a-card', toAccountId: 'a-cash' }),
    );
    const before = balances(f);
    f.accounts = f.accounts.filter((a) => a.id !== 'pig');
    const list = detachTransfers(f.transactions, 'pig', new Set(f.accounts.map((a) => a.id)), 5);
    const byId = new Map(list.map((t) => [t.id, t]));
    assert.deepEqual([byId.get('to')!.type, byId.get('to')!.accountId, byId.get('to')!.amount, byId.get('to')!.toAccountId], ['expense', 'a-card', 60000, undefined]);
    assert.deepEqual([byId.get('from')!.type, byId.get('from')!.accountId, byId.get('from')!.amount, byId.get('from')!.toAmount], ['income', 'a-cash', 4000, undefined]);
    assert.equal(byId.get('to')!.updatedAt, 5);
    assert.equal(byId.get('other'), f.transactions[3]);
    const after = balances({ ...f, transactions: list.filter((t) => t.accountId !== 'pig' && t.toAccountId !== 'pig') });
    assert.equal(after.get('a-card'), before.get('a-card'));
    assert.equal(after.get('a-cash'), before.get('a-cash'));
  });
});

describe('итоги недели: «N раз в неделю», созданная посреди недели', () => {
  const day = (habits: string[]) => ({ journal: '', tasks: [], habits });
  const week = (createdAt?: number) =>
    computeWeek(
      {
        tasks: null,
        finance: null,
        planner: { days: { '2026-10-09': day(['r']), '2026-10-10': day(['r']) }, habits: [{ id: 'r', name: 'Бег', color: '#000', freq: 'weekly', perWeek: 3, createdAt }] } as Parameters<typeof computeWeek>[0]['planner'],
      },
      '2026-10-05',
      new Date('2026-10-14T12:00'),
    );

  test('создана в пятницу: цель — 2 из 3', () => {
    const s = week(new Date('2026-10-09T10:00').getTime());
    assert.equal(s.habitExpected, 2);
    assert.equal(s.habitDone, 2);
  });

  test('создана раньше недели — полная цель', () => {
    assert.equal(week(new Date('2026-09-01T10:00').getTime()).habitExpected, 3);
  });
});
