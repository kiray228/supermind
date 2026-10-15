import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const { renderInline, hasMarkup } = await import('../src/notes/inline.tsx');
const { createElement, Fragment } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

const html = (text: string, opts?: Parameters<typeof renderInline>[2]) => renderToStaticMarkup(createElement(Fragment, null, ...renderInline(text, 0, opts)));

describe('[[ссылки]] и упоминания в тексте заметки', () => {
  test('[[ссылка]] и [[ссылка|подпись]]', () => {
    const h = html('см. [[Бюджет]] и [[Подушка безопасности|подушку]]');
    assert.ok(h.includes('class="nt-link nt-wiki"'), h);
    assert.ok(h.includes('>Бюджет</a>'));
    assert.ok(h.includes('>подушку</a>'));
    assert.ok(h.includes('title="Подушка безопасности"'));
  });

  test('несуществующая — «ещё не создана»', () => {
    const h = html('[[Новая идея]]', { wikiExists: () => false });
    assert.ok(h.includes('nt-wiki is-new'), h);
    assert.ok(h.includes('ещё нет'));
  });

  test('упоминания — по позициям в исходном тексте', () => {
    const text = 'Откладываю в подушку безопасности каждый месяц';
    const start = text.indexOf('подушку');
    const h = html(text, { mentions: [{ start, end: start + 'подушку безопасности'.length, id: 'n2' }], onMention: () => {}, mentionTitle: () => 'Заметка «Подушка безопасности»' });
    assert.ok(h.includes('<a href="#" class="nt-mention" title="Заметка «Подушка безопасности»">подушку безопасности</a>'), h);
    assert.ok(h.startsWith('Откладываю в '));
    assert.ok(h.endsWith(' каждый месяц'));
  });

  test('упоминания рядом с разметкой: позиции сдвигаются верно', () => {
    const text = '**важно**: Стамбул и `код` Киото';
    const s1 = text.indexOf('Стамбул');
    const s2 = text.indexOf('Киото');
    const h = html(text, {
      mentions: [
        { start: s1, end: s1 + 7, id: 'a' },
        { start: s2, end: s2 + 5, id: 'b' },
      ],
      onMention: () => {},
    });
    assert.ok(h.includes('<strong>важно</strong>'));
    assert.ok(h.includes('class="nt-mention">Стамбул</a>'), h);
    assert.ok(h.includes('class="nt-mention">Киото</a>'), h);
    assert.ok(h.includes('<code>код</code>'));
  });

  test('без обработчика упоминания — обычный текст', () => {
    const h = html('Стамбул', { mentions: [{ start: 0, end: 7, id: 'a' }] });
    assert.equal(h, 'Стамбул');
  });

  test('упоминание, задевающее разметку, не ломает её', () => {
    const text = 'a **Стамбул** b';
    const h = html(text, { mentions: [{ start: 4, end: 11, id: 'a' }], onMention: () => {} });
    assert.ok(h.includes('<strong>Стамбул</strong>'), h);
    assert.ok(!h.includes('nt-mention'));
  });

  test('обычная разметка работает как раньше', () => {
    const h = html('**ж** *к* ~~з~~ ==в== [сайт](https://x.ru) https://y.ru 2*3*4');
    assert.ok(h.includes('<strong>ж</strong>') && h.includes('<em>к</em>') && h.includes('<s>з</s>') && h.includes('<mark>в</mark>'));
    assert.ok(h.includes('href="https://x.ru"') && h.includes('href="https://y.ru"'));
    assert.ok(h.includes('2*3*4'), 'звёздочки внутри чисел — не курсив');
  });

  test('опасные адреса — не ссылки', () => {
    const h = html('[жми](javascript:alert(1))');
    assert.ok(!h.includes('href="javascript'), h);
  });

  test('hasMarkup видит [[ссылку]]', () => {
    assert.ok(hasMarkup('см [[x]]'));
    assert.ok(!hasMarkup('просто текст'));
  });
});
