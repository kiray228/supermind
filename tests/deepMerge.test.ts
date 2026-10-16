/**
 * Слияние вложенных пунктов при синхронизации двух устройств: шаги целей, платежи по долгам,
 * пункты чек-листа задач. Запись (stampChanged) ставит пунктам время и отметки об удалении,
 * слияние (mergeValues) сливает их по пунктам.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/srcHooks.ts';

const { mergeValues, deepMerge } = await import('../src/store/merge.ts');
const { stampChanged } = await import('../src/store/blobSync.ts');

type O = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
/** «Устройство» правит данные: fn меняет копию, запись ставит отметки */
function edit(base: O, fn: (d: O) => void, at: number): O {
  const next = clone(base);
  fn(next);
  const real = Date.now;
  Date.now = () => at;
  try {
    return stampChanged(next, base).value;
  } finally {
    Date.now = real;
  }
}

const goals = (): O => ({
  version: 1,
  goals: [{ id: 'g', title: 'Марафон', updatedAt: 100, stages: [{ id: 'st', title: 'База', steps: [{ id: 's1', title: 'Кроссовки', done: false }, { id: 's2', title: 'План', done: false }], taskIds: [] }] }],
  gone: {},
});
const steps = (d: O) => d.goals[0].stages[0].steps.map((s: O) => `${s.id}:${s.done ? 'x' : '-'}:${s.title}`);

describe('цели: шаги на двух устройствах', () => {
  test('отметили разные шаги — оба отмечены', () => {
    const base = goals();
    const a = edit(base, (d) => (d.goals[0].stages[0].steps[0].done = true), 1000);
    const b = edit(base, (d) => (d.goals[0].stages[0].steps[1].done = true), 2000);
    assert.deepEqual(steps(mergeValues('goals', a, b) as O), ['s1:x:Кроссовки', 's2:x:План']);
    assert.deepEqual(steps(mergeValues('goals', b, a) as O), ['s1:x:Кроссовки', 's2:x:План'], 'порядок слияния не важен');
  });

  test('отметка шага здесь + новое название цели там: оба изменения', () => {
    const base = goals();
    const a = edit(base, (d) => (d.goals[0].stages[0].steps[0].done = true), 1000);
    const b = edit(base, (d) => (d.goals[0].title = 'Марафон 42 км'), 2000);
    const m = mergeValues('goals', a, b) as O;
    assert.equal(m.goals[0].title, 'Марафон 42 км');
    assert.deepEqual(steps(m), ['s1:x:Кроссовки', 's2:-:План']);
  });

  test('один и тот же шаг: побеждает более поздняя правка', () => {
    const base = goals();
    const a = edit(base, (d) => (d.goals[0].stages[0].steps[0].title = 'Кроссовки Asics'), 1000);
    const b = edit(base, (d) => (d.goals[0].stages[0].steps[0].title = 'Кроссовки Nike'), 2000);
    assert.equal((mergeValues('goals', a, b) as O).goals[0].stages[0].steps[0].title, 'Кроссовки Nike');
  });

  test('шаг удалили здесь, а там правили другое — шаг не возвращается; добавленный там — появляется', () => {
    const base = goals();
    const a = edit(base, (d) => d.goals[0].stages[0].steps.splice(1, 1), 1000);
    assert.equal(a.gone['item:s2'], 1000, 'удаление запомнено');
    const b = edit(base, (d) => {
      d.goals[0].title = 'Марафон!';
      d.goals[0].stages[0].steps.push({ id: 's3', title: 'Врач', done: false });
    }, 2000);
    const m = mergeValues('goals', a, b) as O;
    assert.deepEqual(steps(m), ['s1:-:Кроссовки', 's3:-:Врач']);
    assert.equal(m.goals[0].title, 'Марафон!');
  });

  test('шаг удалили здесь, а там его позже исправили — правка сильнее удаления', () => {
    const base = goals();
    const a = edit(base, (d) => d.goals[0].stages[0].steps.splice(1, 1), 1000);
    const b = edit(base, (d) => (d.goals[0].stages[0].steps[1].title = 'План на 16 недель'), 2000);
    assert.deepEqual(steps(mergeValues('goals', a, b) as O), ['s1:-:Кроссовки', 's2:-:План на 16 недель']);
  });

  test('старые данные без отметок у пунктов — как раньше: версия посвежее целиком', () => {
    const older = { id: 'g', updatedAt: 1, stages: [{ id: 'st', steps: [{ id: 'old', done: true }] }] };
    const newer = { id: 'g', updatedAt: 2, stages: [{ id: 'st', steps: [] as O[] }] };
    assert.deepEqual(deepMerge(newer, older, {}).stages, [{ id: 'st', steps: [] }], 'удалённое до обновления не воскресает');
  });
});

describe('финансы и задачи', () => {
  test('платежи по долгу на двух устройствах — оба', () => {
    const base: O = { version: 1, debts: [{ id: 'd', person: 'Аня', amount: 1000, updatedAt: 1, payments: [] }], gone: {} };
    const a = edit(base, (d) => d.debts[0].payments.push({ id: 'p1', amount: 300, date: '2026-10-16' }), 1000);
    const b = edit(base, (d) => d.debts[0].payments.push({ id: 'p2', amount: 200, date: '2026-10-16' }), 2000);
    const m = mergeValues('finance', a, b) as O;
    assert.deepEqual(m.debts[0].payments.map((p: O) => p.id).sort(), ['p1', 'p2']);
  });

  test('чек-лист задачи: отметка пункта здесь, переименование задачи там', () => {
    const base: O = { tasks: [{ id: 't', title: 'Переезд', updatedAt: 1, checklist: [{ id: 'c1', text: 'Коробки', done: false }, { id: 'c2', text: 'Грузчики', done: false }] }], gone: {} };
    const a = edit(base, (d) => (d.tasks[0].checklist[1].done = true), 1000);
    const b = edit(base, (d) => (d.tasks[0].title = 'Переезд в субботу'), 2000);
    const m = mergeValues('tasks', a, b) as O;
    assert.equal(m.tasks[0].title, 'Переезд в субботу');
    assert.deepEqual(m.tasks[0].checklist.map((c: O) => c.done), [false, true]);
  });

  test('запись без изменений ничего не помечает; первая запись — тоже', () => {
    const base = goals();
    assert.equal(stampChanged(clone(base), base).stamped, false);
    assert.equal(stampChanged(clone(base), null).stamped, false);
  });
});
