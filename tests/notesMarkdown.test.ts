import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';

const { markdownToBlocks, newBlock, noteToMarkdown } = await import('../src/notes/model.ts');

const simple = (md: string) => markdownToBlocks(md).map((b) => [b.type, b.text]);

describe('заметки: Markdown → блоки', () => {
  test('год в начале абзаца — не нумерованный список', () => {
    assert.deepEqual(simple('2024. Год был сложным'), [['p', '2024. Год был сложным']]);
    assert.deepEqual(simple('1. один\n2) два\n100. сто'), [
      ['number', 'один'],
      ['number', 'два'],
      ['number', 'сто'],
    ]);
  });

  test('выноска переживает экспорт и импорт', () => {
    const blocks = [newBlock('callout', { text: 'Важно\nвторая строка' }), newBlock('p', { text: 'между' }), newBlock('quote', { text: 'цитата' })];
    const md = noteToMarkdown({ title: '', blocks, updatedAt: 0 }, { noTitle: true });
    assert.deepEqual(simple(md), [
      ['callout', 'Важно\nвторая строка'],
      ['p', 'между'],
      ['quote', 'цитата'],
    ]);
  });

  test('обычная цитата остаётся цитатой', () => {
    assert.deepEqual(simple('> раз\n> два'), [['quote', 'раз\nдва']]);
  });
});
