import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';
import type { NoteBody } from '../src/notes/model.ts';

const { buildVault, obsidianTag, dataUrlImage } = await import('../src/notes/obsidian.ts');

const body = (blocks: { type: string; text?: string; src?: string; caption?: string; checked?: boolean }[], title = ''): NoteBody => ({ title, updatedAt: 1, blocks: blocks.map((b, i) => ({ id: 'b' + i, ...b })) }) as NoteBody;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('экспорт для Obsidian', () => {
  const notes = [
    { id: 'n1', title: 'Бюджет на октябрь', folder: 'Финансы', body: body([{ type: 'p', text: 'Откладываю в [[Подушка безопасности|подушку]]. См. [[Нет такой]].' }, { type: 'todo', text: 'Сократить кафе', checked: true }]), createdAt: Date.UTC(2026, 9, 1), updatedAt: Date.UTC(2026, 9, 2) },
    { id: 'n2', title: 'Подушка безопасности', folder: 'Финансы', body: body([{ type: 'h2', text: 'Сумма' }, { type: 'p', text: '6 месяцев расходов' }]), createdAt: 0, updatedAt: 0 },
    { id: 'n3', title: 'Что: лучше? <план>/#идея', body: body([{ type: 'image', src: PNG, caption: 'схема' }, { type: 'image', src: 'https://x/y.png' }]), createdAt: 0, updatedAt: 0 },
    { id: 'n4', title: 'Подушка безопасности', body: body([{ type: 'p', text: 'дубль названия' }]), createdAt: 0, updatedAt: 0 },
    { id: 'n5', title: '', body: body([{ type: 'p', text: 'без названия' }]), createdAt: 0, updatedAt: 0 },
  ];
  const files = buildVault(notes, {
    related: new Map([
      ['n1', ['n2', 'n3', 'missing', 'n1']],
      ['n2', ['n1']],
    ]),
    keywords: new Map([['n1', ['бюджет', 'подушка безопасности', '!!!', 'Расходы']]]),
  });
  const file = (p: string) => files.find((f) => f.path === p);

  test('файлы по папкам, запрещённые знаки убраны, имена без повторов', () => {
    const paths = files.map((f) => f.path).sort();
    assert.ok(paths.includes('Финансы/Бюджет на октябрь.md'), paths.join('\n'));
    assert.ok(paths.includes('Финансы/Подушка безопасности.md'));
    assert.ok(paths.includes('Подушка безопасности (2).md'), 'одинаковое название — второе с номером');
    assert.ok(paths.includes('Без названия.md'));
    const odd = paths.find((p) => p.startsWith('Что'))!;
    assert.ok(!/[:?<>#[\]]/.test(odd), odd);
  });

  test('заголовок YAML: название, даты, теги из тем', () => {
    const t = file('Финансы/Бюджет на октябрь.md')!.text!;
    assert.ok(t.startsWith('---\ntitle: "Бюджет на октябрь"\ncreated: 2026-10-01T'), t.slice(0, 120));
    assert.ok(t.includes('tags:\n  - бюджет\n  - подушка-безопасности\n  - расходы\n---'), t);
    const n2 = file('Финансы/Подушка безопасности.md')!.text!;
    assert.ok(!n2.includes('created:'), 'нет даты — нет поля');
  });

  test('кавычки в названии экранируются', () => {
    const f = buildVault([{ id: 'q', title: 'Цитата "в кавычках" \\ слэш', body: body([]), createdAt: 0, updatedAt: 0 }]);
    assert.ok(f[0].text!.includes('title: "Цитата \\"в кавычках\\" \\\\ слэш"'), f[0].text);
  });

  test('[[ссылки]] ведут на файлы, несуществующие остаются как есть', () => {
    const t = file('Финансы/Бюджет на октябрь.md')!.text!;
    assert.ok(t.includes('[[Подушка безопасности|подушку]]'), t);
    assert.ok(t.includes('[[Нет такой]]'));
    assert.ok(t.includes('- [x] Сократить кафе'));
  });

  test('«Связанные заметки» — только существующие и не сама заметка', () => {
    const t = file('Финансы/Бюджет на октябрь.md')!.text!;
    const sec = t.slice(t.indexOf('## Связанные заметки'));
    assert.ok(sec.includes('- [[Подушка безопасности]]'));
    assert.ok(/- \[\[Что[^\]]*\|Что: лучше\? <план>\/#идея\]\]/.test(sec), sec);
    assert.ok(!sec.includes('missing') && !sec.includes('Бюджет на октябрь]]'));
    assert.ok(!file('Без названия.md')!.text!.includes('## Связанные'), 'без связей — без раздела');
  });

  test('картинки — отдельными файлами, внешние — подписью', () => {
    const name = notes[2].title;
    const att = files.filter((f) => f.path.startsWith('attachments/'));
    assert.equal(att.length, 1);
    assert.ok(att[0].path.endsWith(' 1.png'));
    assert.equal(att[0].base64, 'iVBORw0KGgo=');
    const md = files.find((f) => f.path.startsWith('Что') && f.path.endsWith('.md'))!.text!;
    assert.ok(md.includes('![[' + att[0].path + ']]'), md);
    assert.ok(md.includes('*схема*'));
    assert.ok(md.includes('*[Изображение]*'));
    assert.ok(name);
  });

  test('теги и картинки: крайние случаи', () => {
    assert.equal(obsidianTag('Подушка безопасности'), 'подушка-безопасности');
    assert.equal(obsidianTag('!!!'), null);
    assert.equal(obsidianTag('2026'), null, 'тег из одних цифр Obsidian не принимает');
    assert.equal(obsidianTag('C++ и Go'), 'c-и-go');
    assert.deepEqual(dataUrlImage('data:image/jpeg;base64,AAA'), { ext: 'jpg', base64: 'AAA' });
    assert.equal(dataUrlImage('data:application/pdf;base64,AAA'), null);
    assert.equal(dataUrlImage('https://x.png'), null);
  });

  test('пустое хранилище', () => {
    assert.deepEqual(buildVault([]), []);
  });
});
