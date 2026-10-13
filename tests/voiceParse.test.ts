import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';

const { parseVoice } = await import('../src/voice/intent.ts');
const { parseTask } = await import('../src/tasks/parse.ts');

const now = new Date(2026, 9, 13, 12, 0); // вторник
const ctx = {
  now,
  categories: [
    { id: 'c-cafe', name: 'Кафе', kind: 'expense' as const },
    { id: 'c-transport', name: 'Транспорт', kind: 'expense' as const },
  ],
  accounts: [{ id: 'a', name: 'Kaspi' }],
};
const money = (s: string) => parseVoice(s, ctx).actions.map((a) => (a.type === 'add_transaction' ? [a.amount, a.currency ?? ''] : [a.type, '']));

describe('голос: суммы', () => {
  test('количество — не цена', () => {
    assert.deepEqual(money('купил 2 пиццы за 6000'), [[6000, '']]);
    assert.deepEqual(money('потратил 1000 на 2 кофе'), [[1000, '']]);
  });
  test('количество после «и» — не вторая трата', () => {
    assert.deepEqual(money('потратил 1500 на кофе и 2 круассана'), [[1500, '']]);
    assert.deepEqual(money('потратил 2000 на такси и 3500 на обед'), [[2000, ''], [3500, '']]);
    assert.deepEqual(money('потратил 5000 и 3000'), [[5000, ''], [3000, '']]);
  });
  test('тысячу, тыщу, миллион без числа', () => {
    assert.deepEqual(money('потратил тысячу на кофе'), [[1000, '']]);
    assert.deepEqual(money('потратил тыщу на такси'), [[1000, '']]);
    assert.deepEqual(money('получил миллион'), [[1000000, '']]);
  });
  test('остаток после «тысячи»', () => {
    assert.deepEqual(money('потратил 2 тысячи 500 на кино'), [[2500, '']]);
    assert.deepEqual(money('потратил две тысячи пятьсот на обед'), [[2500, '']]);
  });
  test('валюта из фразы', () => {
    assert.deepEqual(money('потратил 10 долларов на подписку'), [[10, 'USD']]);
    assert.deepEqual(money('потратил 4500 тенге на такси'), [[4500, 'KZT']]);
  });
});

describe('даты', () => {
  const p = (s: string, at = now) => {
    const r = parseTask(s, at);
    return [r.title, r.date, r.time ?? ''];
  };
  test('«на» перед датой не остаётся в названии', () => {
    assert.deepEqual(p('на завтра купить хлеб'), ['купить хлеб', '2026-10-14', '']);
    assert.deepEqual(p('на пятницу записаться к врачу'), ['записаться к врачу', '2026-10-16', '']);
    assert.deepEqual(p('на 15 октября оплатить'), ['оплатить', '2026-10-15', '']);
  });
  test('ночное время', () => {
    assert.deepEqual(p('позвонить в 11 ночи'), ['позвонить', '2026-10-13', '23:00']);
    assert.deepEqual(p('позвонить в 2 ночи'), ['позвонить', '2026-10-14', '02:00']);
  });
  test('через месяц/год в конце месяца', () => {
    assert.equal(parseTask('через месяц продлить', new Date(2027, 0, 31, 12)).date, '2027-02-28');
    assert.equal(parseTask('через год проверить', new Date(2028, 1, 29, 12)).date, '2029-02-28');
  });
  test('повтор с уже прошедшим временем — не просрочен сразу', () => {
    assert.equal(parseTask('каждую неделю в 9 отчёт', now).date, '2026-10-20');
    assert.equal(parseTask('каждый месяц в 9 счета', now).date, '2026-11-13');
    assert.equal(parseTask('каждую неделю в 15 отчёт', now).date, '2026-10-13');
  });
  test('«о среде» — не дата', () => {
    assert.equal(parseTask('подумать о среде обитания', now).date, undefined);
  });
});
