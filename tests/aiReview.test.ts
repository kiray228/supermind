import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyTermReview, buildIndex, edgesOf, extractFeatures, keywordTerms, keywordsOf, type LinkIndex, pairKey, relatedTo, termKey } from '../src/notes/links.ts';
import { buildReviewPrompt, parseReview, type ReviewInput } from '../src/notes/aiReviewPrompt.ts';
import { CORPUS } from './fixtures/corpus.ts';

const feats = new Map(CORPUS.map((f) => [f.id, extractFeatures(f)]));
const index = (opts: { pairs?: Map<string, boolean>; edit?: Record<string, { drop: string[]; add: string[] }> } = {}): LinkIndex =>
  buildIndex(
    CORPUS.map((f) => {
      const e = opts.edit?.[f.id];
      return { id: f.id, f: e ? applyTermReview(feats.get(f.id)!, e.drop, e.add) : feats.get(f.id)! };
    }),
    { pairs: opts.pairs },
  );
const ids = (ix: LinkIndex, id: string) => relatedTo(ix, id).map((r) => r.id);

describe('решения по парам', () => {
  test('ключ пары не зависит от порядка', () => {
    assert.equal(pairKey('b', 'a'), pairKey('a', 'b'));
    assert.equal(pairKey('a', 'b'), 'a|b');
  });

  test('отклонённая связь скрыта с обеих сторон — и в панели, и на графе', () => {
    const base = index();
    assert.ok(ids(base, 'fin-budget').includes('fin-broker'));
    const ix = index({ pairs: new Map([[pairKey('fin-budget', 'fin-broker'), false]]) });
    assert.ok(!ids(ix, 'fin-budget').includes('fin-broker'));
    assert.ok(!ids(ix, 'fin-broker').includes('fin-budget'));
    assert.ok(!edgesOf(ix, 'fin-budget').some((e) => e.a === 'fin-broker' || e.b === 'fin-broker'));
    // без решений (повторная проверка) — снова видна
    assert.ok(relatedTo(ix, 'fin-budget', { raw: true }).some((r) => r.id === 'fin-broker'));
  });

  test('подтверждённая связь видна, даже если алгоритм её не нашёл', () => {
    const base = index();
    assert.ok(!ids(base, 'fin-etf').includes('fin-cushion'));
    const ix = index({ pairs: new Map([[pairKey('fin-cushion', 'fin-etf'), true]]) });
    const r = relatedTo(ix, 'fin-etf').find((x) => x.id === 'fin-cushion');
    assert.ok(r, 'связь появилась');
    assert.ok(r.confirmed);
    assert.ok(relatedTo(ix, 'fin-cushion').some((x) => x.id === 'fin-etf' && x.confirmed), 'и с другой стороны');
    assert.ok(edgesOf(ix, 'fin-etf').some((e) => e.confirmed));
  });

  test('подтверждение уже найденной связи только помечает её', () => {
    const ix = index({ pairs: new Map([[pairKey('run-plan', 'run-log'), true]]) });
    const r = relatedTo(ix, 'run-plan');
    assert.equal(r[0].id, 'run-log');
    assert.ok(r[0].confirmed);
    assert.ok(!r.find((x) => x.id === 'run-shoes')?.confirmed);
  });

  test('кандидаты для ИИ — и пары с одним общим словом, которые алгоритм не показывает', () => {
    const ix = index();
    // портфель и подушка безопасности связаны по смыслу, но общее слово у них одно — «сумма»
    const strict = relatedTo(ix, 'fin-etf', { raw: true, min: 0.015 }).map((r) => r.id);
    const loose = relatedTo(ix, 'fin-etf', { raw: true, loose: true, min: 0.015 }).map((r) => r.id);
    assert.ok(!strict.includes('fin-cushion'));
    assert.ok(loose.includes('fin-cushion'));
    for (const id of strict) assert.ok(loose.includes(id));
    assert.ok(!ids(ix, 'fin-etf').includes('fin-cushion'), 'в панели слабая пара не показывается');
  });

  test('решения про отсутствующие заметки игнорируются', () => {
    const ix = index({ pairs: new Map([[pairKey('fin-etf', 'нет-такой'), true], ['кривой-ключ', false]]) });
    assert.deepEqual(ids(ix, 'fin-etf'), ids(index(), 'fin-etf'));
  });
});

describe('правка важных слов', () => {
  test('убранное слово исчезает вместе со словосочетаниями', () => {
    const f = extractFeatures({ title: 'Бюджет', text: 'Надо собрать подушку безопасности. Собрать и сократить расходы.' });
    const k = termKey('собрать')!;
    assert.ok(f.terms[k]);
    const g = applyTermReview(f, [k], []);
    assert.ok(!g.terms[k]);
    assert.ok(!Object.keys(g.terms).some((t) => t.split(' ').includes(k)));
    assert.ok(g.terms[termKey('подушку')!], 'остальное на месте');
    assert.ok(f.terms[k], 'исходные признаки не изменились');
  });

  test('добавленная тема становится весомой и находит связь', () => {
    // «накопительный счёт» в двух заметках, но алгоритм не связал их — ИИ добавил тему в обе
    const a = extractFeatures({ title: 'Подушка', text: 'Откладываю на накопительный счёт каждый месяц, мелочь, кофе, кино.' });
    const b = extractFeatures({ title: 'Банки', text: 'Сравнить ставки: накопительный счёт в разных банках, условия снятия.' });
    const g = applyTermReview(a, [], ['накопительный счёт']);
    const key = termKey('накопительный')! + ' ' + termKey('счёт')!;
    assert.ok(g.terms[key] > (a.terms[key] ?? 0));
    assert.equal(g.forms[key], 'накопительный счёт');
    const before = buildIndex([{ id: 'a', f: a }, { id: 'b', f: b }]);
    const after = buildIndex([
      { id: 'a', f: g },
      { id: 'b', f: applyTermReview(b, [], ['накопительный счёт']) },
    ]);
    const s0 = relatedTo(before, 'a', { min: 0 }).find((r) => r.id === 'b')?.score ?? 0;
    const s1 = relatedTo(after, 'a', { min: 0 }).find((r) => r.id === 'b')?.score ?? 0;
    assert.ok(s1 > s0, `${s1} > ${s0}`);
  });

  test('ключевые слова после правки — без убранных', () => {
    const k = keywordTerms(index(), feats.get('fin-etf')!, 10);
    const drop = k.filter((x) => x.form === 'крупными').flatMap((x) => x.raw);
    assert.equal(drop.length, 1, k.map((x) => x.form).join(', '));
    assert.ok(keywordsOf(index(), 'fin-etf', 10).includes('крупными'));
    const ix = index({ edit: { 'fin-etf': { drop, add: [] } } });
    assert.ok(!keywordsOf(ix, 'fin-etf', 10).includes('крупными'));
  });

  test('формы с беглой гласной — одно ключевое слово, убираются все его формы', () => {
    const a = extractFeatures({ title: 'Спорт', text: 'Тренировка утром. Пять тренировок за неделю, растяжка после тренировок.' });
    const ix = buildIndex([
      { id: 'a', f: a },
      { id: 'b', f: extractFeatures({ title: 'Зал', text: 'Тренировка ног: приседания и выпады.' }) },
    ]);
    const tr = keywordTerms(ix, a, 10).find((x) => x.key === termKey('тренировка'));
    assert.ok(tr);
    assert.deepEqual(tr.raw.sort(), [termKey('тренировка')!, termKey('тренировок')!].sort());
    const g = applyTermReview(a, tr.raw, []);
    assert.ok(!g.terms[termKey('тренировка')!] && !g.terms[termKey('тренировок')!]);
  });

  test('словосочетание из названия не теряется среди ключевых слов', () => {
    assert.ok(keywordsOf(index(), 'run-plan').includes('план тренировок'));
  });

  test('ключевые слова для ИИ совпадают с теми, что видит человек', () => {
    const ix = index();
    for (const id of ['run-plan', 'trip-plan', 'fin-budget']) assert.deepEqual(keywordTerms(ix, feats.get(id)!, 6).map((k) => k.form), keywordsOf(ix, id, 6), id);
  });
});

const INPUT: ReviewInput = {
  title: 'Бюджет на октябрь',
  text: 'Доход: зарплата. Откладываю на подушку безопасности и брокерский счёт. Решил сократить доставку еды.',
  keywords: [
    { key: 'бюджет', form: 'бюджет' },
    { key: 'решил', form: 'решил' },
    { key: 'доход', form: 'доход' },
    { key: 'половин', form: 'половину' },
  ],
  candidates: [
    { id: 'c1', title: 'Подушка безопасности', preview: 'Финансовая подушка — 6 месячных расходов', keywords: ['подушка безопасности'], shared: ['подушку безопасности'], linked: true },
    { id: 'c2', title: 'Деплой приложения', preview: 'Сборка через Vite', keywords: ['деплой'], shared: ['приложения'], linked: true },
    { id: 'c3', title: 'Как выбрать брокера', preview: 'Комиссия, ИИС', keywords: ['брокер'], shared: [], linked: false },
  ],
};

describe('запрос к ИИ', () => {
  test('в запросе — текст, пронумерованные слова и кандидаты с общими словами', () => {
    const p = buildReviewPrompt(INPUT);
    assert.ok(p.includes('Заметка «Бюджет на октябрь»'));
    assert.ok(p.includes('2. решил'));
    assert.ok(p.includes('1. «Подушка безопасности»'));
    assert.ok(p.includes('общие слова: подушку безопасности'));
    assert.ok(p.includes('сейчас не связаны'));
    assert.ok(p.includes('общих слов мало'));
  });

  test('длинная заметка обрезается', () => {
    const p = buildReviewPrompt({ ...INPUT, text: 'слово '.repeat(5000) });
    assert.ok(p.length < 7000, String(p.length));
  });
});

describe('разбор ответа ИИ', () => {
  const ok = JSON.stringify({
    keywords: [
      { n: 1, keep: true },
      { n: 2, keep: false },
      { n: 3, keep: true },
      { n: 4, keep: false },
    ],
    missing: ['брокерский счёт', 'доставку еды', 'криптовалюта'],
    links: [
      { n: 1, ok: true, why: 'Подушка — часть бюджета' },
      { n: 2, ok: false, why: 'Случайное слово «приложение»' },
      { n: 3, ok: true, why: 'Брокер — куда идут сбережения' },
    ],
  });

  test('обычный ответ', () => {
    const r = parseReview(ok, INPUT)!;
    assert.deepEqual(r.drop, ['решил', 'половин']);
    assert.deepEqual(r.add, ['брокерский счёт', 'доставку еды'], 'выдуманная «криптовалюта» отброшена — её нет в тексте');
    assert.deepEqual(
      r.links.map((l) => [l.id, l.ok]),
      [
        ['c1', true],
        ['c2', false],
        ['c3', true],
      ],
    );
    assert.equal(r.links[1].why, 'Случайное слово «приложение»');
  });

  test('ответ в ```json и с лишними словами вокруг', () => {
    const r = parseReview('Вот результат:\n```json\n' + ok + '\n```\nГотово!', INPUT);
    assert.ok(r);
    assert.equal(r.links.length, 3);
    assert.ok(parseReview('Конечно! ' + ok + ' Надеюсь, помог.', INPUT));
  });

  test('строки вместо чисел и булевых значений понимаются', () => {
    const r = parseReview('{"keywords":[{"n":"2","keep":"false"}],"links":[{"n":"3","ok":"true"}]}', INPUT)!;
    assert.deepEqual(r.drop, ['решил']);
    assert.deepEqual(r.links, [{ id: 'c3', ok: true }]);
  });

  test('номера вне списка, повторы и мусор отбрасываются', () => {
    const r = parseReview(
      JSON.stringify({
        keywords: [{ n: 9, keep: false }, { n: 0, keep: false }, 'x', { n: 2 }],
        missing: [42, '', 'очень длинная фраза из многих слов тут', 'Доход'],
        links: [{ n: 7, ok: true }, { n: 1, ok: false }, { n: 1, ok: true }, { n: 2, ok: 'может быть' }],
      }),
      INPUT,
    )!;
    assert.deepEqual(r.drop, []);
    assert.deepEqual(r.add, [], '«Доход» уже среди важных слов');
    assert.deepEqual(r.links, [{ id: 'c1', ok: false }]);
  });

  test('все слова убрать нельзя — самые весомые остаются', () => {
    const r = parseReview(JSON.stringify({ keywords: [1, 2, 3, 4].map((n) => ({ n, keep: false })) }), INPUT)!;
    assert.deepEqual(r.drop, ['доход', 'половин']);
    const ten = { ...INPUT, keywords: Array.from({ length: 10 }, (_, i) => ({ key: 'k' + i, form: 'слово' + i })) };
    const r10 = parseReview(JSON.stringify({ keywords: ten.keywords.map((_, i) => ({ n: i + 1, keep: false })) }), ten)!;
    assert.equal(r10.drop.length, 7);
    assert.ok(!r10.drop.includes('k0'));
  });

  test('непонятный ответ — null', () => {
    assert.equal(parseReview('Извините, не могу помочь', INPUT), null);
    assert.equal(parseReview('{сломанный json', INPUT), null);
    assert.equal(parseReview('[1,2,3]', INPUT), null);
  });

  test('кавычки и скобки внутри строк не ломают разбор', () => {
    const r = parseReview('{"links":[{"n":2,"ok":false,"why":"слово «}» и \\"кавычки\\" {тут}"}]}', INPUT)!;
    assert.equal(r.links[0].why, 'слово «}» и "кавычки" {тут}');
  });
});
