// Spotlight iPhone (что индексируется и что отправлять) и разбор текста из Siri
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpotlightItems, diffSpotlight, spotHash, spotKey } from '../src/native/spotlightCore.ts';
import { noteFromSiri, taskFromSiri } from '../src/native/siriCore.ts';

const src = {
  maps: [
    { id: 'm1', title: 'План', updatedAt: 30, preview: { r: 'План', k: [{ t: 'Цели' }, { t: '  Шаги\n' }] } },
    { id: 'm2', title: 'Старое', updatedAt: 5, trashed: true },
    { id: 'm3', title: '', updatedAt: 1, preview: { r: 'Центр', k: [] } },
  ],
  notes: [
    { id: 'n1', title: '', preview: 'Первая строка\nвторая', updatedAt: 40 },
    { id: 'n2', title: 'В корзине', preview: '', updatedAt: 50, trashed: 50 },
    { id: 'n3', title: '   ', preview: '', updatedAt: 10 },
  ],
  tasks: [
    { id: 't1', title: 'Позвонить', notes: 'маме', updatedAt: 20 },
    { id: 't2', title: 'Готово', done: true, updatedAt: 60 },
    { id: 't3', title: 'Удалена', deleted: 70, done: false, updatedAt: 70 },
    { id: 't4', title: 'Не буду', wontDo: true, done: false, updatedAt: 80 },
  ],
};

test('Spotlight: карты, заметки и открытые задачи — свежие первыми', () => {
  const items = buildSpotlightItems(src);
  assert.deepEqual(
    items.map((i) => spotKey(i)),
    ['note:n1', 'map:m1', 'task:t1', 'map:m3'],
  );
  assert.deepEqual(items[0], { id: 'n1', kind: 'note', title: 'Первая строка', text: 'Первая строка вторая' });
  assert.deepEqual(items[1], { id: 'm1', kind: 'map', title: 'План', text: 'Цели, Шаги' });
  assert.deepEqual(items[2], { id: 't1', kind: 'task', title: 'Позвонить', text: 'маме' });
  // без названия — центральная тема
  assert.equal(items[3].title, 'Центр');
  assert.equal(items[3].text, undefined);
});

test('Spotlight: не больше предела, длинное обрезается', () => {
  const many = { maps: [], notes: [], tasks: Array.from({ length: 50 }, (_, i) => ({ id: 't' + i, title: 'x'.repeat(300), notes: 'y'.repeat(500), updatedAt: i })) };
  const items = buildSpotlightItems(many, 10);
  assert.equal(items.length, 10);
  assert.equal(items[0].id, 't49');
  assert.equal(items[0].title.length, 200);
  assert.equal(items[0].text!.length, 160);
  assert.ok(items[0].text!.endsWith('…'));
});

test('Spotlight: отправляются только новые, изменённые и удалённые', () => {
  const a = { id: 'a', kind: 'note' as const, title: 'A' };
  const b = { id: 'b', kind: 'task' as const, title: 'B', text: 'x' };
  const first = diffSpotlight({}, [a, b]);
  assert.deepEqual(first.upsert, [a, b]);
  assert.deepEqual(first.remove, []);
  const same = diffSpotlight(first.next, [a, b]);
  assert.deepEqual(same.upsert, []);
  assert.deepEqual(same.remove, []);
  const b2 = { ...b, text: 'y' };
  const changed = diffSpotlight(first.next, [b2]);
  assert.deepEqual(changed.upsert, [b2]);
  assert.deepEqual(changed.remove, ['note:a']);
  assert.notEqual(spotHash(b), spotHash(b2));
});

test('Siri: задача из фразы и заметка из диктовки', () => {
  const parse = (s: string) => ({ title: s.replace(' завтра в 10:00', ''), date: '2026-11-20', time: '10:00', tags: [], spans: [] });
  assert.deepEqual(taskFromSiri('  Позвонить маме завтра в 10:00 ', parse), { title: 'Позвонить маме', date: '2026-11-20', time: '10:00' });
  // разбор «съел» всё или упал — название остаётся как сказано
  assert.deepEqual(taskFromSiri('завтра', () => ({ title: '', date: '2026-11-20', tags: [], spans: [] })), { title: 'завтра', date: '2026-11-20' });
  assert.deepEqual(
    taskFromSiri('Купить хлеб', () => {
      throw new Error('x');
    }),
    { title: 'Купить хлеб' },
  );
  assert.equal(taskFromSiri('   ', parse), null);

  assert.deepEqual(noteFromSiri('Идея'), { title: 'Идея' });
  assert.deepEqual(noteFromSiri('Список\nмолоко\nхлеб'), { title: 'Список', body: 'Список\nмолоко\nхлеб' });
  const long = 'а'.repeat(120);
  assert.equal(noteFromSiri(long)!.title.length, 80);
  assert.equal(noteFromSiri(long)!.body, long);
  assert.equal(noteFromSiri(' \n '), null);
});
