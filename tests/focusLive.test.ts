// Таймер фокуса на экране блокировки: что уходит в Live Activity / уведомление
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveState } from '../src/native/focusLiveCore.ts';
import type { FocusState } from '../src/tasks/focusTimer.ts';

const base: FocusState = {
  mode: 'pomo', phase: 'work', running: false, endAt: null, remaining: null, total: 25 * 60000,
  startedAt: null, acc: 0, sessionStart: null, completedPomos: 0, noise: 'none', volume: 0.5, now: 0,
};

test('не запущен — на экране блокировки ничего', () => {
  assert.equal(liveState(base, undefined, 1000), null);
});

test('помодоро идёт: конец фазы; на паузе — остаток', () => {
  const run = liveState({ ...base, running: true, sessionStart: 0, endAt: 1_500_000 }, 'Отчёт', 1000)!;
  assert.equal(run.running, true);
  assert.equal(run.endAt, 1_500_000);
  assert.equal(run.task, 'Отчёт');
  assert.equal(run.title, 'Фокус');
  assert.equal(run.doneTitle, 'Помодоро завершён');
  const paused = liveState({ ...base, sessionStart: 0, remaining: 600_000 }, undefined, 1000)!;
  assert.equal(paused.running, false);
  assert.equal(paused.left, 600_000);
  assert.equal(paused.endAt, undefined);
});

test('секундомер: «ноль» не зависит от момента вызова', () => {
  const s = { ...base, mode: 'stopwatch' as const, running: true, sessionStart: 0, startedAt: 10_000, acc: 5_000 };
  assert.equal(liveState(s, undefined, 20_000)!.start, 5_000);
  assert.equal(liveState(s, undefined, 90_000)!.start, 5_000);
  const p = liveState({ ...s, running: false, startedAt: null, acc: 42_000 }, undefined, 99_000)!;
  assert.equal(p.elapsed, 42_000);
  assert.equal(p.title, 'Секундомер');
});
