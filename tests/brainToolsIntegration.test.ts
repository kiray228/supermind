/**
 * Заметка дня, конспект темы и обзор мозга поверх настоящих хранилищ (fake-indexeddb, ИИ — заглушка).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';
import { CORPUS } from './fixtures/corpus.ts';

const notes = await import('../src/notes/store.ts');
const model = await import('../src/notes/model.ts');
const tasks = await import('../src/tasks/store.ts');
const rel = await import('../src/notes/related.ts');
const daily = await import('../src/notes/daily.ts');
const digest = await import('../src/notes/digest.ts');
const review = await import('../src/notes/brainReview.ts');
const ment = await import('../src/notes/mentionsRuntime.ts');
const { todayYmd } = await import('../src/utils/mapTasks.ts');
const ai = await import('./fixtures/aiStub.ts');

const ids: Record<string, string> = {};
const data = () => notes.useNotes.getState().data!;
const text = async (id: string) => (await notes.loadNoteBody(id)).blocks.map((b) => b.text ?? '').join('\n');

before(async () => {
  await notes.ensureNotes();
  await tasks.ensureTasks();
  for (const f of CORPUS) {
    const m = notes.createNote({ title: f.title, blocks: model.markdownToBlocks(f.text) })!;
    ids[f.id] = m.id;
  }
  await notes.flushNotes();
  tasks.addTask({ title: 'Купить билеты в Стамбул', date: todayYmd() });
  tasks.addTask({ title: 'Позвонить маме', date: '2020-01-01' });
  tasks.addTask({ title: 'Через месяц', date: '2099-01-01' });
  await tasks.flushTasks();
  await rel.ensureLinkIndex();
});

describe('заметка дня', () => {
  test('создаётся по шаблону в «Дневнике»: задачи дня и просроченные — ссылками', async () => {
    const id = (await daily.ensureDailyNote())!;
    const meta = data().notes.find((n) => n.id === id)!;
    assert.equal(meta.day, todayYmd());
    assert.equal(data().folders.find((f) => f.id === meta.folderId)?.name, 'Дневник');
    const t = await text(id);
    assert.ok(t.includes('[[Купить билеты в Стамбул]]'), t);
    assert.ok(t.includes('[[Позвонить маме]]'), 'просроченные — тоже');
    assert.ok(!t.includes('Через месяц'));
    assert.ok(t.includes('Мысли') && t.includes('Итоги дня'));
  });

  test('повторно — та же заметка; другой день — новая, со ссылкой на прошлую; папка одна', async () => {
    const a = await daily.ensureDailyNote();
    assert.equal(await daily.ensureDailyNote(), a);
    const next = (await daily.ensureDailyNote('2099-01-01'))!;
    assert.notEqual(next, a);
    const t = await text(next);
    assert.ok(t.includes('[[Через месяц]]'));
    assert.ok(new RegExp(`прошлая запись: \\[\\[${data().notes.find((n) => n.id === a)!.title}\\]\\]`).test(t), t);
    assert.equal(data().folders.filter((f) => f.name === 'Дневник').length, 1);
    assert.equal(daily.dailyNoteOf('2099-01-01'), next);
    assert.equal(daily.dailyNotes().size, 2);
  });

  test('одновременные нажатия — одна заметка', async () => {
    const [x, y] = await Promise.all([daily.ensureDailyNote('2098-05-05'), daily.ensureDailyNote('2098-05-05')]);
    assert.equal(x, y);
    assert.equal(data().notes.filter((n) => n.day === '2098-05-05').length, 1);
  });

  test('удалённая в корзину — создаётся заново; копия не становится заметкой дня', async () => {
    const id = (await daily.ensureDailyNote('2097-02-02'))!;
    notes.trashNote(id);
    const again = await daily.ensureDailyNote('2097-02-02');
    assert.notEqual(again, id);
    const copy = (await notes.duplicateNote(again!))!;
    assert.equal(copy.day, undefined);
    assert.equal(daily.dailyNoteOf('2097-02-02'), again);
  });
});

describe('конспект темы', () => {
  test('темы мозга: от больших к маленьким, записи темы — одной темы корпуса', async () => {
    const topics = await digest.brainTopics();
    assert.ok(topics.length >= 2, topics.map((t) => t.name).join(', '));
    for (let i = 1; i < topics.length; i++) assert.ok(topics[i - 1].ids.length >= topics[i].ids.length);
    const byId = new Map(CORPUS.map((f) => [ids[f.id], f.topic]));
    // заметки дня (цепочка «прошлая запись» и общий шаблон) не образуют своей темы
    const dayIds = new Set(data().notes.filter((n) => n.day).map((n) => n.id));
    assert.ok(topics.every((t) => t.ids.filter((id) => dayIds.has(id)).length < 2), 'дни не склеиваются');
    for (const t of topics) {
      const kinds = t.ids.map((id) => byId.get(id)).filter(Boolean);
      if (!kinds.length) continue;
      const main = kinds.filter((k) => k === kinds[0]).length;
      assert.ok(main / kinds.length >= 0.6, `${t.name}: ${kinds.join(', ')}`);
    }
  });

  test('ИИ получает записи темы; конспект сохраняется заметкой со [[ссылками]]', async () => {
    const topics = await digest.brainTopics();
    const fin = topics.find((t) => t.ids.some((id) => CORPUS.some((f) => ids[f.id] === id)))!;
    assert.ok(fin);
    ai.aiAnswers.push('## Главное\n- Откладывать 20% дохода [1].\n- Подушка — шесть месяцев [2, 3].');
    digest.openDigest(fin.name, fin.ids);
    for (let i = 0; i < 100 && digest.useDigest.getState().state !== 'done'; i++) await new Promise((r) => setTimeout(r, 10));
    const st = digest.useDigest.getState();
    assert.equal(st.state, 'done', st.error);
    assert.ok(st.sources.length >= 2);
    const req = ai.aiRequests.at(-1)!;
    assert.ok(req.messages[0].content.includes(`Тема: ${fin.name}`));
    assert.ok(req.messages[0].content.includes('[1] Заметка'));
    const id = (await digest.saveDigest(false))!;
    const meta = data().notes.find((n) => n.id === id)!;
    assert.equal(meta.title, `Конспект: ${fin.name}`);
    const t = await text(id);
    assert.ok(t.includes(`([[${st.sources[0].title}]])`), t);
    assert.ok(t.includes('Источники'));
    // второй конспект той же темы — с датой в названии
    assert.notEqual(digest.digestTitle(fin.name), meta.title);
    // конспект связан с записями темы явными ссылками
    await rel.ensureLinkIndex();
    assert.ok(rel.isWikiLink(id, st.sources[0].id));
    // конспект пересказывает источники, но дублем их не считается
    assert.equal(meta.digest, true);
    assert.deepEqual(ment.noteDuplicates(id), []);
    assert.ok(!(await ment.allDuplicates()).some((p) => p.a === id || p.b === id));
    // следующий конспект темы не пересказывает прошлый
    const srcs = await digest.digestSources(fin.name, [id, ...fin.ids]);
    assert.ok(!srcs.some((s) => s.id === id));
    digest.closeDigest();
  });

  test('ошибка ИИ — понятная, без сохранения', async () => {
    ai.aiAnswers.push(new ai.AIError('Нет сети'));
    digest.openDigest('Бег', [ids['run-plan'], ids['run-log']]);
    for (let i = 0; i < 100 && digest.useDigest.getState().state !== 'error'; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(digest.useDigest.getState().error, 'Нет сети');
    assert.equal(await digest.saveDigest(false), null);
    digest.closeDigest();
  });

  test('тема без текста — ИИ не спрашивают', async () => {
    const before = ai.aiRequests.length;
    digest.openDigest('Пусто', ['нет-такой']);
    for (let i = 0; i < 100 && digest.useDigest.getState().state !== 'error'; i++) await new Promise((r) => setTimeout(r, 10));
    assert.match(digest.useDigest.getState().error!, /нет текста/);
    assert.equal(ai.aiRequests.length, before);
  });
});

describe('обзор мозга', () => {
  test('без связей, забытые, темы; длинная заметка с разделами', async () => {
    const lonely = notes.createNote({ title: 'Квантовая хромодинамика', blocks: model.markdownToBlocks('Глюоны и кварки, цветовой заряд, асимптотическая свобода, конфайнмент адронов, решёточные вычисления.') })!.id;
    const long = notes.createNote({
      title: 'Всё про осень',
      blocks: model.markdownToBlocks(['Вступление.', '## Поход', 'Палатка и спальник. '.repeat(120), '## Урожай', 'Яблоки и груши в саду. '.repeat(120)].join('\n')),
    })!.id;
    await notes.flushNotes();
    // давно не открывали «Подушку безопасности», а бюджет меняли сегодня
    const old = Date.now() - 60 * 86400000;
    notes.mutateNotes((d) => {
      for (const n of d.notes) if (n.id !== ids['fin-budget'] && n.id !== lonely && n.id !== long && !n.day) n.updatedAt = Math.min(n.updatedAt, old);
    });
    await rel.ensureLinkIndex();
    const r = await review.collectReview();
    assert.ok(r.orphans.includes(lonely), 'заметка без связей');
    assert.ok(r.forgotten.some((f) => f.via === ids['fin-budget']), JSON.stringify(r.forgotten));
    assert.ok(r.long.some((l) => l.id === long && l.parts === 2), JSON.stringify(r.long));
    assert.ok(r.topics.length >= 2);
    assert.ok(review.reviewCount(r) >= 3);
  });

  test('разбить: разделы — новые заметки в той же папке, в исходной — ссылки', async () => {
    const long = data().notes.find((n) => n.title === 'Всё про осень')!;
    const before = data().notes.length;
    assert.equal(await review.splitNote(long.id), 2);
    assert.equal(data().notes.length, before + 2);
    const t = await text(long.id);
    assert.ok(t.startsWith('Вступление.'));
    assert.ok(t.includes('[[Поход]]') && t.includes('[[Урожай]]'));
    assert.ok(!t.includes('Палатка'));
    const part = data().notes.find((n) => n.title === 'Поход')!;
    assert.equal(part.folderId, long.folderId);
    assert.ok((await text(part.id)).includes('Палатка и спальник'));
    // разбивать больше нечего
    assert.equal(await review.splitNote(long.id), 0);
  });

  test('название раздела уже занято — уточняется названием заметки', async () => {
    const id = notes.createNote({ title: 'Ещё', blocks: model.markdownToBlocks('## Поход\nтекст про поход\n## Новое\nещё текст') })!.id;
    await notes.flushNotes();
    assert.equal(await review.splitNote(id), 2);
    assert.ok(data().notes.some((n) => n.title === 'Поход (Ещё)'));
  });

  test('напоминание раз в неделю', () => {
    localStorage.removeItem('sm-brain-review-at');
    const now = Date.now();
    assert.equal(review.reviewDue(now), false, 'сразу после установки — нет');
    assert.equal(review.reviewDue(now + 2 * 86400000), true, 'через неделю после первого запуска');
    review.markReviewSeen(now);
    assert.equal(review.reviewDue(now + 6 * 86400000), false);
    assert.equal(review.reviewDue(now + 7 * 86400000), true);
  });
});
