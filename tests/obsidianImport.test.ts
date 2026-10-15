import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';

const { parseVault, splitFrontmatter, parseDate, convertWiki, dropOwnRelated, commonRoot, isSkippedPath, IMG_REF } = await import('../src/notes/obsidianImport.ts');
const { buildVault } = await import('../src/notes/obsidian.ts');
const { markdownToBlocks } = await import('../src/notes/model.ts');

const one = (text: string, path = 'Заметка.md', images: string[] = []) => parseVault([{ path, text }], images)[0];
const kinds = (text: string, images: string[] = []) => one(text, 'Заметка.md', images).blocks.map((b) => [b.type, b.text ?? b.src ?? '']);

describe('шапка YAML', () => {
  test('название, даты, теги списком и строкой, псевдонимы', () => {
    const { front, body } = splitFrontmatter('---\ntitle: "Мой «план»"\ncreated: 2024-05-01T10:00:00Z\nmodified: 2024-06-02\ntags:\n  - бег\n  - "#здоровье"\naliases: [План, Plan]\n---\nТекст');
    assert.equal(front.title, 'Мой «план»');
    assert.equal(front.created, Date.parse('2024-05-01T10:00:00Z'));
    assert.equal(front.updated, new Date(2024, 5, 2).getTime());
    assert.deepEqual(front.tags, ['бег', 'здоровье']);
    assert.deepEqual(front.aliases, ['План', 'Plan']);
    assert.equal(body, 'Текст');
    assert.deepEqual(splitFrontmatter('---\ntags: a, b\n---\n').front.tags, ['a', 'b']);
  });

  test('без шапки, BOM, CRLF, незакрытая шапка — текст как есть', () => {
    assert.equal(splitFrontmatter('﻿Просто текст\r\nвторая').body, 'Просто текст\nвторая');
    assert.equal(splitFrontmatter('---\ntitle: x\nбез конца').body, '---\ntitle: x\nбез конца');
    assert.equal(splitFrontmatter('Текст\n---\ntitle: x\n---').front.title, undefined);
  });

  test('даты: разные записи, мусор', () => {
    assert.equal(parseDate('2024-01-02'), new Date(2024, 0, 2).getTime());
    assert.equal(parseDate('2024-01-02 13:45'), new Date(2024, 0, 2, 13, 45).getTime());
    assert.equal(parseDate("'2024-01-02'"), new Date(2024, 0, 2).getTime());
    assert.equal(parseDate('вчера'), undefined);
    assert.equal(parseDate(undefined), undefined);
  });
});

describe('ссылки', () => {
  const none = () => undefined;
  test('раздел, блок, путь и подпись', () => {
    assert.equal(convertWiki('Бюджет', none), '[[Бюджет]]');
    assert.equal(convertWiki('Бюджет#Расходы', none), '[[Бюджет]]');
    assert.equal(convertWiki('Бюджет#Расходы|траты', none), '[[Бюджет|траты]]');
    assert.equal(convertWiki('Бюджет^abc', none), '[[Бюджет]]');
    assert.equal(convertWiki('Финансы/Бюджет.md', none), '[[Бюджет]]');
    assert.equal(convertWiki('#Раздел', none), 'Раздел');
    assert.equal(convertWiki('#Раздел|сюда', none), 'сюда');
  });

  test('имя файла → название из шапки (подпись — имя файла, если своей нет)', () => {
    const t = (x: string) => (x === '2024-05 план' ? 'План на май' : undefined);
    assert.equal(convertWiki('2024-05 план', t), '[[План на май|2024-05 план]]');
    assert.equal(convertWiki('2024-05 план|май', t), '[[План на май|май]]');
  });

  test('по всему хранилищу: ссылка на файл с другим названием, псевдоним', () => {
    const notes = parseVault([
      { path: 'v/a.md', text: '---\ntitle: Подушка безопасности\naliases: [Подушка]\n---\nТекст' },
      { path: 'v/b.md', text: 'См. [[a]] и [[Подушка|запас]] и [[Нет такой]].' },
    ]);
    assert.equal(notes[1].blocks[0].text, 'См. [[Подушка безопасности|a]] и [[Подушка безопасности|запас]] и [[Нет такой]].');
  });
});

describe('текст', () => {
  test('заголовки, списки, задачи, цитаты, код, разделитель', () => {
    assert.deepEqual(kinds('# Заголовок\n\nАбзац\n- пункт\n- [x] сделано\n1. первый\n> цитата\n---\n```js\nconst a = [[1]];\n```'), [
      ['h1', 'Заголовок'],
      ['p', 'Абзац'],
      ['bullet', 'пункт'],
      ['todo', 'сделано'],
      ['number', 'первый'],
      ['quote', 'цитата'],
      ['divider', ''],
      ['code', 'const a = [[1]];'],
    ]);
  });

  test('выноски > [!note] → выноска с заголовком и текстом', () => {
    const b = one('> [!warning]- Осторожно\n> не забыть паспорт\n\n> [!tip]\n> только текст').blocks;
    assert.deepEqual(
      b.map((x) => [x.type, x.text]),
      [
        ['callout', 'Осторожно\nне забыть паспорт'],
        ['callout', 'только текст'],
      ],
    );
  });

  test('комментарии %% %% и ^id блоков убираются; внутри кода — нет', () => {
    assert.deepEqual(kinds('Видно %%скрыто%% тут ^abc-1\n```\n%%код%% ^x\n```'), [
      ['p', 'Видно  тут'],
      ['code', '%%код%% ^x'],
    ]);
  });

  test('раздел «Связанные заметки» из экспорта SuperMind убирается, свой — остаётся', () => {
    assert.equal(dropOwnRelated('Текст\n\n## Связанные заметки\n\n- [[A]]\n- [[B|Б]]\n').trim(), 'Текст');
    const mid = 'Текст\n## Связанные заметки\n- [[A]]\nЕщё мой текст';
    assert.equal(dropOwnRelated(mid), mid);
    const own = 'Текст\n## Связанные заметки\n- мои мысли';
    assert.equal(dropOwnRelated(own), own);
  });
});

describe('картинки', () => {
  const imgs = ['Vault/attachments/фото 1.png', 'Vault/Папка/схема.jpg', 'Vault/другое/фото 1.png'];
  const md = (text: string, path = 'Vault/Папка/Заметка.md') => parseVault([{ path, text }], imgs)[0].blocks;

  test('![[имя]] — по имени файла, с подписью; размер — не подпись', () => {
    const b = md('До\n![[фото 1.png|Закат]]\n![[схема.jpg|300]]\nПосле');
    assert.deepEqual(
      b.map((x) => [x.type, x.src ?? x.text, x.caption]),
      [
        ['p', 'До', undefined],
        ['image', IMG_REF + 'Vault/attachments/фото 1.png', 'Закат'],
        ['image', IMG_REF + 'Vault/Папка/схема.jpg', undefined],
        ['p', 'После', undefined],
      ],
    );
  });

  test('![](путь) — относительный, с %20, с корня; внешняя — ссылкой', () => {
    const b = md('![a](схема.jpg) ![b](../attachments/фото%201.png) ![c](https://x.ru/p.png)');
    assert.deepEqual(
      b.map((x) => [x.type, x.src ?? x.text]),
      [
        ['image', IMG_REF + 'Vault/Папка/схема.jpg'],
        ['image', IMG_REF + 'Vault/attachments/фото 1.png'],
        ['p', '[c](https://x.ru/p.png)'],
      ],
    );
    assert.equal(md('![](другое/фото%201.png)', 'Vault/Корень.md')[0].src, IMG_REF + 'Vault/другое/фото 1.png');
  });

  test('картинки нет в хранилище — подпись вместо неё; ![[заметка]] — ссылка', () => {
    assert.deepEqual(
      md('![[нет.png]]\n![[Бюджет#Итог]]').map((x) => [x.type, x.text]),
      [
        ['p', '*[Изображение: нет.png]*'],
        ['p', '[[Бюджет]]'],
      ],
    );
  });
});

describe('хранилище', () => {
  test('корневая папка архива — не папка; подпапки — «A / B»; служебные — пропускаются', () => {
    const notes = parseVault([
      { path: 'Vault/Корень.md', text: 'a' },
      { path: 'Vault/Работа/Проекты/План.md', text: 'b' },
      { path: 'Vault/.obsidian/workspace.md', text: 'x' },
      { path: 'Vault/.trash/Старое.md', text: 'x' },
      { path: '__MACOSX/Vault/._Корень.md', text: 'x' },
      { path: 'Vault/картинка.png', text: '' },
    ]);
    assert.deepEqual(
      notes.map((n) => [n.title, n.folder]),
      [
        ['Корень', undefined],
        ['План', 'Работа / Проекты'],
      ],
    );
  });

  test('общая папка не снимается, если у файлов разные корни; один файл — без папки', () => {
    assert.equal(commonRoot(['a/x.md', 'b/y.md']), '');
    assert.equal(commonRoot(['a/x.md', 'a/b/y.md']), 'a/');
    assert.equal(commonRoot(['x.md']), '');
    assert.equal(parseVault([{ path: 'Заметка.md', text: 'x' }])[0].folder, undefined);
    assert.ok(isSkippedPath('v/.obsidian/app.json') && !isSkippedPath('v/obsidian/a.md'));
  });

  test('даты: из шапки, иначе — время файла', () => {
    const [a, b] = parseVault([
      { path: 'a.md', text: '---\ncreated: 2023-01-01\nupdated: 2023-02-01\n---\nx', date: 99 },
      { path: 'b.md', text: 'y', date: 1700000000000 },
    ]);
    assert.equal(a.createdAt, new Date(2023, 0, 1).getTime());
    assert.equal(a.updatedAt, new Date(2023, 1, 1).getTime());
    assert.equal(b.createdAt, undefined);
    assert.equal(b.updatedAt, 1700000000000);
  });

  test('теги шапки — отдельно, без повторов; пустая заметка — без блоков', () => {
    const n = one('---\ntags: [бег, бег, спорт]\n---\n');
    assert.deepEqual(n.tags, ['бег', 'спорт']);
    assert.deepEqual(n.blocks, []);
  });

  test('экспорт SuperMind → импорт: названия, папки, ссылки, текст — те же', () => {
    const body = (title: string, md: string) => ({ title, blocks: markdownToBlocks(md), updatedAt: 1 });
    const src = [
      { id: '1', title: 'Подушка безопасности', folder: 'Финансы', body: body('Подушка безопасности', '## Сколько\n- шесть месяцев расходов\n- [x] открыть счёт\n\nСм. [[Бюджет: октябрь|бюджет]].'), createdAt: Date.UTC(2024, 0, 5), updatedAt: Date.UTC(2024, 1, 5) },
      { id: '2', title: 'Бюджет: октябрь', body: body('Бюджет: октябрь', 'Доход и **расходы**.\n> 💡 Откладывать 20%'), createdAt: Date.UTC(2024, 0, 6), updatedAt: Date.UTC(2024, 1, 6) },
    ];
    const vault = buildVault(src, { related: new Map([['1', ['2']], ['2', ['1']]]), keywords: new Map([['1', ['подушка']]]) });
    const back = parseVault(vault.filter((f) => f.text !== undefined).map((f) => ({ path: 'SuperMind/' + f.path, text: f.text! })));
    const byTitle = new Map(back.map((n) => [n.title, n]));
    assert.deepEqual([...byTitle.keys()].sort(), ['Бюджет: октябрь', 'Подушка безопасности']);
    const a = byTitle.get('Подушка безопасности')!;
    assert.equal(a.folder, 'Финансы');
    assert.equal(a.createdAt, src[0].createdAt);
    assert.equal(a.updatedAt, src[0].updatedAt);
    assert.deepEqual(
      a.blocks.map((b) => [b.type, b.text, b.checked]),
      src[0].body.blocks.map((b) => [b.type, b.text, b.checked]),
    );
    const b = byTitle.get('Бюджет: октябрь')!;
    assert.deepEqual(
      b.blocks.map((x) => [x.type, x.text]),
      src[1].body.blocks.map((x) => [x.type, x.text]),
    );
  });
});
