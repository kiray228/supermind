import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';
import { CORPUS } from './fixtures/corpus.ts';
import type { NoteBody } from '../src/notes/model.ts';

const { buildDigestPrompt, digestToMarkdown, DIGEST_SYSTEM } = await import('../src/notes/digestPrompt.ts');
const { reviewFindings, splitByHeadings, linkableTitle, FORGOTTEN_DAYS } = await import('../src/notes/reviewCore.ts');
const { dailyTitle, dailyBlocks, weekdayOf, prevYmd, DAILY_SECTIONS } = await import('../src/notes/dailyCore.ts');
const { buildIndex, extractFeatures, relatedTo, parseWiki } = await import('../src/notes/links.ts');
const { markdownToBlocks } = await import('../src/notes/model.ts');

const src = (n: number, title: string, kind = 'Заметка') => ({ n, id: 'id' + n, kind, title, text: 'текст ' + n });

describe('конспект темы', () => {
  const sources = [src(1, 'Подушка безопасности'), src(2, 'Бюджет на октябрь'), src(3, 'Финансы', 'Карта'), src(4, 'Странное [название]')];

  test('запрос: тема, нумерованные записи с типом, просьба в конце', () => {
    const p = buildDigestPrompt('Финансы', sources);
    assert.ok(p.startsWith('Тема: Финансы'));
    assert.ok(p.includes('[1] Заметка «Подушка безопасности»\nтекст 1'));
    assert.ok(p.includes('[3] Карта «Финансы»'));
    assert.ok(p.trimEnd().endsWith('Составь конспект темы «Финансы».'));
    assert.ok(DIGEST_SYSTEM.includes('[1]') && DIGEST_SYSTEM.includes('Открытые вопросы'));
  });

  test('ссылки [n] → [[Название]], несколько — через запятую, лишние номера — текстом', () => {
    const md = digestToMarkdown('## Главное\n- Шесть месяцев расходов [1].\n- Откладываю 20% [1, 2][2]\n- Номер [9] вне списка', sources);
    const lines = md.split('\n');
    assert.equal(lines[1], '- Шесть месяцев расходов ([[Подушка безопасности]]).');
    // [1, 2][2] — одна группа ссылок, повтор не дублируется
    assert.equal(lines[2], '- Откладываю 20% ([[Подушка безопасности]], [[Бюджет на октябрь]])');
    assert.equal(lines[3], '- Номер [9] вне списка');
  });

  test('название, которое сломает ссылку, — в кавычках; источники — в конце', () => {
    const md = digestToMarkdown('Факт [4]', sources);
    assert.ok(md.startsWith('Факт («Странное [название]»)'));
    assert.ok(md.includes('## Источники\n\n- [[Подушка безопасности]] — заметка\n'));
    assert.ok(md.includes('- [[Финансы]] — карта'));
    assert.ok(md.includes('- «Странное [название]» — заметка'));
  });

  test('конспект → блоки заметки: заголовки, списки, ссылки разбираются', () => {
    const blocks = markdownToBlocks(digestToMarkdown('## Главное\n- Пункт [1]\n\n## Открытые вопросы\n- Вопрос [2]', sources));
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['h2', 'bullet', 'h2', 'bullet', 'h2', 'bullet', 'bullet', 'bullet', 'bullet'],
    );
    const wiki = blocks.flatMap((b) => [...(b.text ?? '').matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => parseWiki(m[1]).title));
    assert.ok(wiki.includes('Подушка безопасности') && wiki.includes('Бюджет на октябрь'));
  });
});

describe('обзор мозга', () => {
  const DAY = 86400000;
  const now = Date.UTC(2026, 9, 15);
  const ix = buildIndex(CORPUS.map((f) => ({ id: f.id, f: extractFeatures(f) })));
  const related = (id: string) => relatedTo(ix, id).map((r) => r.id);

  test('без связей: только с текстом и без [[ссылок]], свежие первыми', () => {
    const notes = [
      { id: 'lonely', title: 'Одинокая', updatedAt: now - DAY, wordCount: 40 },
      { id: 'lonely-old', title: 'Старая одинокая', updatedAt: now - 90 * DAY, wordCount: 40 },
      { id: 'short', title: 'Пустая', updatedAt: now, wordCount: 3 },
      { id: 'wiki', title: 'Со ссылкой', updatedAt: now, wordCount: 40 },
      ...CORPUS.map((f) => ({ id: f.id, title: f.title, updatedAt: now - 200 * DAY, wordCount: 50 })),
    ];
    const r = reviewFindings({ notes, related: (id) => (ix.docs.has(id) ? related(id) : []), wiki: (id) => id === 'wiki', recent: new Map(), now });
    assert.deepEqual(r.orphans.slice(0, 2), ['lonely', 'lonely-old']);
    assert.ok(!r.orphans.includes('short') && !r.orphans.includes('wiki'));
    // из корпуса — ровно те, у кого нет связей (одиночные заметки «solo-…» среди них)
    const corpusOrphans = r.orphans.filter((id) => CORPUS.some((f) => f.id === id));
    assert.deepEqual(corpusOrphans.sort(), CORPUS.filter((f) => related(f.id).length === 0).map((f) => f.id).sort());
    assert.ok(corpusOrphans.some((id) => id.startsWith('solo-')));
    assert.ok(corpusOrphans.length < CORPUS.length / 3, corpusOrphans.join(', '));
  });

  test('забытые: давно не менялись, но связаны с недавним; свежая связь — выше', () => {
    const old = now - (FORGOTTEN_DAYS + 10) * DAY;
    const notes = CORPUS.map((f) => ({ id: f.id, title: f.title, updatedAt: f.id === 'fin-budget' || f.id === 'run-plan' ? now - DAY : old, wordCount: 50 }));
    const recent = new Map([
      ['fin-budget', now - 2 * DAY],
      ['run-plan', now - DAY],
    ]);
    const r = reviewFindings({ notes, related, wiki: () => false, recent, now });
    assert.ok(r.forgotten.length >= 2, JSON.stringify(r.forgotten));
    for (const f of r.forgotten) {
      assert.ok(['fin-budget', 'run-plan'].includes(f.via));
      assert.ok(related(f.id).includes(f.via));
      assert.equal(f.days, FORGOTTEN_DAYS + 10);
      assert.notEqual(f.id, f.via);
    }
    // темы не перепутаны: финансы — через бюджет, бег — через план
    const topic = (id: string) => CORPUS.find((x) => x.id === id)!.topic;
    for (const f of r.forgotten) assert.equal(topic(f.id), topic(f.via));
    assert.equal(r.forgotten[0].via, 'run-plan');
  });

  test('ничего недавнего — забытых нет; лимит соблюдается', () => {
    const notes = CORPUS.map((f) => ({ id: f.id, title: f.title, updatedAt: now - 100 * DAY, wordCount: 50 }));
    assert.deepEqual(reviewFindings({ notes, related, wiki: () => false, recent: new Map(), now }).forgotten, []);
    const recent = new Map(CORPUS.map((f) => [f.id, now] as [string, number]));
    assert.ok(reviewFindings({ notes, related, wiki: () => false, recent, now }, 3).forgotten.length <= 3);
  });
});

describe('разбить заметку', () => {
  const body = (md: string): NoteBody => ({ title: 'Большая', updatedAt: 1, blocks: markdownToBlocks(md) });

  test('разделы второго уровня → заметки, вступление остаётся', () => {
    const r = splitByHeadings(body('Вступление\n## Бег\nПлан тренировок\n- пункт\n## Финансы\nБюджет\n---'))!;
    assert.deepEqual(
      r.intro.map((b) => b.text),
      ['Вступление'],
    );
    assert.deepEqual(
      r.parts.map((p) => [p.title, p.blocks.map((b) => b.type)]),
      [
        ['Бег', ['p', 'bullet']],
        ['Финансы', ['p']],
      ],
    );
  });

  test('нет h2 — по h1; один раздел или пустые — не разбивается', () => {
    assert.deepEqual(
      splitByHeadings(body('# А\nтекст\n# Б\nтекст'))!.parts.map((p) => p.title),
      ['А', 'Б'],
    );
    assert.equal(splitByHeadings(body('## А\nтекст')), null);
    assert.equal(splitByHeadings(body('## А\n## Б\nтекст')), null);
    assert.equal(splitByHeadings(body('просто текст')), null);
  });

  test('пустой раздел остаётся заголовком в исходной заметке', () => {
    const r = splitByHeadings(body('## А\nтекст\n## Пусто\n## Б\nтекст'))!;
    assert.deepEqual(
      r.parts.map((p) => p.title),
      ['А', 'Б'],
    );
    assert.ok(r.intro.some((b) => b.type === 'h2' && b.text === 'Пусто'));
  });

  test('название раздела для ссылки: без скобок и черты', () => {
    assert.equal(linkableTitle('План [[2026]] | итог'), 'План 2026 итог');
  });
});

describe('заметка дня', () => {
  test('название и день недели', () => {
    assert.equal(dailyTitle('2026-10-15'), '15 октября 2026');
    assert.equal(dailyTitle('2027-01-01'), '1 января 2027');
    assert.equal(weekdayOf('2026-10-15'), 'Четверг');
    assert.equal(prevYmd('2026-03-01'), '2026-02-28');
    assert.equal(prevYmd('2027-01-01'), '2026-12-31');
  });

  test('шаблон: задачи — [[ссылками]], без повторов; цели; разделы; прошлая запись', () => {
    const b = dailyBlocks({ ymd: '2026-10-15', tasks: ['Купить билеты', 'Купить билеты', 'Странная [задача]'], goals: ['Полумарафон'], prev: '14 октября 2026' });
    assert.equal(b[0].text, 'Четверг · прошлая запись: [[14 октября 2026]]');
    assert.deepEqual(
      b.filter((x) => x.type === 'h2').map((x) => x.text),
      [DAILY_SECTIONS.tasks, DAILY_SECTIONS.thoughts, DAILY_SECTIONS.results],
    );
    assert.deepEqual(
      b.filter((x) => x.type === 'bullet').map((x) => x.text),
      ['[[Купить билеты]]', 'Странная [задача]', '🎯 срок: [[Полумарафон]]'],
    );
    assert.equal(new Set(b.map((x) => x.id)).size, b.length);
  });

  test('без задач — пустой пункт, без прошлой — только день недели', () => {
    const b = dailyBlocks({ ymd: '2026-10-15', tasks: [] });
    assert.equal(b[0].text, 'Четверг');
    assert.deepEqual([b[2].type, b[2].text], ['bullet', '']);
  });
});

describe('заметка дня в связях', async () => {
  const { noteDoc } = await import('../src/notes/brainDocs.ts');
  const day = (ymd: string, prev: string | undefined, extra: string[]): NoteBody => ({
    title: dailyTitle(ymd),
    updatedAt: 1,
    blocks: [...dailyBlocks({ ymd, tasks: [], prev }), ...extra.map((t, i) => ({ id: 'x' + i, type: 'p' as const, text: t }))],
  });

  test('без названия-даты, шаблона и строки «прошлая запись»; свой текст — остаётся', () => {
    const d = noteDoc(day('2026-10-15', '14 октября 2026', ['Пробежка 10 км в парке']), true);
    assert.equal(d.title, '');
    assert.deepEqual(d.headings, []);
    assert.equal(d.text, 'Пробежка 10 км в парке');
    // обычная заметка — как раньше
    assert.equal(noteDoc(day('2026-10-15', undefined, []), false).title, '15 октября 2026');
  });

  test('дни с одним шаблоном не связаны; день про бег — связан с заметками о беге', () => {
    const docs = [
      { id: 'd1', f: extractFeatures(noteDoc(day('2026-10-14', undefined, ['Купил хлеб']), true)) },
      { id: 'd2', f: extractFeatures(noteDoc(day('2026-10-15', '14 октября 2026', ['Звонил врачу']), true)) },
      { id: 'd3', f: extractFeatures(noteDoc(day('2026-10-16', '15 октября 2026', ['Длинная пробежка 18 км, пульс во второй зоне, план тренировок к полумарафону']), true)) },
      ...CORPUS.map((f) => ({ id: f.id, f: extractFeatures(f) })),
    ];
    const ix = buildIndex(docs);
    assert.ok(!relatedTo(ix, 'd1').some((r) => r.id.startsWith('d')));
    assert.ok(!relatedTo(ix, 'd2').some((r) => r.id.startsWith('d')));
    assert.ok(relatedTo(ix, 'd3').some((r) => r.id.startsWith('run-')), JSON.stringify(relatedTo(ix, 'd3')));
  });
});
