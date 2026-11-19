// Ссылки из виджетов iPhone → действия приложения
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionFromUrl } from '../src/native/widgetUrl.ts';

test('ссылки виджетов iPhone разбираются в действия', () => {
  assert.deepEqual(actionFromUrl('supermind://open_task?id=abc'), { type: 'open_task', id: 'abc' });
  assert.deepEqual(actionFromUrl('supermind://quick_add'), { type: 'quick_add' });
  assert.deepEqual(actionFromUrl('supermind://open_view?view=habits'), { type: 'open_view', view: 'habits' });
  assert.equal(actionFromUrl('supermind://open_task'), null);
  assert.equal(actionFromUrl('https://evil.example/open_task?id=1'), null);
  assert.equal(actionFromUrl('supermind://delete_all'), null);
  assert.equal(actionFromUrl('не ссылка'), null);
});
