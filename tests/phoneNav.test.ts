/** Телефон: к какой вкладке относится раздел и куда ведёт «назад» */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';

const { phoneTab, isPhoneTab, nextBackTab, moreBlocks, normTabs, TAB_BLOCKS, TAB_INFO } = await import('../src/store/phoneNav.ts');

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

test('«Доска» — раздел для телефона: в «Ещё», в панели по выбору', () => {
  assert.ok(TAB_BLOCKS.includes('board'));
  assert.equal(TAB_BLOCKS.indexOf('board'), TAB_BLOCKS.indexOf('tasks') + 1);
  assert.equal(TAB_INFO.board.label, 'Доска');
  // по умолчанию её нет в панели — она в «Ещё», и «назад» ведёт туда
  assert.ok(moreBlocks(['today', 'home', 'notes']).includes('board'));
  assert.equal(phoneTab('board'), 'more');
  assert.equal(nextBackTab('more', 'board', null), 'more');
  // поставили в панель — своя вкладка, из «Ещё» пропадает
  const tabs = normTabs(['today', 'board', 'notes']);
  assert.deepEqual(tabs, ['today', 'board', 'notes']);
  assert.equal(phoneTab('board', tabs), 'board');
  assert.ok(isPhoneTab('board', tabs));
  assert.ok(!moreBlocks(tabs).includes('board'));
});
