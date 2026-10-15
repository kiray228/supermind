/**
 * Карточки, запись в заметку дня (голосом и из «Поделиться»), дописать в заметку — поверх настоящих хранилищ
 * (fake-indexeddb, ИИ — заглушка).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';
import { CORPUS } from './fixtures/corpus.ts';

const notes = await import('../src/notes/store.ts');
const model = await import('../src/notes/model.ts');
const tasks = await import('../src/tasks/store.ts');
const cards = await import('../src/notes/cards.ts');
const daily = await import('../src/notes/daily.ts');
const share = await import('../src/native/share.ts');
const voice = await import('../src/voice/run.ts');
const { todayYmd } = await import('../src/utils/mapTasks.ts');
const ai = await import('./fixtures/aiStub.ts');

const ids: Record<string, string> = {};
const data = () => notes.useNotes.getState().data!;
const lines = async (id: string) => (await notes.loadNoteBody(id)).blocks.map((b) => `${b.type}:${b.text ?? (b.src ? 'img' : '')}`);

before(async () => {
  await notes.ensureNotes();
  await tasks.ensureTasks();
  for (const f of CORPUS) ids[f.id] = notes.createNote({ title: f.title, blocks: model.markdownToBlocks(f.text) })!.id;
  ids.short = notes.createNote({ title: 'Коротко', blocks: model.markdownToBlocks('Три слова всего') })!.id;
  await notes.flushNotes();
});

describe('карточки', () => {
  test('ИИ делает карточки из заметки; повторный запрос знает, что уже есть', async () => {
    ai.aiAnswers.push('[{"q":"Сколько откладывать в подушку?","a":"Шесть месяцев расходов"},{"q":"Где держать подушку?","a":"На накопительном счёте"}]');
    assert.equal(await cards.makeCards(ids['fin-cushion']), 2);
    const req = ai.aiRequests.at(-1)!;
    assert.ok(req.system.includes('интервального повторения'));
    assert.ok(req.messages[0].content.includes(`Заметка «${CORPUS.find((f) => f.id === 'fin-cushion')!.title}»`));
    const list = cards.cardsOf(ids['fin-cushion']);
    assert.equal(list.length, 2);
    assert.ok(list.every((c) => c.due === todayYmd() && c.by === 'ai' && c.reps === 0));
    ai.aiAnswers.push('[{"q":"Сколько откладывать в подушку?","a":"повтор"},{"q":"Какой процент на счёте?","a":"14%"}]');
    assert.equal(await cards.makeCards(ids['fin-cushion']), 1);
    assert.ok(ai.aiRequests.at(-1)!.messages[0].content.includes('Уже есть:\n- Сколько откладывать в подушку?'));
  });

  test('мало текста — ИИ не спрашивают', async () => {
    const n = ai.aiRequests.length;
    await assert.rejects(cards.makeCards(ids.short), /мало текста/);
    assert.equal(ai.aiRequests.length, n);
  });

  test('повторение: оценка переносит карточку, отмена возвращает', async () => {
    const due = cards.todaysCards();
    assert.equal(due.length, 3);
    const c = due[0];
    const prev = cards.gradeCard(c.id, 2)!;
    assert.equal(prev.reps, 0);
    assert.equal(cards.todaysCards().length, 2);
    const after = data().cards!.find((x) => x.id === c.id)!;
    assert.ok(after.due > todayYmd());
    cards.restoreCard(prev);
    assert.equal(cards.todaysCards().length, 3);
  });

  test('своя карточка, правка, удаление', () => {
    const c = cards.addCard(ids['run-plan'], ' Сколько пробежек в неделю? ', ' Три ')!;
    assert.equal(c.q, 'Сколько пробежек в неделю?');
    assert.equal(cards.addCard(ids['run-plan'], 'Вопрос', '  '), null);
    cards.editCard(c.id, { a: 'Три: интервалы, темп, длинная' });
    assert.equal(cards.cardsOf(ids['run-plan'])[0].a, 'Три: интервалы, темп, длинная');
    cards.deleteCard(c.id);
    assert.equal(cards.cardsOf(ids['run-plan']).length, 0);
    assert.ok(data().gone![`card:${c.id}`]);
  });

  test('заметка в корзине — её карточки не показываются; удалена навсегда — карточки тоже', () => {
    const before = cards.todaysCards().length;
    notes.trashNote(ids['fin-cushion']);
    assert.equal(cards.todaysCards().length, before - 3);
    notes.restoreNote(ids['fin-cushion']);
    assert.equal(cards.todaysCards().length, before);
    notes.purgeNote(ids['fin-cushion']);
    assert.equal(cards.cardsOf(ids['fin-cushion']).length, 0);
    assert.equal(cards.todaysCards().length, before - 3);
  });

  test('карточки переживают перечитывание индекса (как после синхронизации)', async () => {
    cards.addCard(ids['run-plan'], 'Вопрос', 'Ответ');
    await notes.flushNotes();
    await notes.reloadNotes?.();
    assert.ok(cards.cardsOf(ids['run-plan']).length >= 1);
  });
});

describe('заметка дня: записи', () => {
  test('голосом: «Запиши в дневник» — в «Мысли» с временем; отмена убирает', async () => {
    const { actions } = await voice.interpret('Запиши в дневник: придумал идею для приложения');
    assert.equal(actions[0].type, 'add_journal');
    const done = await voice.execute(actions[0]);
    assert.ok(done.ok);
    const id = daily.dailyNoteOf(todayYmd())!;
    const l = await lines(id);
    const i = l.indexOf('h2:Мысли');
    assert.match(l[i + 1], /^p:\d\d:\d\d · Придумал идею для приложения$/);
    assert.equal(l[i + 2], 'h2:Итоги дня');
    await done.undo!();
    assert.ok(!(await lines(id)).some((x) => x.includes('Придумал идею')));
  });

  test('итоги дня — в свой раздел', async () => {
    const { actions } = await voice.interpret('Итоги дня: закрыл проект');
    await voice.execute(actions[0]);
    const l = await lines(daily.dailyNoteOf(todayYmd())!);
    assert.match(l.at(-1)!, /· Закрыл проект$/);
  });

  test('открытая заметка дня — запись появляется в редакторе', async () => {
    const id = daily.dailyNoteOf(todayYmd())!;
    await notes.openNote(id);
    await daily.appendToDaily('прямо в открытую');
    assert.ok(notes.useNotes.getState().openBody!.blocks.some((b) => b.text?.endsWith('· прямо в открытую')));
    notes.closeNote?.();
  });
});

describe('«Поделиться»', () => {
  test('новая заметка: название — первая строка, остальное — текст', async () => {
    await share.shareToNote({ text: 'Идея для поста\nНаписать про интервальные тренировки' });
    const m = data().notes.find((n) => n.title === 'Идея для поста')!;
    assert.deepEqual(await lines(m.id), ['p:Написать про интервальные тренировки']);
  });

  test('в заметку дня: текст одной записью, картинки — следом', async () => {
    await share.shareToDaily({ text: 'Красивый закат\nу реки' }, ['data:image/png;base64,AA']);
    const l = await lines(daily.dailyNoteOf(todayYmd())!);
    const i = l.findIndex((x) => x.endsWith('· Красивый закат у реки'));
    assert.ok(i > 0, l.join(' | '));
    assert.equal(l[i + 1], 'image:img');
  });

  test('дописать в заметку: подсказки по словам текста, текст — в конец', async () => {
    const s = await share.suggestNotes('длинная пробежка по выходным и темповый бег');
    assert.ok(s.length > 0 && s.length <= 3);
    const top = s[0];
    assert.ok(CORPUS.some((f) => ids[f.id] === top.id && f.topic === CORPUS.find((x) => x.id === 'run-plan')!.topic), top.title);
    await share.shareAppend(top.id, { text: 'Статья: как бегать медленно' });
    assert.equal((await lines(top.id)).at(-1), 'p:Статья: как бегать медленно');
    // без слов — недавние заметки (не заметки дня)
    const recent = await share.suggestNotes('https://example.com');
    assert.equal(recent.length, 3);
    assert.ok(recent.every((r) => !data().notes.find((n) => n.id === r.id)!.day));
  });
});
