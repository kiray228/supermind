import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, buildMentionIndex, clusterGraph, clusterTopics, extractFeatures, findMentions, neighborhood, relatedTo, tokenizeSpans, type MentionIndex } from '../src/notes/links.ts';
import { CORPUS } from './fixtures/corpus.ts';

const texts = (t: string, mx: MentionIndex, except?: string) => findMentions(t, mx, except).map((m) => [t.slice(m.start, m.end), m.id]);

describe('разбор с позициями', () => {
  test('позиции указывают на слова исходного текста', () => {
    const t = 'Лететь в «Стамбул», 5 мая!';
    const toks = tokenizeSpans(t);
    for (const k of toks) assert.ok(k.end > k.start && k.end <= t.length);
    const words = toks.filter((k) => k.kind === 'word').map((k) => t.slice(k.start, k.end));
    assert.deepEqual(words, ['Лететь', 'Стамбул', 'мая']);
    assert.ok(toks.some((k) => k.kind === 'stop' && t.slice(k.start, k.end) === 'в'));
    assert.ok(toks.some((k) => k.kind === 'break' && t.slice(k.start, k.end) === '«'));
  });

  test('адреса и почта — не слова', () => {
    const t = 'смотри https://site.ru/стамбул и mail@стамбул.рф';
    assert.deepEqual(
      tokenizeSpans(t)
        .filter((k) => k.kind === 'word')
        .map((k) => t.slice(k.start, k.end)),
      ['смотри'],
    );
  });
});

describe('упоминания названий', () => {
  const mx = buildMentionIndex(
    [
      { id: 'cushion', title: 'Подушка безопасности' },
      { id: 'plan', title: 'План тренировок к полумарафону' },
      { id: 'ist', title: 'Стамбул' },
      { id: 'buy', title: 'Купить' },
      { id: 'ab', title: 'AB' },
      { id: 'react', title: 'React' },
      { id: 'react-hooks', title: 'React хуки' },
    ],
    { isRare: (k) => k !== 'куп' },
  );

  test('любая форма слова', () => {
    assert.deepEqual(texts('Откладываю в подушку безопасности', mx), [['подушку безопасности', 'cushion']]);
    assert.deepEqual(texts('Подушкой Безопасности займусь позже', mx), [['Подушкой Безопасности', 'cushion']]);
    assert.deepEqual(texts('Лечу в Стамбуле гулять', mx), [['Стамбуле', 'ist']]);
  });

  test('служебные слова внутри названия допускаются, знаки препинания — нет', () => {
    assert.deepEqual(texts('Мой план тренировок к полумарафону готов', mx), [['план тренировок к полумарафону', 'plan']]);
    assert.deepEqual(texts('план тренировок, к полумарафону', mx), []);
    assert.deepEqual(texts('подушка. безопасности', mx), []);
  });

  test('короткая основа: «еду в Японию» — не заметка «Еда в Японии»', () => {
    const m2 = buildMentionIndex([{ id: 'food', title: 'Еда в Японии' }]);
    assert.deepEqual(texts('Еду в Японию в мае', m2), []);
    assert.deepEqual(texts('Вспомнил про еда в Японии', m2), [['еда в Японии', 'food']]);
    assert.deepEqual(texts('Еда в японии — отдельная тема', m2), [['Еда в японии', 'food']], 'регистр не важен');
  });

  test('знак внутри названия («Стамбул: маршрут») допустим в тексте, а граница предложения — нет', () => {
    const m2 = buildMentionIndex([{ id: 'route', title: 'Стамбул: маршрут' }]);
    assert.deepEqual(texts('Смотри карту Стамбул: маршрут на завтра', m2), [['Стамбул: маршрут', 'route']]);
    assert.deepEqual(texts('Смотри карту Стамбул — маршрут', m2), [['Стамбул — маршрут', 'route']]);
    assert.deepEqual(texts('Стамбул маршрут', m2), [['Стамбул маршрут', 'route']], 'без знака тоже');
    const m3 = buildMentionIndex([{ id: 'x', title: 'Стамбул маршрут' }]);
    assert.deepEqual(texts('Я в Стамбул. Маршрут потом', m3), [], 'в названии знака нет — точка разрывает');
  });

  test('самое длинное название побеждает, без пересечений', () => {
    assert.deepEqual(texts('Изучаю React хуки и React', mx), [
      ['React хуки', 'react-hooks'],
      ['React', 'react'],
    ]);
  });

  test('частые и короткие однословные названия не подсвечиваются', () => {
    assert.deepEqual(texts('Купить хлеб и купить молоко', mx), []);
    assert.deepEqual(texts('тест AB и ab', mx), []);
  });

  test('своё название не подсвечивается, остальные — да', () => {
    assert.deepEqual(texts('Стамбул и подушка безопасности', mx, 'ist'), [['подушка безопасности', 'cushion']]);
  });

  test('одинаковые названия — первая цель', () => {
    const m2 = buildMentionIndex([
      { id: 'a', title: 'Бюджет семьи' },
      { id: 'b', title: 'бюджет  СЕМЬИ' },
    ]);
    assert.deepEqual(texts('бюджет семьи', m2), [['бюджет семьи', 'a']]);
  });

  test('пустой индекс, пустой текст, слишком длинные названия', () => {
    assert.deepEqual(findMentions('что угодно', buildMentionIndex([])), []);
    assert.deepEqual(findMentions('', mx), []);
    const long = buildMentionIndex([{ id: 'l', title: 'один два три четыре пять шесть семь восемь' }]);
    assert.equal(long.first.size, 0);
  });

  test('много названий и длинный текст — быстро', () => {
    const titles = Array.from({ length: 2000 }, (_, i) => ({ id: 'n' + i, title: `Проект ${['альфа', 'бета', 'гамма', 'дельта'][i % 4]} номер${i}` }));
    const big = buildMentionIndex(titles);
    const text = 'Сегодня обсудили проект дельта номер7 и проект дельта номер1999. '.repeat(400);
    const t0 = performance.now();
    const found = findMentions(text, big);
    const ms = performance.now() - t0;
    assert.equal(found.length, 800);
    assert.ok(ms < 300, `${ms} мс`);
  });
});

describe('темы (кластеры)', () => {
  const ix = buildIndex(CORPUS.map((f) => ({ id: f.id, f: extractFeatures(f) })));
  const edges: { a: string; b: string; score: number }[] = [];
  for (const f of CORPUS)
    for (const r of relatedTo(ix, f.id)) if (f.id < r.id) edges.push({ a: f.id, b: r.id, score: r.score });
  const topicOf = new Map(CORPUS.map((f) => [f.id, f.topic]));
  const cl = clusterGraph(
    CORPUS.map((f) => f.id),
    edges,
  );

  test('заметки одной темы — в одном кластере, разных — в разных', () => {
    const byTopic = new Map<string, Set<number>>();
    for (const [id, c] of cl) {
      const t = topicOf.get(id)!;
      if (!byTopic.has(t)) byTopic.set(t, new Set());
      byTopic.get(t)!.add(c);
    }
    for (const t of ['running', 'trip', 'habits']) assert.equal(byTopic.get(t)!.size, 1, t);
    const runC = [...byTopic.get('running')!][0];
    const tripC = [...byTopic.get('trip')!][0];
    assert.notEqual(runC, tripC);
  });

  test('номера: большие кластеры — первыми, одиночки — отдельно', () => {
    const size = new Map<number, number>();
    for (const c of cl.values()) size.set(c, (size.get(c) ?? 0) + 1);
    const ordered = [...size.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i - 1] >= ordered[i], ordered.join(','));
    assert.equal(size.get(cl.get('solo-shop')!), 1);
  });

  test('детерминированно: тот же вход — те же кластеры, порядок id не важен', () => {
    const again = clusterGraph([...CORPUS.map((f) => f.id)].reverse(), [...edges].reverse());
    assert.deepEqual([...again.entries()].sort(), [...cl.entries()].sort());
  });

  test('название темы — по её словам', () => {
    const names = clusterTopics(ix, cl);
    const run = names.get(cl.get('run-plan')!)!;
    assert.ok(['пробежка', 'длинная пробежка', 'тренировка', 'бег', 'пульс', 'лёгком'].some((w) => run.includes(w.slice(0, 5))), run);
    const trip = names.get(cl.get('trip-plan')!)!;
    assert.ok(/стамбул|поездк|билет|самол/i.test(trip), trip);
    if (/стамбул/i.test(trip)) assert.equal(trip, 'Стамбул', 'имя собственное — с заглавной');
  });

  test('пустой граф и граф без связей', () => {
    assert.equal(clusterGraph([], []).size, 0);
    const solo = clusterGraph(['a', 'b'], []);
    assert.notEqual(solo.get('a'), solo.get('b'));
    assert.equal(clusterGraph(['a', 'a'], []).size, 1, 'повтор id');
  });
});

describe('окрестность', () => {
  const edges = [
    { a: 'a', b: 'b' },
    { a: 'b', b: 'c' },
    { a: 'c', b: 'd' },
    { a: 'x', b: 'y' },
  ];
  test('на 1 и 2 шага', () => {
    assert.deepEqual([...neighborhood(edges, 'b', 1)].sort(), ['a', 'b', 'c']);
    assert.deepEqual([...neighborhood(edges, 'a', 2)].sort(), ['a', 'b', 'c']);
    assert.deepEqual([...neighborhood(edges, 'a', 0)], ['a']);
  });
  test('несвязанная часть не попадает, неизвестный узел — только он сам', () => {
    assert.ok(!neighborhood(edges, 'a', 5).has('x'));
    assert.deepEqual([...neighborhood(edges, 'zzz', 2)], ['zzz']);
  });
  test('циклы не зацикливают', () => {
    const ring = [
      { a: '1', b: '2' },
      { a: '2', b: '3' },
      { a: '3', b: '1' },
    ];
    assert.equal(neighborhood(ring, '1', 10).size, 3);
  });
});
