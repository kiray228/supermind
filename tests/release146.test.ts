/** 1.46: редактор заметок (повтор, шаги отмены, запись и картинки в свою заметку), календарь телефона */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const notes = await import('../src/notes/store.ts');
const model = await import('../src/notes/model.ts');
const ai = await import('../src/notes/ai.ts');
const sync = await import('../src/tasks/sync.ts');

const text = () => notes.useNotes.getState().openBody!.blocks.map((b) => b.text ?? '').join('|');

describe('повреждённый текст заметки', () => {
  test('числа и мусор вместо строк — приводятся, заметка открывается', () => {
    const b = model.normalizeBody({
      title: 42 as unknown as string,
      blocks: [
        { id: 'a', type: 'p', text: 7 as unknown as string },
        { id: 5 as unknown as string, type: 'p', text: 'без строки-id' },
        null as unknown as model.Block,
        { id: 'c', type: 'h1', text: 'ok' },
      ],
      updatedAt: '123' as unknown as number,
    });
    assert.equal(b.title, '42');
    assert.deepEqual(
      b.blocks.map((x) => [x.id, x.text]),
      [
        ['a', '7'],
        ['c', 'ok'],
      ],
    );
    assert.equal(b.updatedAt, 123);
    assert.equal(model.normalizeBody(null).blocks.length, 1, 'пустая заметка — один абзац');
    assert.equal(model.normalizeBody({ title: null as unknown as string }).title, '');
  });
});

describe('отмена и повтор', () => {
  test('повтор возвращает отменённое; новая правка сбрасывает повтор', async () => {
    await notes.ensureNotes();
    const m = notes.createNote({ title: 'Повтор', blocks: [model.newBlock('p', { text: 'один' })] })!;
    await notes.openNote(m.id);
    notes.editOpenBody((bd) => void bd.blocks.push(model.newBlock('p', { text: 'два' })));
    assert.equal(text(), 'один|два');
    notes.undoOpenBody();
    assert.equal(text(), 'один');
    assert.equal(notes.useNotes.getState().canRedo, true);
    notes.redoOpenBody();
    assert.equal(text(), 'один|два');
    assert.equal(notes.useNotes.getState().canRedo, false);
    notes.undoOpenBody();
    notes.editOpenBody((bd) => void bd.blocks.push(model.newBlock('p', { text: 'три' })));
    assert.equal(notes.useNotes.getState().canRedo, false, 'после новой правки повторять нечего');
    notes.redoOpenBody();
    assert.equal(text(), 'один|три');
    await notes.openNote(null);
  });

  test('долгий непрерывный набор — несколько шагов отмены, а не один', async () => {
    const m = notes.createNote({ title: 'Набор', blocks: [model.newBlock('p', { text: '' })] })!;
    await notes.openNote(m.id);
    const id = notes.useNotes.getState().openBody!.blocks[0].id;
    const real = Date.now;
    let now = real();
    Date.now = () => now;
    try {
      // печатаем по символу каждые 0,5 с в течение 10 с — паузы нет ни разу
      for (let i = 0; i < 20; i++) {
        now += 500;
        notes.editOpenBody((bd) => void (bd.blocks = bd.blocks.map((b) => (b.id === id ? { ...b, text: (b.text ?? '') + 'x' } : b))), 'type');
      }
    } finally {
      Date.now = real;
    }
    assert.equal(text().length, 20);
    notes.undoOpenBody();
    const after1 = text().length;
    assert.ok(after1 > 0 && after1 < 20, `одна отмена стёрла не всё (осталось ${after1})`);
    await notes.openNote(null);
  });
});

describe('блоки в другую заметку', () => {
  test('appendBlocksToNote: в закрытую — в сохранённый текст, в открытую — через редактор', async () => {
    const a = notes.createNote({ title: 'A', blocks: [model.newBlock('p', { text: 'a' })] })!;
    const b = notes.createNote({ title: 'B', blocks: [model.newBlock('p', { text: 'b' })] })!;
    await notes.openNote(b.id);
    await notes.appendBlocksToNote(a.id, [model.newBlock('p', { text: 'запись' })]);
    assert.equal(text(), 'b', 'открытая заметка не тронута');
    await notes.appendBlocksToNote(b.id, [model.newBlock('p', { text: 'сюда' })]);
    assert.equal(text(), 'b|сюда');
    await notes.openNote(null);
    await notes.flushNotes();
    const body = await notes.loadNoteBody(a.id);
    assert.deepEqual(
      body.blocks.map((x) => x.text),
      ['a', 'запись'],
    );
  });

  test('в удалённую заметку — ничего', async () => {
    const a = notes.createNote({ title: 'Корзина', blocks: [model.newBlock('p', { text: 'a' })] })!;
    notes.trashNote(a.id);
    await notes.appendBlocksToNote(a.id, [model.newBlock('p', { text: 'x' })]);
    await notes.flushNotes();
    const body = await notes.loadNoteBody(a.id);
    assert.equal(body.blocks.length, 1);
  });
});

describe('«Улучшить» длинную заметку', () => {
  test('сверх предела — отказ до запроса (иначе конец заметки пропал бы)', async () => {
    const long = { title: '', blocks: [model.newBlock('p', { text: 'а'.repeat(ai.IMPROVE_LIMIT + 10) })], updatedAt: 0 };
    await assert.rejects(ai.runNoteAI('improve', long), /слишком длинная/);
  });
});

describe('календарь телефона', () => {
  test('выбор календаря — свой у каждого устройства, общий — запасной', () => {
    const d = { prefs: { calendarId: '3' } };
    localStorage.removeItem('sm-cal-id');
    assert.equal(sync.phoneCalendarId(d), '3', 'на этом телефоне не выбирали — общий');
    sync.setPhoneCalendarId('7');
    assert.equal(sync.phoneCalendarId(d), '7');
    assert.equal(sync.phoneCalendarId({ prefs: {} }), '7');
    sync.setPhoneCalendarId(undefined);
    assert.equal(sync.phoneCalendarId(d), undefined, 'на этом телефоне выбрали «по умолчанию» — общий не подменяет');
  });
});
