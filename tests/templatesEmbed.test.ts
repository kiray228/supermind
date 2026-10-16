/** Шаблоны заметок, встраивание ![[заметки]] и ссылки на разделы — чистые правила (Node, без браузера) */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/srcHooks.ts';

const tc = await import('../src/notes/templatesCore.ts');
const ec = await import('../src/notes/embedCore.ts');
const { dailyBlocks } = await import('../src/notes/dailyCore.ts');
const { newBlock, stripInline, markdownToBlocks } = await import('../src/notes/model.ts');
const { parseWiki, extractWiki, buildIndex, extractFeatures, relatedTo } = await import('../src/notes/links.ts');
const { retargetWiki } = await import('../src/notes/backlinks.ts');
const { noteDoc } = await import('../src/notes/brainDocs.ts');

const V = { ymd: '2026-10-16', time: '14:05' };
const shape = (bs: { type: string; text?: string }[]) => bs.map((b) => `${b.type}:${b.text ?? ''}`);

describe('подстановки шаблона', () => {
  test('дата, время, день недели, название — по-русски и по-английски, без учёта регистра', () => {
    assert.equal(tc.fillText('{{дата}} в {{время}}', V), '16 октября 2026 в 14:05');
    assert.equal(tc.fillText('{{Date}} · {{TIME}}', V), '16 октября 2026 · 14:05');
    assert.equal(tc.fillText('{{день недели}}, {{weekday}}', V), 'Пятница, Пятница');
    assert.equal(tc.fillText('Заметка «{{название}}»', { ...V, title: 'Бюджет' }), 'Заметка «Бюджет»');
    assert.equal(tc.fillText('{{ дата:DD.MM.YYYY }}', V), '16.10.2026');
    assert.equal(tc.fillText('{{дата:D MMMM, dddd}}', V), '16 октября, пятница');
    assert.equal(tc.formatDate('2026-03-05', 'YY-M-D'), '26-3-5');
  });

  test('незнакомая подстановка остаётся как есть; без подстановок строка не меняется', () => {
    assert.equal(tc.fillText('{{погода}} и {{дата}}', V), '{{погода}} и 16 октября 2026');
    assert.equal(tc.fillText('Просто текст {не подстановка}', V), 'Просто текст {не подстановка}');
  });

  test('пустая подстановка убирает свою часть « · »', () => {
    assert.equal(tc.fillText('{{день недели}} · прошлая запись: {{вчера}}', V), 'Пятница');
    assert.equal(tc.fillText('{{день недели}} · прошлая запись: {{вчера}}', { ...V, prev: '15 октября 2026' }), 'Пятница · прошлая запись: [[15 октября 2026]]');
    assert.equal(tc.fillText('{{время}} · Участники: ', { ymd: V.ymd }), 'Участники: ');
  });

  test('название: с подстановками — заполняется, без них — пустое; в списке — без подстановок', () => {
    assert.equal(tc.fillTitle('Встреча {{дата}}', V), 'Встреча 16 октября 2026');
    assert.equal(tc.fillTitle('Книга', V), '');
    assert.equal(tc.templateName('Встреча {{дата}}'), 'Встреча');
    assert.equal(tc.templateName('{{дата}} — итоги'), 'итоги');
    assert.equal(tc.templateName('{{дата}}'), 'Без названия');
    assert.ok(tc.hasVars('a {{x}}') && !tc.hasVars('a {x}'));
  });

  test('папка шаблонов: «Шаблоны» и «Templates» из Obsidian', () => {
    assert.ok(tc.isTemplateFolderName(' шаблоны '));
    assert.ok(tc.isTemplateFolderName('Templates'));
    assert.ok(!tc.isTemplateFolderName('Работа'));
  });
});

describe('блоки по шаблону', () => {
  test('новые id, подстановки в тексте и подписи; шаблон не меняется', () => {
    const src = [newBlock('h2', { text: 'Итоги {{дата}}' }), newBlock('image', { src: 'data:x', caption: 'снято {{время}}' })];
    const out = tc.fillTemplate(src, V);
    assert.notEqual(out[0].id, src[0].id);
    assert.equal(out[0].text, 'Итоги 16 октября 2026');
    assert.equal(out[1].caption, 'снято 14:05');
    assert.equal(src[0].text, 'Итоги {{дата}}');
  });

  test('{{задачи}} и {{цели}} целым абзацем — пункты списка; задачи-чекбоксы остаются чекбоксами', () => {
    const tasks = ['Купить хлеб', 'Купить хлеб', 'Сдать [отчёт]'];
    assert.deepEqual(shape(tc.fillTemplate([newBlock('p', { text: '{{задачи}}' }), newBlock('p', { text: '{{цели}}' })], { ...V, tasks, goals: ['Марафон'] })), ['bullet:[[Купить хлеб]]', 'bullet:Сдать [отчёт]', 'bullet:🎯 срок: [[Марафон]]']);
    assert.deepEqual(shape(tc.fillTemplate([newBlock('todo', { text: '{{tasks}}' })], { ...V, tasks: ['Позвонить'] })), ['todo:[[Позвонить]]']);
    assert.deepEqual(shape(tc.fillTemplate([newBlock('p', { text: '{{задачи}}' }), newBlock('p', { text: '{{цели}}' })], V)), ['bullet:'], 'нет задач — пустой пункт, нет целей — ничего');
    assert.equal(tc.fillText('Сегодня: {{задачи}}', { ...V, tasks: ['А', 'Б'] }), 'Сегодня: [[А]], [[Б]]');
  });

  test('пустой шаблон — один пустой абзац', () => {
    assert.deepEqual(shape(tc.fillTemplate([], V)), ['p:']);
  });

  test('готовый шаблон «Заметка дня» даёт ровно стандартную заметку дня', () => {
    const daily = tc.TEMPLATE_PRESETS.find((p) => p.title === tc.DAILY_TEMPLATE)!;
    for (const inp of [
      { ymd: '2026-10-16', tasks: ['Купить хлеб', 'Позвонить маме'], goals: ['Марафон'], prev: '15 октября 2026' },
      { ymd: '2026-10-17', tasks: [], goals: [] },
    ]) assert.deepEqual(shape(tc.fillTemplate(daily.blocks(), inp)), shape(dailyBlocks(inp)));
  });

  test('готовые шаблоны: названия и содержимое', () => {
    assert.deepEqual(
      tc.TEMPLATE_PRESETS.map((p) => tc.templateName(p.title)),
      ['Встреча', 'Книга', 'Проект', 'Заметка дня'],
    );
    for (const p of tc.TEMPLATE_PRESETS) assert.ok(p.blocks().length >= 4, p.title);
  });
});

describe('скелет шаблона — общий текст не связывает заметки', () => {
  const meeting = tc.TEMPLATE_PRESETS[0].blocks();
  const book = tc.TEMPLATE_PRESETS[1].blocks();

  test('строки шаблона убираются, своё — остаётся', () => {
    const sk = tc.templateSkeleton(meeting);
    assert.equal(tc.stripSkeleton('14:05 · Участники: Иван, Пётр', sk), 'Иван, Пётр');
    assert.equal(tc.stripSkeleton('Повестка', sk, true), '');
    assert.equal(tc.stripSkeleton('Следующие   шаги', sk, true), '', 'пробелы — любые');
    assert.equal(tc.stripSkeleton('Решения по бюджету', sk, true), 'Решения по бюджету', 'свой заголовок не трогаем');
    assert.equal(tc.stripSkeleton('Повестка', sk), 'Повестка', 'заголовок шаблона — только для заголовков');
    assert.equal(tc.stripSkeleton('Просто текст', sk), 'Просто текст');
    const sk2 = tc.templateSkeleton(book);
    assert.equal(tc.stripSkeleton('Автор: Толстой', sk2), 'Толстой');
    assert.equal(tc.stripSkeleton('Авторитет важен', sk2), 'Авторитет важен', 'только целым словом');
    assert.equal(tc.stripSkeleton('Прочитано: 3 марта 2026', sk2), '');
  });

  test('строки из одних подстановок и списков в скелет не берутся (иначе съели бы всё)', () => {
    const sk = tc.templateSkeleton([newBlock('p', { text: '{{дата}}' }), newBlock('p', { text: '{{задачи}}' }), newBlock('p', { text: 'Ок {{время}}' })]);
    assert.equal(sk.lines.length, 0);
  });

  test('название по шаблону: составленное шаблоном — не в связях, своё — в связях', () => {
    const sk = tc.templateSkeleton(meeting, 'Встреча {{дата}}');
    const doc = (title: string) => noteDoc({ title, blocks: [], updatedAt: 0 }, 'plain', sk).title;
    assert.equal(doc('Встреча 16 октября 2026'), '');
    assert.equal(doc('встреча 3 мая 2025'), '');
    assert.equal(doc('Встреча с Иваном по ремонту'), 'Встреча с Иваном по ремонту');
    const sk2 = tc.templateSkeleton([], '{{дата:DD.MM.YYYY}} {{время}} — созвон');
    assert.equal(noteDoc({ title: '16.10.2026 14:05 — созвон', blocks: [], updatedAt: 0 }, 'plain', sk2).title, '');
    assert.equal(tc.templateSkeleton([], 'Книга').title, undefined, 'без подстановок — название своё');
  });

  test('две встречи по шаблону о разном — не связаны; без скелета — связаны шаблоном', () => {
    const sk = tc.templateSkeleton(meeting, 'Встреча {{дата}}');
    const fill = (title: string, md: string) => ({ title, blocks: [...tc.fillTemplate(meeting, V), ...markdownToBlocks(md)], updatedAt: 0 });
    const a = fill('Встреча 16 октября 2026', 'Обсудили ремонт кухни и плитку.');
    const b = fill('Встреча 17 октября 2026', 'Выбрали подарок коллеге на юбилей.');
    const ix = (s: typeof sk | null) =>
      buildIndex([
        { id: 'a', f: extractFeatures(noteDoc(a, 'plain', s)) },
        { id: 'b', f: extractFeatures(noteDoc(b, 'plain', s)) },
      ]);
    const doc = noteDoc(a, 'plain', sk);
    assert.ok(!doc.headings.some((h) => /повестка|решения|шаги/i.test(h)), 'заголовков шаблона нет');
    assert.ok(!doc.text.includes('Участники'));
    assert.equal(relatedTo(ix(sk), 'a').length, 0);
    assert.equal(relatedTo(ix(null), 'a')[0]?.id, 'b', 'без скелета их связал бы общий текст шаблона');
  });
});

describe('ссылки на разделы', () => {
  test('[[Заметка#Раздел]] — название и раздел; «C# заметки» — это название', () => {
    assert.deepEqual(parseWiki('Бюджет#Расходы'), { title: 'Бюджет', label: 'Бюджет › Расходы', section: 'Расходы' });
    assert.deepEqual(parseWiki('Бюджет#Расходы|траты'), { title: 'Бюджет', label: 'траты', section: 'Расходы' });
    assert.deepEqual(parseWiki('C# заметки'), { title: 'C# заметки', label: 'C# заметки' });
    assert.deepEqual(parseWiki('Язык C#'), { title: 'Язык C#', label: 'Язык C#' });
    assert.deepEqual(parseWiki('#Раздел'), { title: '#Раздел', label: '#Раздел' });
    assert.deepEqual(parseWiki('Бюджет#^abc'), { title: 'Бюджет', label: 'Бюджет' }, 'ссылка на блок — на саму заметку');
    assert.deepEqual(extractWiki('см. [[Бюджет#Расходы]] и ![[Бюджет]]'), ['Бюджет'], 'раздел и встраивание — ссылка на ту же заметку');
  });

  test('переименование заметки сохраняет раздел', () => {
    assert.equal(retargetWiki('[[Бюджет#Расходы]]', 'Бюджет', 'Деньги'), '[[Деньги#Расходы|Бюджет]]');
    assert.equal(retargetWiki('![[Бюджет#Итог|итог]]', 'Бюджет', 'Деньги'), '![[Деньги#Итог|итог]]');
    assert.equal(retargetWiki('[[Бюджет]]', 'Бюджет', 'Деньги'), '[[Деньги|Бюджет]]');
  });

  test('простой текст: встраивание и раздел — читаемо', () => {
    assert.equal(stripInline('![[Бюджет#Итог]]'), 'Бюджет › Итог');
    assert.equal(stripInline('см. [[Бюджет|бюджет]]'), 'см. бюджет');
  });
});

describe('встраивание', () => {
  test('строка целиком — встраивание; внутри текста — нет', () => {
    assert.deepEqual(ec.parseEmbed('![[Бюджет]]'), { title: 'Бюджет' });
    assert.deepEqual(ec.parseEmbed('  ![[Бюджет#Итог]]  '), { title: 'Бюджет', section: 'Итог' });
    assert.deepEqual(ec.parseEmbed('![[Бюджет|подпись]]'), { title: 'Бюджет' });
    assert.equal(ec.parseEmbed('см. ![[Бюджет]]'), null);
    assert.equal(ec.parseEmbed('[[Бюджет]]'), null);
    assert.equal(ec.parseEmbed('![[]]'), null);
    assert.equal(ec.parseEmbed(undefined), null);
    assert.equal(ec.embedText('Бюджет', 'Итог'), '![[Бюджет#Итог]]');
  });

  test('раздел: заголовок и всё до следующего того же или старшего уровня; без учёта регистра и разметки', () => {
    const bs = markdownToBlocks('# План\nвступление\n## **Расходы**\n- еда\n### Мелочи\n- кофе\n## Доходы\n- зарплата\n# Итог\nвсё');
    assert.deepEqual(shape(ec.sectionBlocks(bs, 'расходы')!), ['h2:**Расходы**', 'bullet:еда', 'h3:Мелочи', 'bullet:кофе']);
    assert.equal(ec.sectionBlocks(bs, 'План')!.length, 8, 'до следующего h1');
    assert.deepEqual(shape(ec.sectionBlocks(bs, 'Итог')!), ['h1:Итог', 'p:всё']);
    assert.equal(ec.sectionBlocks(bs, 'Нет такого'), null);
    assert.deepEqual(ec.headingsOf(bs), ['План', 'Расходы', 'Мелочи', 'Доходы', 'Итог']);
  });

  test('показ: без пустых абзацев по краям и не больше max', () => {
    const bs = [newBlock('p'), ...Array.from({ length: 5 }, (_, i) => newBlock('p', { text: `строка ${i}` })), newBlock('p', { text: '  ' })];
    const r = ec.embedBlocks(bs, 3);
    assert.deepEqual(shape(r.blocks), ['p:строка 0', 'p:строка 1', 'p:строка 2']);
    assert.equal(r.more, 2);
    assert.equal(ec.embedBlocks([newBlock('p')]).blocks.length, 0);
  });
});

describe('план вопросов дня', async () => {
  const qc = await import('../src/notes/questionCore.ts');
  const DAY = 86400000;
  const now = Date.UTC(2026, 9, 16, 9);
  const n = (id: string, ageDays: number, words = 200) => ({ id, title: `Заметка ${id}`, updatedAt: now - ageDays * DAY, wordCount: words });
  const pool = ['a', 'b', 'c', 'd'].map((id, i) => n(id, 30 + i * 10));
  const days = ['2026-10-16', '2026-10-17', '2026-10-18'];

  test('каждый день — своя заметка, без повторов; уже выбранное не меняется', () => {
    const p = qc.fillQuestionPlan({}, days, pool, now);
    assert.deepEqual(Object.keys(p).sort(), days);
    assert.equal(new Set(Object.values(p).map((x) => x.noteId)).size, 3);
    assert.ok(Object.values(p).every((x) => x.question === qc.fallbackQuestion(x.title) && !x.ai));
    const fixed = { ...p, '2026-10-16': { ...p['2026-10-16'], question: 'Свой?', ai: true } };
    assert.deepEqual(qc.fillQuestionPlan(fixed, days, pool, now), fixed);
  });

  test('прошедшие дни и удалённые заметки уходят из плана; недавно спрошенные не берутся', () => {
    const p = qc.fillQuestionPlan({ '2026-10-15': { noteId: 'a', title: 'x', question: '?' } }, days, pool, now, { a: now - DAY, b: now - DAY });
    assert.ok(!p['2026-10-15']);
    assert.ok(Object.values(p).every((x) => x.noteId !== 'a' && x.noteId !== 'b'));
    assert.equal(Object.keys(p).length, 2, 'заметок хватило на два дня');
    const gone = qc.fillQuestionPlan(p, days, pool.map((x) => (x.id === p['2026-10-16'].noteId ? { ...x, trashed: 1 } : x)), now, { a: now - DAY, b: now - DAY });
    assert.ok(!gone['2026-10-16'] || gone['2026-10-16'].noteId !== p['2026-10-16'].noteId);
  });

  test('название в плане — актуальное (заметку переименовали)', () => {
    const p = qc.fillQuestionPlan({}, days.slice(0, 1), pool, now);
    const id = p[days[0]].noteId;
    const renamed = qc.fillQuestionPlan(p, days.slice(0, 1), pool.map((x) => (x.id === id ? { ...x, title: 'Новое имя' } : x)), now);
    assert.equal(renamed[days[0]].title, 'Новое имя');
  });
});
