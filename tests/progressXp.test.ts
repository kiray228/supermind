import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/srcHooks.ts';

const { computeProgress } = await import('../src/progress/model.ts');
const { emptyFinance } = await import('../src/finance/model.ts');
const { addDaysYmd } = await import('./fixtures/mapTasksStub.ts');

const at = (ymd: string, hm = '12:00') => new Date(`${ymd}T${hm}`).getTime();
const TODAY = '2026-10-13';
type Src = Parameters<typeof computeProgress>[0];
const progress = (src: Record<string, unknown>) => computeProgress({ tasks: null, goals: null, finance: null, notes: null, docs: null, planner: null, ...src } as Src, TODAY);

describe('бюджет соблюдён', () => {
  // траты по 100 каждый месяц с февраля по сентябрь, лимит 1000
  const fin = () => {
    const f = emptyFinance();
    for (let m = 2; m <= 9; m++) f.transactions.push({ id: 'x' + m, type: 'expense', amount: 100, accountId: 'a-cash', date: `2026-0${m}-10`, tags: [], createdAt: 0, updatedAt: 0 });
    return f;
  };

  test('правка лимита не отнимает прошлые месяцы', () => {
    const f = fin();
    f.budgets = [{ id: 'b', limit: 1200, createdAt: at('2026-01-05'), updatedAt: at(TODAY) }];
    assert.equal(progress({ finance: f }).counters.budgetMonths, 8);
  });

  test('старая запись без createdAt — месяцы от updatedAt', () => {
    const f = fin();
    f.budgets = [{ id: 'b', limit: 1000, updatedAt: at('2026-06-05') }];
    assert.equal(progress({ finance: f }).counters.budgetMonths, 3);
  });
});

describe('финансы: опыт только за день записи', () => {
  const tx = (id: string, date: string, createdAt: number) => ({ id, type: 'expense' as const, amount: 10, accountId: 'a-cash', date, tags: [], createdAt, updatedAt: createdAt });

  test('импорт задним числом не даёт активных дней в прошлом', () => {
    const f = emptyFinance();
    for (let i = 2; i <= 60; i++) f.transactions.push(tx('x' + i, addDaysYmd(TODAY, -i), at(TODAY)));
    const p = progress({ finance: f });
    assert.equal(p.counters.financeDays, 0);
    assert.equal(p.counters.streak, 0);
  });

  test('запись в тот же или соседний день считается', () => {
    const f = emptyFinance();
    f.transactions.push(tx('a', TODAY, at(TODAY)), tx('b', '2026-10-10', at('2026-10-11', '09:00')));
    assert.equal(progress({ finance: f }).counters.financeDays, 2);
  });

  test('старые операции без createdAt считаются как раньше', () => {
    const f = emptyFinance();
    f.transactions.push(tx('a', '2026-09-01', 0), tx('b', '2026-09-02', 0));
    assert.equal(progress({ finance: f }).counters.financeDays, 2);
  });
});

describe('лучшая серия привычки для достижений', () => {
  const day = (habits: string[]) => ({ journal: '', tasks: [], habits });

  test('привычка Пн/Ср/Пт: незапланированные дни серию не рвут', () => {
    const h = { id: 'h1', name: 'Зал', color: '#000', freq: 'weekdays', days: [1, 3, 5] };
    const days: Record<string, ReturnType<typeof day>> = {};
    for (let d = '2026-09-14', i = 0; i < 28; i++, d = addDaysYmd(d, 1)) if ([1, 3, 5].includes(new Date(d + 'T12:00').getDay())) days[d] = day(['h1']);
    assert.equal(progress({ planner: { days, habits: [h] } }).counters.bestHabitStreak, 12);
  });

  test('ежедневная привычка — дни подряд, пропуск рвёт', () => {
    const h = { id: 'h2', name: 'Вода', color: '#000' };
    const days: Record<string, ReturnType<typeof day>> = {};
    for (let i = 0; i < 5; i++) days[addDaysYmd('2026-10-01', i)] = day(['h2']);
    for (let i = 0; i < 3; i++) days[addDaysYmd('2026-10-08', i)] = day(['h2']);
    assert.equal(progress({ planner: { days, habits: [h] } }).counters.bestHabitStreak, 5);
  });
});
