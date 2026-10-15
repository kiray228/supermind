import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';
import { CORPUS } from './fixtures/corpus.ts';
import type { NoteMeta, StudyCard } from '../src/notes/model.ts';

const { extractArticle, articleText, decodePage, charsetOf, decodeEntities, firstUrl, articleMarkdown, buildArticlePrompt, ARTICLE_SYSTEM } = await import('../src/notes/articleCore.ts');
const { brainBriefOf, briefParts, REREAD_DAYS } = await import('../src/notes/brainBrief.ts');
const { buildIndex, extractFeatures } = await import('../src/notes/links.ts');
const { newCard } = await import('../src/notes/cardsCore.ts');
const { itemId } = await import('../src/notes/brainDocs.ts');
const { markdownToBlocks } = await import('../src/notes/model.ts');

const P = (s: string) => `<p>${s}</p>`;
const LONG = 'Интервальные тренировки повышают выносливость быстрее, чем длинные медленные пробежки, если их делать раз в неделю.';

const PAGE = `<!doctype html><html><head>
<meta charset="utf-8"><title>Как бегать правильно — Бег.ру</title>
<meta property="og:title" content="Как бегать правильно &laquo;с умом&raquo;">
<meta property="og:site_name" content="Бег.ру">
<meta name="description" content="Разбираем интервалы и пульс">
<meta property="og:image" content="/img/cover.jpg">
<script>var ads = "<p>реклама в скрипте, которая не должна попасть</p>";</script>
<style>p { color: red }</style>
</head><body>
<header><nav><ul><li>Главная страница сайта</li><li>Статьи про бег и здоровье</li></ul></nav></header>
<aside><p>Подпишитесь на рассылку и получайте новые статьи каждую неделю!</p></aside>
<article>
<h1>Как бегать правильно</h1>
${P(LONG)}
<h2>Пульсовые зоны</h2>
${P('Вторая зона — это лёгкий бег, при котором можно разговаривать, и он строит аэробную базу.')}
<ul><li>Интервалы: 6 × 800 м в темпе 5 км</li><li>да</li></ul>
<h2>Пустой подзаголовок</h2>
<button>Поделиться в соцсетях</button>
<!-- <p>комментарий в разметке, которого не должно быть в тексте</p> -->
</article>
<footer><p>© 2026 Бег.ру — все права защищены, перепечатка запрещена без ссылки.</p></footer>
</body></html>`;

describe('статья: разбор страницы', () => {
  const a = extractArticle(PAGE, 'https://www.beg.ru/article/1');

  test('название, сайт, описание, картинка', () => {
    assert.equal(a.title, 'Как бегать правильно «с умом»');
    assert.equal(a.site, 'Бег.ру');
    assert.equal(a.description, 'Разбираем интервалы и пульс');
    assert.equal(a.image, 'https://www.beg.ru/img/cover.jpg');
  });

  test('текст: из <article>, без меню, скриптов, подвала, комментариев; подзаголовки и пункты', () => {
    const lines = a.text.split('\n\n');
    assert.deepEqual(lines, [
      '## Как бегать правильно',
      LONG,
      '## Пульсовые зоны',
      'Вторая зона — это лёгкий бег, при котором можно разговаривать, и он строит аэробную базу.',
      '- Интервалы: 6 × 800 м в темпе 5 км',
    ]);
    for (const bad of ['реклама', 'Подпишитесь', 'Главная', 'перепечатка', 'комментарий', 'Поделиться', 'Пустой подзаголовок']) assert.ok(!a.text.includes(bad), bad);
  });

  test('без <article> — <main>, без него — body; «Название | Сайт» → название', () => {
    const p = `<html><head><title>Рецепт борща | Кухня</title><meta property="og:site_name" content="Кухня"></head><body><main>${P(LONG.repeat(5))}</main><p>${LONG}</p></body></html>`;
    const r = extractArticle(p, 'https://kitchen.test/borsch');
    assert.equal(r.title, 'Рецепт борща');
    assert.equal(r.text, LONG.repeat(5));
    const bare = extractArticle(`<body>${P(LONG)}</body>`, 'https://x.test/a');
    assert.equal(bare.title, 'x.test');
    assert.equal(bare.site, 'x.test');
    assert.equal(bare.text, LONG);
  });

  test('«>» внутри атрибутов не ломает разбор; «Марафон — Википедия» → «Марафон» (по <h1>)', () => {
    const p = `<html><head><title>Марафон — Википедия</title></head><body><main><h1 data-x='a>b'>Марафон</h1><div data-mw='{"parts":[{"x":"[[США]]"}]}' class="a>b">${P(LONG)}</div><table data-mw='{"y":"<b>жирный</b>"}'><tr><td>${LONG}</td></tr></table></main></body></html>`;
    const r = extractArticle(p, 'https://ru.wikipedia.org/wiki/x');
    assert.equal(r.title, 'Марафон');
    assert.ok(!/[{}[\]"]|data-mw|США|жирный/.test(r.text), r.text);
    assert.ok(r.text.includes(LONG));
    // разделитель есть, но первая часть — не заголовок страницы: название целиком
    assert.equal(extractArticle(`<title>Бег — это просто</title><h1>Совсем другое</h1>${P(LONG)}`, 'https://x.test').title, 'Бег — это просто');
  });

  test('лимит длины текста', () => {
    const many = '<body>' + Array.from({ length: 500 }, () => P(LONG)).join('') + '</body>';
    assert.ok(articleText(many, 3000).length < 3300);
  });

  test('сущности и кодировки: windows-1251, utf-8, из <meta charset>', () => {
    assert.equal(decodeEntities('&amp;&#8212;&#x41;&nbsp;&laquo;&unknown;'), '&—A «&unknown;');
    assert.equal(charsetOf('text/html; charset=Windows-1251', ''), 'windows-1251');
    assert.equal(charsetOf('text/html', '<meta charset="koi8-r">'), 'koi8-r');
    assert.equal(charsetOf(undefined, ''), 'utf-8');
    // «Привет» в windows-1251
    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    assert.equal(decodePage(cp1251, 'text/html; charset=windows-1251'), 'Привет');
    assert.equal(decodePage(new TextEncoder().encode('<meta charset="utf-8">Привет'), 'text/html'), '<meta charset="utf-8">Привет');
    assert.equal(decodePage(cp1251, 'text/html; charset=bogus-charset'), new TextDecoder().decode(cp1251));
  });

  test('ссылка в тексте', () => {
    assert.equal(firstUrl('Смотри https://habr.com/ru/articles/123/, интересно'), 'https://habr.com/ru/articles/123/');
    assert.equal(firstUrl('«https://x.ru/a»'), 'https://x.ru/a');
    assert.equal(firstUrl('без ссылки'), null);
  });

  test('заметка: источник + пересказ; без ИИ — описание и начало', () => {
    const withAi = articleMarkdown(a, '## Главные мысли\n- Интервалы раз в неделю');
    assert.ok(withAi.startsWith('Источник: [Бег.ру](https://www.beg.ru/article/1)\n\n## Главные мысли'));
    const noAi = articleMarkdown(a);
    assert.ok(noAi.includes('Разбираем интервалы и пульс'));
    assert.ok(noAi.includes('## Начало статьи'));
    assert.ok(noAi.includes(LONG));
    assert.ok(!noAi.includes('## Пульсовые зоны'));
    const blocks = markdownToBlocks(withAi);
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['p', 'h2', 'bullet'],
    );
    assert.ok(buildArticlePrompt(a).startsWith('Статья «Как бегать правильно «с умом»» (Бег.ру)'));
    assert.ok(ARTICLE_SYSTEM.includes('Главные мысли'));
  });
});

describe('статьи в связях', async () => {
  const { noteDoc } = await import('../src/notes/brainDocs.ts');
  const note = (title: string, md: string) => ({ title, updatedAt: 1, blocks: markdownToBlocks(md) });

  test('шаблон статьи (источник, «Главные мысли»…) не участвует в связях; свой текст — участвует', async () => {
    const { buildIndex: bi, relatedTo: rt } = await import('../src/notes/links.ts');
    const a1 = note('Рецепт хлеба', articleMarkdown({ url: 'https://a.test/1', title: 'x', site: 'a.test', text: '' }, 'Как испечь хлеб.\n\n## Главные мысли\n- Мука, вода, соль\n- Закваска двое суток\n\n## Что применить\n- Печь при 230 градусах'));
    const a2 = note('Ремонт велосипеда', articleMarkdown({ url: 'https://a.test/2', title: 'x', site: 'a.test', text: '' }, 'Как поменять цепь.\n\n## Главные мысли\n- Выжимка цепи\n- Смазка после мойки\n\n## Что применить\n- Менять каждые 3000 км'));
    const d1 = noteDoc(a1, 'article');
    assert.deepEqual(d1.headings, []);
    assert.ok(!d1.text.includes('Источник'));
    assert.ok(d1.text.includes('Закваска'));
    const ix = bi([
      { id: 'a1', f: extractFeatures(d1) },
      { id: 'a2', f: extractFeatures(noteDoc(a2, 'article')) },
    ]);
    assert.deepEqual(rt(ix, 'a1'), [], 'разные статьи не связаны общим шаблоном');
    // обычная заметка — заголовки остаются
    assert.ok(noteDoc(a1).headings.includes('Главные мысли'));
  });
});

describe('утренняя сводка из мозга', () => {
  const DAY = 86400000;
  const now = Date.UTC(2026, 9, 15, 6);
  const today = '2026-10-15';
  const meta = (id: string, title: string, age: number, extra: Partial<NoteMeta> = {}): NoteMeta => ({ id, title, preview: '', createdAt: now - age * DAY, updatedAt: now - age * DAY, ...extra });
  const docs = [
    ...CORPUS.map((f) => ({ id: f.id, f: extractFeatures(f) })),
    { id: itemId('task', 't1'), f: extractFeatures({ title: 'Купить кроссовки для длинных пробежек', text: 'амортизация, пробег' }) },
  ];
  const ix = buildIndex(docs);
  const notes = CORPUS.map((f) => meta(f.id, f.title, 60));
  const card = (p: Partial<StudyCard>): StudyCard => ({ ...newCard({ id: 'c' + Math.random(), noteId: 'run-plan', q: 'q', a: 'a', by: 'ai' }, today, 1), ...p });

  test('карточки на день: только живых заметок, не будущие', () => {
    const cards = [card({}), card({ due: '2026-10-10', reps: 2 }), card({ due: '2026-10-20', reps: 1 }), card({ noteId: 'нет' })];
    assert.equal(brainBriefOf({ day: today, now, notes, cards, taskIds: [], ix: null }).cards, 2);
    const trashed = notes.map((n) => (n.id === 'run-plan' ? { ...n, trashed: now } : n));
    assert.equal(brainBriefOf({ day: today, now, notes: trashed, cards, taskIds: [], ix: null }).cards, 0);
  });

  test('перечитать: давняя заметка, связанная с задачей дня', () => {
    const b = brainBriefOf({ day: today, now, notes, cards: [], taskIds: ['t1'], ix });
    assert.ok(b.reread, JSON.stringify(b));
    assert.ok(['run-shoes', 'run-plan', 'run-log'].includes(b.reread!.id), b.reread!.id);
    assert.equal(b.reread!.title, CORPUS.find((f) => f.id === b.reread!.id)!.title);
  });

  test('свежие, заметки дня и конспекты — не «перечитать»; без задач — через недавние заметки', () => {
    const fresh = notes.map((n) => (n.id.startsWith('run-') ? { ...n, updatedAt: now - DAY } : n));
    const b = brainBriefOf({ day: today, now, notes: fresh, cards: [], taskIds: ['t1'], ix });
    assert.ok(!b.reread || !b.reread.id.startsWith('run-'), JSON.stringify(b));
    const special = notes.map((n) => (n.id.startsWith('run-') ? { ...n, digest: true } : n));
    const b2 = brainBriefOf({ day: today, now, notes: special, cards: [], taskIds: ['t1'], ix });
    assert.ok(!b2.reread || !b2.reread.id.startsWith('run-'));
    // задач нет, но вчера правили план тренировок — давние заметки о беге
    const recent = notes.map((n) => (n.id === 'run-plan' ? { ...n, updatedAt: now - DAY } : n));
    const b3 = brainBriefOf({ day: today, now, notes: recent, cards: [], taskIds: [], ix });
    assert.ok(b3.reread && b3.reread.id.startsWith('run-') && b3.reread.id !== 'run-plan', JSON.stringify(b3));
    assert.ok(REREAD_DAYS >= 14);
  });

  test('текст для уведомления', () => {
    assert.deepEqual(briefParts({ cards: 5, reread: { id: 'x', title: 'Бюджет' } }), { part: 'карточек: 5', tail: 'Перечитать: «Бюджет»' });
    assert.deepEqual(briefParts({ cards: 0 }), {});
    assert.deepEqual(briefParts(null), {});
  });
});
