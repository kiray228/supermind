/** Телефон: к какой вкладке относится раздел и куда ведёт «назад» */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';

const { phoneTab, isPhoneTab, nextBackTab } = await import('../src/store/phoneNav.ts');

test('разделы раскладываются по четырём вкладкам', () => {
  for (const v of ['today', 'tasks', 'calendar', 'habits', 'focus', 'planner'] as const) assert.equal(phoneTab(v), 'today', v);
  for (const v of ['home', 'editor'] as const) assert.equal(phoneTab(v), 'home', v);
  for (const v of ['notes', 'goals'] as const) assert.equal(phoneTab(v), 'notes', v);
  for (const v of ['more', 'finance', 'progress', 'settings', 'assistant', 'board'] as const) assert.equal(phoneTab(v), 'more', v);
  assert.ok(isPhoneTab('today') && isPhoneTab('home') && isPhoneTab('notes') && isPhoneTab('more'));
  assert.ok(!isPhoneTab('finance') && !isPhoneTab('editor'));
});

test('«назад» ведёт туда, откуда пришли', () => {
  // Финансы с «Сегодня» — назад на «Сегодня», а не в «Ещё»
  assert.equal(nextBackTab('today', 'finance', null), 'today');
  assert.equal(nextBackTab('more', 'finance', null), 'more');
  // переход внутри (Задачи → Календарь) помнит исходную вкладку
  assert.equal(nextBackTab('tasks', 'calendar', 'today'), 'today');
  // вернулись на вкладку — память сбрасывается
  assert.equal(nextBackTab('finance', 'today', 'today'), null);
  // из карты (редактора) — к «Картам»
  assert.equal(nextBackTab('editor', 'goals', null), 'home');
});
