import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';
import type { Sheet, Topic } from '../src/types.ts';

const { sheetToMarkdown, markdownToTopic } = await import('../src/io/markdown.ts');
const { sheetToOpml, opmlToTopic } = await import('../src/io/opml.ts');

let n = 0;
const topic = (text: string, children: Topic[] = []): Topic => ({ id: 't' + n++, text, children }) as Topic;
const sheet = (root: Topic): Sheet => ({ id: 's', title: 'Лист', root, floating: [], relationships: [], boundaries: [], summaries: [], structure: 'map', themeId: 'classic' }) as unknown as Sheet;
const texts = (t: Topic): unknown => [t.text, ...t.children.map(texts)];

describe('Markdown: экспорт → импорт', () => {
  const tricky = [
    '--',
    '- - -',
    '***',
    '__init__.py',
    'Learn #python',
    '[ ] x',
    '[x] done',
    'a *b* c',
    '**жирный**',
    '~~зачёркнуто~~',
    '`код`',
    'a\\`b`',
    'C:\\Users\\*',
    'конец \\',
    '[ссылка](http://x.y)',
    '![img](a.png)',
    '<https://example.com>',
    'Тема ##',
    'Vector<int>',
    '1. пункт',
    '> цитата',
    'a_b_c',
  ];

  test('текст тем возвращается без изменений', () => {
    const root = topic('Корень #1 *x*', [topic('Раздел', tricky.map((s) => topic(s))), ...tricky.map((s) => topic(s, [topic(s)]))]);
    const back = markdownToTopic(sheetToMarkdown(sheet(root)));
    assert.deepEqual(texts(back), texts(root));
    // ни задач, ни меток, ни ссылок не появилось
    const walk = (t: Topic) => {
      assert.equal(t.task, undefined, t.text);
      assert.equal(t.labels, undefined, t.text);
      assert.equal(t.link, undefined, t.text);
      t.children.forEach(walk);
    };
    walk(back);
  });

  test('ссылка с экранируемым текстом', () => {
    const t = topic('a_(b)_*c*');
    t.link = 'https://en.wikipedia.org/wiki/A_(b)';
    const back = markdownToTopic(sheetToMarkdown(sheet(topic('R', [t]))));
    assert.equal(back.children[0].text, 'a_(b)_*c*');
    assert.ok(back.children[0].link);
  });
});

describe('Markdown: импорт', () => {
  test('скобки в адресе ссылки', () => {
    const t = markdownToTopic('# R\n- [Вики](https://en.wikipedia.org/wiki/A_(b))');
    assert.equal(t.children[0].link, 'https://en.wikipedia.org/wiki/A_(b)');
    assert.equal(t.children[0].text, 'Вики');
    // старые файлы: «)» закодирована, «(» — нет
    assert.equal(markdownToTopic('# R\n- [W](https://x.org/A_(b%29)').children[0].link, 'https://x.org/A_(b%29');
    assert.equal(markdownToTopic('# R\n- [W](https://x.org/a) (b)').children[0].link, 'https://x.org/a');
  });

  test('несколько заголовков верхнего уровня — ветви одного корня', () => {
    const t = markdownToTopic('## Install\n- npm i\n## Usage\n- run\n## License\nMIT');
    assert.equal(t.text, 'Центральная тема');
    assert.deepEqual(
      t.children.map((c) => c.text),
      ['Install', 'Usage', 'License'],
    );
    assert.equal(t.children[0].children[0].text, 'npm i');
  });

  test('единственный заголовок верхнего уровня — корень', () => {
    const t = markdownToTopic('Вступление\n\n# Проект\n## Цели\n- одна\n## Этапы');
    assert.equal(t.text, 'Проект');
    assert.equal(t.note, 'Вступление');
    assert.deepEqual(
      t.children.map((c) => c.text),
      ['Цели', 'Этапы'],
    );
  });
});

describe('OPML', async () => {
  let DOMParser: unknown;
  try {
    ({ DOMParser } = await import('@xmldom/xmldom'));
  } catch {
    /* нет парсера XML */
  }

  test('угловые скобки в тексте не пропадают', { skip: !DOMParser && 'нет @xmldom/xmldom' }, () => {
    (globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
    const root = topic('R', [topic('Vector<int>'), topic('a < b and c > d'), topic('<b>жирный</b>')]);
    const back = opmlToTopic(sheetToOpml(sheet(root), 'R'));
    assert.deepEqual(texts(back), texts(root));
  });
});
