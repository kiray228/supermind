import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';
import { CORPUS } from './fixtures/corpus.ts';
import type { NoteBody } from '../src/notes/model.ts';

const { titleMentions, hasWikiTo, linkOccurrence, snippetAround, retargetWiki, mergeBodies } = await import('../src/notes/backlinks.ts');
const { buildIndex, extractFeatures, duplicatesOf, findDuplicates, DUP_SCORE } = await import('../src/notes/links.ts');

const T = 'Подушка безопасности';
const at = (text: string) => titleMentions(text, T).map((o) => text.slice(o.start, o.end));

describe('упоминания названия', () => {
  test('любая форма, несколько мест', () => {
    assert.deepEqual(at('Пополняю подушку безопасности. Подушка безопасности — шесть месяцев.'), ['подушку безопасности', 'Подушка безопасности']);
  });

  test('внутри [[ссылки]], [текст](адрес) и `кода` — не считаются', () => {
    assert.deepEqual(at('[[Подушка безопасности]] и [[Подушка безопасности|подушку]] и [подушка безопасности](https://x.ru) и `подушка безопасности`'), []);
    assert.deepEqual(at('см. [[Бюджет]], а подушка безопасности — отдельно'), ['подушка безопасности']);
  });

  test('пустой текст или название', () => {
    assert.deepEqual(titleMentions('', T), []);
    assert.deepEqual(titleMentions('текст', '  '), []);
  });

  test('явная [[ссылка]]: регистр, «ё», подпись', () => {
    assert.ok(hasWikiTo('см [[подушка БЕЗОПАСНОСТИ|подушку]]', T));
    assert.ok(hasWikiTo('[[Ёлка]]', 'елка'));
    assert.ok(!hasWikiTo('подушка безопасности', T));
  });
});

describe('«Сделать ссылкой»', () => {
  test('другая форма — ссылка с подписью, та же — простая', () => {
    const t = 'Пополняю подушку безопасности каждый месяц';
    const [o] = titleMentions(t, T);
    assert.equal(linkOccurrence(t, o, T), 'Пополняю [[Подушка безопасности|подушку безопасности]] каждый месяц');
    const t2 = 'Моя подушка безопасности';
    assert.equal(linkOccurrence(t2, titleMentions(t2, T)[0], T), 'Моя [[Подушка безопасности]]');
  });

  test('после замены упоминаний без ссылки не остаётся', () => {
    let t = 'Подушка безопасности. И снова подушку безопасности.';
    for (let i = 0; i < 5; i++) {
      const o = titleMentions(t, T)[0];
      if (!o) break;
      t = linkOccurrence(t, o, T);
    }
    assert.deepEqual(titleMentions(t, T), []);
    assert.equal((t.match(/\[\[/g) ?? []).length, 2);
  });

  test('фрагмент вокруг упоминания: не режет слова, отмечает обрезку', () => {
    const t = 'Начало длинной заметки про планы, потом пополняю подушку безопасности каждый месяц и откладываю остаток на брокерский счёт для инвестиций.';
    const [o] = titleMentions(t, T);
    const s = snippetAround(t, o, 25);
    assert.equal(s.match, 'подушку безопасности');
    assert.ok(s.before.startsWith('…'));
    assert.ok(s.after.endsWith('…'));
    assert.ok(!/^…\S{1,2}\s/.test(s.before), s.before);
    const short = snippetAround('подушка безопасности', { start: 0, end: 20 });
    assert.deepEqual(short, { before: '', match: 'подушка безопасности', after: '' });
  });
});

describe('объединение заметок', () => {
  const body = (title: string, texts: [string, string][]): NoteBody => ({ title, updatedAt: 1, blocks: texts.map(([type, text], i) => ({ id: title + i, type, text })) }) as NoteBody;

  test('текст второй — в конце, под разделителем и её названием; id новые', () => {
    const a = body('Бюджет', [['p', 'Доход и расходы']]);
    const b = body('Бюджет октябрь', [['p', 'Аренда'], ['todo', 'Сократить кафе']]);
    const m = mergeBodies(a, b);
    assert.deepEqual(
      m.blocks.map((x) => [x.type, x.text ?? '']),
      [
        ['p', 'Доход и расходы'],
        ['divider', ''],
        ['h2', 'Бюджет октябрь'],
        ['p', 'Аренда'],
        ['todo', 'Сократить кафе'],
      ],
    );
    assert.ok(m.blocks.slice(1).every((x) => !x.id.startsWith('Бюджет октябрь')));
    assert.equal(m.title, 'Бюджет');
  });

  test('пустая заметка: без разделителя; одинаковые названия — без повтора', () => {
    const empty = body('Бюджет', [['p', '']]);
    const b = body('бюджет', [['p', 'Аренда']]);
    assert.deepEqual(
      mergeBodies(empty, b).blocks.map((x) => x.type),
      ['p'],
    );
    assert.equal(mergeBodies(empty, b).blocks[0].text, 'Аренда');
  });

  test('слить пустую в пустую — остаётся пустой абзац', () => {
    const e = body('', [['p', '']]);
    assert.equal(mergeBodies(e, body('', [['p', '']])).blocks.length, 1);
  });

  test('ссылки на старое название ведут на новое, подписи сохраняются', () => {
    assert.equal(retargetWiki('см [[Бюджет октябрь]] и [[бюджет ОКТЯБРЬ|план]] и [[Другое]]', 'Бюджет октябрь', 'Бюджет'), 'см [[Бюджет|Бюджет октябрь]] и [[Бюджет|план]] и [[Другое]]');
    assert.equal(retargetWiki('[[Старое|Новое]]', 'Старое', 'Новое'), '[[Новое]]');
  });
});

describe('дубли', () => {
  const budget = CORPUS.find((f) => f.id === 'fin-budget')!;
  const items = [
    ...CORPUS,
    { id: 'copy', title: 'Бюджет октябрь', text: budget.text.replace('кафе', 'ресторанах').replace('450 000', '460 000') },
    { id: 'exact', title: budget.title, text: budget.text },
  ];
  const ix = buildIndex(items.map((f) => ({ id: f.id, f: extractFeatures(f) })));

  test('почти одинаковые заметки — дубли, со счётом', () => {
    const d = duplicatesOf(ix, 'fin-budget');
    assert.deepEqual(d.map((x) => x.id).sort(), ['copy', 'exact']);
    assert.ok(d.every((x) => x.score >= DUP_SCORE && x.score <= 1));
  });

  test('разные заметки на одну тему — не дубли', () => {
    for (const f of CORPUS) {
      if (f.id === 'fin-budget') continue;
      assert.deepEqual(duplicatesOf(ix, f.id), [], f.id);
    }
  });

  test('пустая заметка (одно название) — не дубль заметки, где это название упомянуто', () => {
    const ix2 = buildIndex(
      [
        { id: 'empty', title: 'Чек-лист перелёта', text: '' },
        { id: 'empty2', title: 'Чек-лист перелёта', text: '' },
        { id: 'links', title: 'Сборы', text: 'Паспорт и страховка — см. [[Чек-лист перелёта]].' },
      ].map((f) => ({ id: f.id, f: extractFeatures(f) })),
    );
    assert.deepEqual(findDuplicates(ix2, ['empty', 'empty2', 'links']), []);
  });

  test('короткая заметка внутри длинной — не дубль (объёмы несопоставимы)', () => {
    const long = budget.text + ' ' + CORPUS.find((f) => f.id === 'fin-cushion')!.text + ' ' + CORPUS.find((f) => f.id === 'fin-broker')!.text;
    const ix3 = buildIndex([...CORPUS, { id: 'big', title: 'Все финансы', text: long }].map((f) => ({ id: f.id, f: extractFeatures(f) })));
    assert.ok(!duplicatesOf(ix3, 'big').some((d) => d.id === 'fin-budget'));
  });

  test('все пары — по одному разу, только среди переданных', () => {
    const all = findDuplicates(ix, items.map((f) => f.id));
    assert.equal(all.length, 3, JSON.stringify(all));
    const keys = all.map((p) => p.a + '|' + p.b);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(all.every((p) => p.a < p.b));
    assert.deepEqual(findDuplicates(ix, ['fin-budget', 'run-plan']), []);
    assert.deepEqual(duplicatesOf(ix, 'нет-такой'), []);
  });
});
