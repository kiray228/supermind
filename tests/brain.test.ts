import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';
import type { MindDoc, Topic } from '../src/types.ts';
import type { TaskItem } from '../src/tasks/model.ts';
import type { Goal } from '../src/goals/model.ts';

const { itemId, parseItemId, mapDoc, taskDoc, goalDoc, noteDoc, plainText } = await import('../src/notes/brainDocs.ts');
const { buildIndex, extractFeatures, extractWiki, normTitle, parseWiki, relatedTo, pairKey } = await import('../src/notes/links.ts');
const { stripInline } = await import('../src/notes/model.ts');

let n = 0;
const topic = (text: string, children: Topic[] = [], extra: Partial<Topic> = {}): Topic => ({ id: 't' + n++, text, children, ...extra }) as Topic;
const doc = (title: string, root: Topic, extra: Partial<MindDoc> = {}): MindDoc =>
  ({ id: 'd' + n++, title, sheets: [{ id: 's', title: 'Лист', root, floating: [], relationships: [], boundaries: [], summaries: [], structure: 'map' }], ...extra }) as unknown as MindDoc;
const task = (p: Partial<TaskItem>): TaskItem => ({ id: 'k' + n++, title: '', checklist: [], tags: [], done: false, updatedAt: 1, ...p }) as TaskItem;
const goal = (p: Partial<Goal>): Goal => ({ id: 'g' + n++, title: '', why: '', notes: '', stages: [], status: 'active', updatedAt: 1, ...p }) as unknown as Goal;

describe('id единиц мозга', () => {
  test('у заметок — как есть, у остальных — с приставкой', () => {
    assert.equal(itemId('note', 'abc'), 'abc');
    assert.equal(itemId('map', 'abc'), 'map:abc');
    assert.deepEqual(parseItemId('task:x1'), { kind: 'task', raw: 'x1' });
    assert.deepEqual(parseItemId('goal:a:b'), { kind: 'goal', raw: 'a:b' });
    assert.deepEqual(parseItemId('plain'), { kind: 'note', raw: 'plain' });
    assert.deepEqual(parseItemId('mapx:1'), { kind: 'note', raw: 'mapx:1' }, 'похожая приставка — не тип');
  });
});

describe('текст карты, задачи, цели', () => {
  test('карта: ветви первых уровней — подзаголовки, глубже и заметки к темам — текст', () => {
    const d = doc(
      'Путешествие в Японию',
      topic('Путешествие в Японию', [
        topic('<b>Токио</b>', [topic('Сибуя'), topic('Акихабара', [], { note: '<p>Электроника и аниме</p>' })]),
        topic('Киото', [], { labels: ['храмы', 'сад камней'] }),
      ]),
    );
    const t = mapDoc(d);
    assert.equal(t.title, 'Путешествие в Японию');
    assert.deepEqual(t.headings, ['Токио', 'Киото'], 'корень с названием карты не повторяется, HTML убран');
    assert.ok(t.text.includes('Сибуя') && t.text.includes('Акихабара'));
    assert.ok(t.text.includes('Электроника и аниме') && !t.text.includes('<p>'));
    assert.ok(t.text.includes('храмы, сад камней'));
  });

  test('карта: плавающие темы и несколько листов тоже учитываются', () => {
    const d = doc('Проект', topic('Центр'));
    d.sheets[0].floating = [topic('Риски') as never];
    d.sheets.push({ ...d.sheets[0], id: 's2', root: topic('Второй лист', [topic('Бюджет проекта')]), floating: [] } as never);
    const t = mapDoc(d);
    assert.ok(t.headings!.includes('Риски'));
    assert.ok(t.headings!.includes('Бюджет проекта'));
  });

  test('задача и цель', () => {
    const t = taskDoc(task({ title: 'Подготовить отчёт', notes: 'квартальный отчёт для инвесторов', checklist: [{ id: '1', text: 'графики', done: false }], tags: ['работа'] }));
    assert.equal(t.title, 'Подготовить отчёт');
    assert.ok(t.text.includes('квартальный') && t.text.includes('графики') && t.text.includes('работа'));
    const g = goalDoc(goal({ title: 'Пробежать марафон', why: 'здоровье', notes: 'темп 6:00', stages: [{ id: 's', title: 'База', steps: [{ id: 'x', title: 'бегать 3 раза в неделю' }] }] as never }));
    assert.deepEqual(g.headings, ['База']);
    assert.ok(g.text.includes('здоровье') && g.text.includes('бегать 3 раза'));
  });

  test('пустые и неполные данные не ломают разбор', () => {
    assert.deepEqual(taskDoc(task({ title: 'x', checklist: undefined as never, tags: undefined as never })).text, '');
    assert.deepEqual(goalDoc(goal({ stages: undefined as never })).headings, []);
    assert.equal(mapDoc({ id: 'e', title: 'Пусто', sheets: [] } as unknown as MindDoc).text, '');
    assert.equal(plainText('a<br>b&nbsp;c'), 'a\nb c');
  });

  test('заметка: [[ссылки]] доходят до признаков, а в превью — только подпись', () => {
    const body = { title: 'Бюджет', updatedAt: 1, blocks: [{ id: '1', type: 'p', text: 'Откладываю в [[Подушка безопасности|подушку]], см. [[Брокер]]' }, { id: '2', type: 'code', text: '[[не ссылка]]' }] } as never;
    const d = noteDoc(body);
    const f = extractFeatures(d);
    assert.deepEqual(f.wiki, ['Подушка безопасности', 'Брокер'], 'код не учитывается');
    assert.equal(stripInline('в [[Подушка безопасности|подушку]] и [[Брокер]]'), 'в подушку и Брокер');
  });
});

describe('[[ссылки]]', () => {
  test('разбор, повторы, регистр, «ё»', () => {
    assert.deepEqual(extractWiki('[[Ёлка]] и [[елка]] и [[ ЁЛКА ]] [[Дом|домик]]'), ['Ёлка', 'Дом']);
    assert.deepEqual(parseWiki('Название|подпись'), { title: 'Название', label: 'подпись' });
    assert.deepEqual(parseWiki('  Название  '), { title: 'Название', label: 'Название' });
    assert.deepEqual(parseWiki('Название|'), { title: 'Название', label: 'Название' });
    assert.equal(normTitle('  Ёлка   Новогодняя '), 'елка новогодняя');
  });

  test('пустые, многострочные и вложенные скобки — не ссылки', () => {
    assert.deepEqual(extractWiki('[[]] [[\n]] [[a\nb]] [x] [[в [скобках]]]'), []);
    assert.equal(extractWiki('[[' + 'а'.repeat(150) + ']]').length, 0, 'слишком длинное название');
  });

  test('не больше 100 ссылок из одного текста', () => {
    const text = Array.from({ length: 150 }, (_, i) => `[[Заметка ${i}]]`).join(' ');
    assert.equal(extractWiki(text).length, 100);
  });
});

describe('заметки, карты, задачи и цели в одном индексе', () => {
  const items = [
    { id: 'n1', f: extractFeatures({ title: 'Поездка в Японию', text: 'Билеты до Токио, отель в Киото, рельсовый пропуск JR Pass.' }) },
    { id: 'map:m1', f: extractFeatures(mapDoc(doc('Япония', topic('Япония', [topic('Токио', [topic('Сибуя')]), topic('Киото', [topic('храмы')]), topic('JR Pass')])))) },
    { id: 'task:t1', f: extractFeatures(taskDoc(task({ title: 'Купить JR Pass', notes: 'рельсовый пропуск на 7 дней по Японии' }))) },
    { id: 'goal:g1', f: extractFeatures(goalDoc(goal({ title: 'Выучить японский', why: 'для поездки в Японию', stages: [{ id: 's', title: 'Хирагана', steps: [] }] as never }))) },
    { id: 'n2', f: extractFeatures({ title: 'Рецепт борща', text: 'Свёкла, капуста, картофель, говядина.' }) },
  ];
  const ix = buildIndex(items);

  test('заметка о поездке связана с картой и задачей про ту же поездку', () => {
    const r = relatedTo(ix, 'n1').map((x) => x.id);
    assert.ok(r.includes('map:m1'), r.join(', '));
    assert.ok(r.includes('task:t1'), r.join(', '));
    assert.ok(!r.includes('n2'));
  });

  test('карта связана обратно с заметкой (симметрия)', () => {
    assert.ok(relatedTo(ix, 'map:m1').some((x) => x.id === 'n1'));
  });

  test('явная [[ссылка]] через решение по паре связывает даже без общих слов', () => {
    const ix2 = buildIndex(items, { pairs: new Map([[pairKey('n2', 'goal:g1'), true]]) });
    const r = relatedTo(ix2, 'n2');
    assert.equal(r[0]?.id, 'goal:g1');
    assert.ok(r[0].confirmed);
  });
});
