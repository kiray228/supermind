import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';
import { CORPUS } from './fixtures/corpus.ts';

const { bestPassages, buildIndex, extractFeatures, queryTerms, searchIndex, termKey } = await import('../src/notes/links.ts');
const { buildAskMessages, citedSources, parseExpansion, splitCitations, ASK_SYSTEM } = await import('../src/notes/askPrompt.ts');

const ix = buildIndex(CORPUS.map((f) => ({ id: f.id, f: extractFeatures(f) })));
const top = (q: string, extra?: string[]) => searchIndex(ix, q, { limit: 3, extra }).map((h) => h.id);

describe('поиск по записям', () => {
  test('вопрос своими словами находит нужную заметку первой', () => {
    assert.equal(top('Сколько откладывать в подушку безопасности?')[0], 'fin-cushion');
    assert.equal(top('Как подготовиться к полумарафону?')[0], 'run-plan');
    assert.equal(top('какие хуки в React и зачем useEffect')[0], 'dev-hooks');
    assert.ok(['trip-food', 'trip-plan'].includes(top('что поесть в Стамбуле')[0]));
    assert.equal(top('какую комиссию берёт брокер')[0], 'fin-broker');
  });

  test('запись про все слова вопроса выше записи про одно', () => {
    // «пульс» есть в плане и дневнике, а в заметке о кроссовках — нет
    const r = searchIndex(ix, 'длинная пробежка и пульс');
    assert.ok(['run-plan', 'run-log'].includes(r[0].id), r.map((h) => h.id).join(', '));
    const shoes = r.findIndex((h) => h.id === 'run-shoes');
    assert.ok(shoes === -1 || shoes > r.findIndex((h) => h.id === 'run-plan'), r.map((h) => h.id).join(', '));
    for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  });

  test('найденные слова — в форме записи', () => {
    const h = searchIndex(ix, 'стамбул')[0];
    assert.ok(h.terms.some((t) => /Стамбул/.test(t)), h.terms.join(', '));
  });

  test('слово из одной-единственной записи тоже находится (самое точное)', () => {
    assert.deepEqual(top('амортизация'), ['run-shoes']);
  });

  test('синонимы от ИИ помогают найти запись, где нет слов вопроса', () => {
    const plain = searchIndex(ix, 'спорт');
    assert.equal(plain.length, 0, 'слова «спорт» нет ни в одной заметке');
    const withSyn = searchIndex(ix, 'спорт', { extra: ['пробежка', 'тренировка', 'бег'] });
    assert.ok(withSyn.length >= 3);
    assert.ok(withSyn.every((h) => h.id.startsWith('run-')), withSyn.map((h) => h.id).join(', '));
  });

  test('пустой вопрос и вопрос из служебных слов — ничего', () => {
    assert.deepEqual(searchIndex(ix, ''), []);
    assert.deepEqual(searchIndex(ix, 'а что это было и как'), []);
  });

  test('лимит соблюдается, счёт — от 0 до 1', () => {
    const r = searchIndex(ix, 'бюджет расходы деньги пробежка Стамбул', { limit: 4 });
    assert.ok(r.length <= 4);
    for (const h of r) assert.ok(h.score > 0 && h.score <= 1);
  });

  test('ключи вопроса: синонимы весят меньше слов вопроса', () => {
    const q = queryTerms(ix, 'бег', ['пробежка']);
    assert.ok(q.get(termKey('бег')!)! > q.get(termKey('пробежка')!)!);
  });
});

describe('выбор абзацев', () => {
  const keys = [termKey('подушка')!, termKey('безопасности')!];
  const long = ['Вступление о финансах и планах на год.', 'Про отпуск и билеты.', 'Подушка безопасности — шесть месяцев расходов.', 'Рецепт пирога.', 'Ещё раз про подушку безопасности: держать на счёте.'].join('\n');

  test('короткий текст — целиком', () => {
    assert.equal(bestPassages('коротко', keys, 1000), 'коротко');
  });

  test('длинный — первый абзац и абзацы со словами вопроса, в исходном порядке, пропуски — «…»', () => {
    const p = bestPassages(long, keys, 140);
    const lines = p.split('\n');
    assert.equal(lines[0], 'Вступление о финансах и планах на год.');
    assert.ok(p.includes('Подушка безопасности — шесть'));
    assert.ok(!p.includes('Рецепт пирога'));
    assert.ok(lines.includes('…'));
    assert.ok(p.length <= 160, String(p.length));
  });

  test('ни одного совпадения — только начало', () => {
    const p = bestPassages(long, ['zzz'], 60);
    assert.ok(p.startsWith('Вступление'));
    assert.ok(!p.includes('Подушка'));
  });
});

describe('запрос к ИИ и ссылки на источники', () => {
  const sources = [
    { n: 1, id: 'a', kind: 'Заметка', title: 'Бюджет на октябрь', date: '1 октября 2026 г.', text: 'Откладываю 20% дохода.' },
    { n: 2, id: 'map:m', kind: 'Карта', title: 'Финансы', text: 'Подушка безопасности, брокер.' },
  ];

  test('источники пронумерованы, с типом, датой и текстом; вопрос — в конце', () => {
    const m = buildAskMessages('Сколько я откладываю?', sources);
    assert.equal(m.length, 1);
    const c = m[0].content;
    assert.ok(c.includes('[1] Заметка «Бюджет на октябрь» (1 октября 2026 г.)\nОткладываю 20% дохода.'));
    assert.ok(c.includes('[2] Карта «Финансы»'));
    assert.ok(c.trimEnd().endsWith('Вопрос: Сколько я откладываю?'));
    assert.ok(ASK_SYSTEM.includes('ТОЛЬКО по источникам'));
  });

  test('история беседы — до трёх последних вопросов, длинные ответы обрезаны', () => {
    const hist = Array.from({ length: 5 }, (_, i) => ({ q: 'вопрос ' + i, a: 'ответ ' + i + ' ' + 'x'.repeat(3000) }));
    const m = buildAskMessages('новый', sources, hist);
    assert.equal(m.length, 7);
    assert.equal(m[0].content, 'вопрос 2');
    assert.ok(m[1].content.length <= 1500);
    assert.equal(m[1].role, 'assistant');
  });

  test('ссылки [1], [1, 2], [1][2], [1–2]; номера вне списка — обычный текст', () => {
    const parts = splitCitations('Да [1]. Ещё [1, 2][2] и [7] и [1–2].', 2);
    assert.deepEqual(parts, [
      { t: 'text', s: 'Да ' },
      { t: 'cite', n: [1] },
      { t: 'text', s: '. Ещё ' },
      { t: 'cite', n: [1, 2] },
      { t: 'text', s: ' и [7] и ' },
      { t: 'cite', n: [1, 2] },
      { t: 'text', s: '.' },
    ]);
    assert.deepEqual(citedSources('А [2] и [2] и [1]', 2), [1, 2]);
    assert.deepEqual(splitCitations('без ссылок', 3), [{ t: 'text', s: 'без ссылок' }]);
    assert.deepEqual(splitCitations('[0] [x]', 3), [{ t: 'text', s: '[0] [x]' }]);
  });

  test('синонимы от ИИ: список, нумерация, кавычки, мусор', () => {
    assert.deepEqual(parseExpansion('бег, пробежка; «марафон»\n1. тренировки\n- длинная пробежка'), ['бег', 'пробежка', 'марафон', 'тренировки', 'длинная пробежка']);
    assert.deepEqual(parseExpansion('бег, Бег, слишком длинное выражение из многих слов подряд'), ['бег']);
    assert.equal(parseExpansion(Array.from({ length: 20 }, (_, i) => 'слово' + i).join(', ')).length, 12);
    assert.deepEqual(parseExpansion(''), []);
  });
});
