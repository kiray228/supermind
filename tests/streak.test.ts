import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dayStreak } from '../src/progress/streak.ts';

/** n дней подряд, заканчивая днём end (включительно) */
function run(end: string, n: number): string[] {
  const out: string[] = [];
  const t = Date.parse(end + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push(new Date(t - i * 86400000).toISOString().slice(0, 10));
  return out;
}

describe('общая серия с заморозками', () => {
  test('без пропусков — обычная серия', () => {
    const s = dayStreak(run('2026-10-09', 5), '2026-10-09');
    assert.equal(s.current, 5);
    assert.equal(s.best, 5);
    assert.equal(s.freezesUsed, 0);
  });

  test('сегодня ещё нет активности — серия не потеряна', () => {
    const s = dayStreak(run('2026-10-08', 4), '2026-10-09');
    assert.equal(s.current, 4);
  });

  test('пропуск без заморозки рвёт серию', () => {
    const s = dayStreak([...run('2026-10-09', 2), ...run('2026-10-06', 4)], '2026-10-09');
    assert.equal(s.current, 2);
    assert.equal(s.best, 4);
    assert.deepEqual(s.frozen, []);
  });

  test('7 дней подряд дают заморозку, она закрывает один пропуск', () => {
    // 1–7 октября активны, 8-го пропуск, 9-го снова активен
    const s = dayStreak(['2026-10-09', ...run('2026-10-07', 7)], '2026-10-09');
    assert.equal(s.current, 8);
    assert.equal(s.freezesUsed, 1);
    assert.equal(s.banked, 0);
    assert.deepEqual(s.frozen, ['2026-10-08']);
  });

  test('копится не больше двух заморозок', () => {
    // 28 дней подряд → 4 заработано, но в запасе максимум 2; три пропуска подряд рвут серию
    const days = ['2026-10-09', ...run('2026-10-05', 28)];
    const s = dayStreak(days, '2026-10-09');
    assert.equal(s.current, 1);
    assert.equal(s.best, 28);
    assert.deepEqual(s.frozen, [], 'заморозки, которые не спасли серию, не показываются');
    const two = dayStreak(['2026-10-09', ...run('2026-10-06', 28)], '2026-10-09');
    assert.equal(two.current, 29);
    assert.equal(two.freezesUsed, 2);
  });

  test('активных дней за 30', () => {
    const s = dayStreak([...run('2026-10-09', 3), '2026-09-01'], '2026-10-09');
    assert.equal(s.rolling30, 3);
  });

  test('будущие дни не считаются', () => {
    const s = dayStreak(['2026-10-10', ...run('2026-10-09', 2)], '2026-10-09');
    assert.equal(s.current, 2);
  });
});
