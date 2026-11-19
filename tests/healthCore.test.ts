// Шаги и сон из «Здоровья»: расчёт сна и привычки, которые отмечаются сами
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoMarks, bedtimeGoal, fmtSleep, sleepGoal, sleepMinutes, stepsGoal, fellAsleepAt, type HealthDay } from '../src/health/healthCore.ts';
import type { Habit } from '../src/types.ts';

const iso = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const habit = (name: string, extra: Partial<Habit> = {}): Habit => ({ id: name, name, color: '#000', ...extra }) as Habit;
const prev = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const x = new Date(y, m - 1, d - 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

test('сон: iPhone и часы пишут одну ночь — не считаем дважды', () => {
  const s = [
    { startDate: iso(2026, 11, 18, 23, 0), endDate: iso(2026, 11, 19, 7, 0), sleepState: 'asleep' },
    { startDate: iso(2026, 11, 19, 1, 0), endDate: iso(2026, 11, 19, 7, 30), sleepState: 'deep' },
    { startDate: iso(2026, 11, 19, 3, 0), endDate: iso(2026, 11, 19, 3, 20), sleepState: 'awake' },
  ];
  assert.equal(sleepMinutes(s, '2026-11-19'), 8 * 60 + 30);
  assert.equal(new Date(fellAsleepAt(s, '2026-11-19')!).getHours(), 23);
  // дневной сон позавчера и сон следующей ночи в окно не попадают
  assert.equal(sleepMinutes(s, '2026-11-18'), 0);
});

test('сон: стадии Health Connect, без сна — время в кровати', () => {
  const stages = [
    { startDate: iso(2026, 11, 18, 23, 30), endDate: iso(2026, 11, 19, 2, 0), stage: 'light' },
    { startDate: iso(2026, 11, 19, 2, 0), endDate: iso(2026, 11, 19, 2, 30), stage: 'awake' },
    { startDate: iso(2026, 11, 19, 2, 30), endDate: iso(2026, 11, 19, 6, 30), stage: 'rem' },
  ];
  assert.equal(sleepMinutes([{ startDate: iso(2026, 11, 18, 23, 30), endDate: iso(2026, 11, 19, 6, 30), stages }], '2026-11-19'), 6 * 60 + 30);
  assert.equal(sleepMinutes([{ startDate: iso(2026, 11, 18, 23, 0), endDate: iso(2026, 11, 19, 6, 0), sleepState: 'inBed' }], '2026-11-19'), 7 * 60);
});

test('какие привычки отмечаются сами', () => {
  assert.equal(stepsGoal(habit('10 000 шагов')), 10000);
  assert.equal(stepsGoal(habit('8к шагов в день')), 8000);
  assert.equal(stepsGoal(habit('Шаги')), 10000);
  assert.equal(stepsGoal(habit('Пробежка')), null);
  assert.equal(sleepGoal(habit('Сон 7,5 часов')), 450);
  assert.equal(sleepGoal(habit('Высыпаться')), 420);
  assert.equal(sleepGoal(habit('Без экранов перед сном')), null);
  assert.equal(sleepGoal(habit('Лечь спать до 23:00')), null);
  assert.equal(bedtimeGoal(habit('Лечь спать до 23:00')), 23 * 60);
  assert.equal(bedtimeGoal(habit('Отбой до 0:30')), 24 * 60 + 30);
  assert.equal(bedtimeGoal(habit('Лечь спать пораньше')), null);
});

test('отметки: шаги в день шагов, сон — в день пробуждения, «лечь до» — вечером накануне', () => {
  const hs = [habit('10 000 шагов'), habit('Сон 8 часов'), habit('Лечь спать до 23:00'), habit('Читать')];
  const data: HealthDay = {
    steps: { '2026-11-18': 12000, '2026-11-19': 4000 },
    sleep: { '2026-11-19': 8 * 60 + 5 },
    asleepAt: { '2026-11-19': new Date(2026, 10, 18, 22, 50).getTime() },
  };
  const marks = autoMarks(hs, data, '2026-11-19', prev).map(([h, d]) => `${h.name}@${d}`);
  assert.deepEqual(marks.sort(), ['10 000 шагов@2026-11-18', 'Лечь спать до 23:00@2026-11-18', 'Сон 8 часов@2026-11-19']);
  // уснул в 23:40 — «до 23:00» не отмечается
  const late = autoMarks(hs, { ...data, asleepAt: { '2026-11-19': new Date(2026, 10, 18, 23, 40).getTime() } }, '2026-11-19', prev);
  assert.ok(!late.some(([h]) => h.name.startsWith('Лечь')));
  assert.equal(fmtSleep(445), '7 ч 25 мин');
});
