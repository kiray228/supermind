/**
 * «Спросить у мозга», «Упоминается в» и дубли поверх настоящих хранилищ (fake-indexeddb, ИИ — заглушка).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';
import type { MindDoc, Topic } from '../src/types.ts';

const notes = await import('../src/notes/store.ts');
const model = await import('../src/notes/model.ts');
const tasks = await import('../src/tasks/store.ts');
const db = await import('../src/store/db.ts');
const rel = await import('../src/notes/related.ts');
const askMod = await import('../src/notes/brainAsk.ts');
const ment = await import('../src/notes/mentionsRuntime.ts');
const ai = await import('./fixtures/aiStub.ts');

const P = (text: string) => model.markdownToBlocks(text);
async function note(title: string, text: string) {
  const m = notes.createNote({ title, blocks: P(text) })!;
  await notes.flushNotes();
  return m.id;
}
const topic = (text: string, children: Topic[] = []): Topic => ({ id: 'tp' + Math.random(), text, children }) as Topic;
const ids: Record<string, string> = {};
const body = async (id: string) => (await notes.loadNoteBody(id)).blocks.map((b) => b.text ?? '').join('\n');

before(async () => {
  await notes.ensureNotes();
  await tasks.ensureTasks();
  ids.cushion = await note('Подушка безопасности', 'Финансовая подушка — шесть месяцев расходов. Держу на накопительном счёте под 14% годовых.');
  ids.budget = await note('Бюджет на октябрь', 'Доход 450 000. Откладываю 20%: половину в подушку безопасности, половину на брокерский счёт.');
  ids.run = await note('План тренировок', 'Три пробежки в неделю: интервалы, темповый бег и длинная пробежка по выходным.');
  ids.shoes = await note('Кроссовки', 'Для длинных пробежек — амортизация, для темповых — лёгкая модель. Пробег 600–800 км.');
  ids.trip = await note('Поездка в Стамбул', 'Билеты на май, отель у Султанахмета. Деньги на поездку беру не из подушки безопасности.');
  ids.copy = await note('Бюджет октябрь', 'Доход 460 000. Откладываю 20%: половину в подушку безопасности, половину на брокерский счёт.');
  ids.empty = notes.createNote({ title: 'Чек-лист перелёта' })!.id;
  ids.linker = await note('Сборы', 'Паспорт и страховка — см. [[Чек-лист перелёта]].');
  await db.saveDoc({ id: 'mf', title: 'Финансы', createdAt: 1, updatedAt: 2, sheets: [{ id: 's', title: 'Лист', root: topic('Финансы', [topic('Подушка безопасности на полгода расходов'), topic('Брокерский счёт')]), floating: [], relationships: [], boundaries: [], summaries: [], structure: 'map' }] } as unknown as MindDoc);
  tasks.addTask({ title: 'Пополнить подушку безопасности', notes: 'перевести 45 000 на накопительный счёт' });
  await tasks.flushTasks();
  await rel.ensureLinkIndex();
});

describe('«Спросить у мозга»', () => {
  test('вопрос → источники по смыслу → ответ со ссылками', async () => {
    ai.aiAnswers.push('Шесть месяцев расходов [1], на накопительном счёте под 14% [1]. Пополняете из бюджета [2].');
    await askMod.ask('Сколько должна быть подушка безопасности и где её держать?');
    const e = askMod.useAsk.getState().entries.at(-1)!;
    assert.equal(e.state, 'done');
    assert.equal(e.sources[0].id, ids.cushion, e.sources.map((s) => s.title).join(', '));
    assert.ok(e.sources.some((s) => s.id === 'map:mf' && s.kind === 'Карта'));
    assert.ok(e.sources.some((s) => s.kind === 'Задача'));
    assert.ok(e.a.includes('[1]'));
    // ИИ получил источники и вопрос
    const req = ai.aiRequests.at(-1)!;
    assert.ok(req.system.includes('ТОЛЬКО по источникам'));
    assert.ok(req.messages.at(-1)!.content.includes('[1] Заметка «Подушка безопасности»'));
    assert.ok(req.messages.at(-1)!.content.includes('14% годовых'));
  });

  test('уточняющий вопрос: прошлый вопрос и ответ — в беседе, поиск учитывает прошлый вопрос', async () => {
    ai.aiAnswers.push('Под 14% годовых [1].');
    await askMod.ask('а под какой процент?');
    const e = askMod.useAsk.getState().entries.at(-1)!;
    assert.equal(e.sources[0].id, ids.cushion);
    const msgs = ai.aiRequests.at(-1)!.messages;
    assert.equal(msgs[0].content, 'Сколько должна быть подушка безопасности и где её держать?');
    assert.equal(msgs[1].role, 'assistant');
  });

  test('совпадений мало — сначала синонимы от ИИ, потом ответ', async () => {
    const before = ai.aiRequests.length;
    ai.aiAnswers.push('пробежка, бег, тренировки, интервалы');
    ai.aiAnswers.push('Три пробежки в неделю [1].');
    await askMod.ask('Как часто я занимаюсь спортом?');
    const e = askMod.useAsk.getState().entries.at(-1)!;
    assert.equal(ai.aiRequests.length - before, 2, 'два запроса: синонимы и ответ');
    assert.ok(ai.aiRequests[before].system.includes('синонимы'));
    assert.equal(e.sources[0]?.id, ids.run, e.sources.map((s) => s.title).join(', '));
    assert.ok(e.sources.some((s) => s.id === ids.shoes));
  });

  test('ничего не нашлось — ИИ для ответа не вызывается', async () => {
    const before = ai.aiRequests.length;
    ai.aiAnswers.push('квантовая, физика');
    await askMod.ask('Что я знаю о квантовой хромодинамике?');
    const e = askMod.useAsk.getState().entries.at(-1)!;
    assert.equal(e.sources.length, 0);
    assert.ok(e.a.includes('ничего не нашлось'));
    assert.equal(ai.aiRequests.length - before, 1, 'только запрос синонимов');
  });

  test('ошибка ИИ — понятное сообщение в беседе', async () => {
    // сначала может быть запрос синонимов (его ошибку поиск переживает), затем — ответ
    ai.aiAnswers.push(new ai.AIError('Бесплатный ИИ на сегодня исчерпан'), new ai.AIError('Бесплатный ИИ на сегодня исчерпан'));
    await askMod.ask('Сколько я откладываю каждый месяц из дохода?');
    const e = askMod.useAsk.getState().entries.at(-1)!;
    assert.equal(e.state, 'error');
    assert.match(e.error!, /исчерпан/);
  });

  test('сломанный поиск синонимов не мешает искать как есть', async () => {
    ai.aiAnswers.push(new ai.AIError('сеть'));
    ai.aiAnswers.push('Ответ [1].');
    await askMod.ask('амортизация');
    const e = askMod.useAsk.getState().entries.at(-1)!;
    assert.equal(e.state, 'done');
    assert.equal(e.sources[0].id, ids.shoes);
  });

  test('«Начать заново» очищает беседу', () => {
    askMod.clearAsk();
    assert.equal(askMod.useAsk.getState().entries.length, 0);
  });
});

describe('«Упоминается в»', () => {
  test('кто упоминает «Подушка безопасности»: заметки, карта, задача; со фрагментом', async () => {
    const list = await ment.findBacklinks(ids.cushion);
    const byId = new Map(list.map((b) => [b.id, b]));
    assert.ok(byId.get(ids.budget)?.count === 1, JSON.stringify(list.map((b) => [b.title, b.count])));
    assert.equal(byId.get(ids.budget)!.snippet!.match, 'подушку безопасности');
    assert.ok(byId.get(ids.budget)!.at, 'у заметки — место для «Сделать ссылкой»');
    assert.ok(byId.get(ids.trip), 'и в заметке о поездке');
    assert.ok(byId.has('map:mf'));
    assert.equal(byId.get('map:mf')!.at, undefined, 'карту отсюда не правим');
    assert.ok(list.some((b) => b.kind === 'task'));
    assert.ok(!byId.has(ids.run));
  });

  test('«Сделать ссылкой» правит заметку, упоминание становится явной ссылкой', async () => {
    const b = (await ment.findBacklinks(ids.cushion)).find((x) => x.id === ids.budget)!;
    assert.ok(await ment.linkMention(ids.budget, b.at!, 'Подушка безопасности'));
    assert.ok((await body(ids.budget)).includes('[[Подушка безопасности|подушку безопасности]]'));
    await rel.ensureLinkIndex();
    const again = (await ment.findBacklinks(ids.cushion)).find((x) => x.id === ids.budget)!;
    assert.ok(again.linked);
    assert.equal(again.count, 0);
    assert.ok(rel.isWikiLink(ids.budget, ids.cushion));
  });

  test('пустая заметка, на которую ссылаются: видна ссылка оттуда', async () => {
    const list = await ment.findBacklinks(ids.empty);
    assert.deepEqual(
      list.map((b) => [b.id, b.linked]),
      [[ids.linker, true]],
    );
  });

  test('изменённый текст: «Сделать ссылкой» находит упоминание заново или честно отказывает', async () => {
    const b = (await ment.findBacklinks(ids.cushion)).find((x) => x.id === ids.trip)!;
    await notes.openNote(ids.trip);
    notes.editOpenBody((bd) => void bd.blocks.unshift(...P('Новая первая строка.')));
    await notes.flushNotes();
    assert.ok(await ment.linkMention(ids.trip, b.at!, 'Подушка безопасности'), 'блок тот же — место нашлось');
    assert.ok(notes.useNotes.getState().openBody!.blocks.some((x) => x.text?.includes('[[Подушка безопасности|подушки безопасности]]')));
    await notes.openNote(null);
    assert.equal(await ment.linkMention(ids.trip, { blockId: 'нет-такого', start: 0, end: 1 }, 'Подушка безопасности'), false);
  });
});

describe('дубли', () => {
  test('копия бюджета — дубль, остальные — нет', async () => {
    assert.deepEqual(
      ment.noteDuplicates(ids.budget).map((d) => d.id),
      [ids.copy],
    );
    assert.deepEqual(ment.noteDuplicates(ids.run), []);
    const all = await ment.allDuplicates();
    assert.equal(all.length, 1);
  });

  test('«Не дубль» — больше не предлагается (и сохраняется в синхронизируемых данных)', async () => {
    ment.markNotDuplicate(ids.budget, ids.copy);
    assert.deepEqual(ment.noteDuplicates(ids.budget), []);
    assert.deepEqual(await ment.allDuplicates(), []);
    assert.equal(notes.useNotes.getState().data!.notDup!.length, 1);
    // вернуть для следующего теста
    notes.mutateNotes((d) => void (d.notDup = []));
  });

  test('объединение: текст добавлен, копия — в корзине, ссылки на неё ведут на оставшуюся', async () => {
    const linkToCopy = await note('Ссылается на копию', 'План — в [[Бюджет октябрь]].');
    await rel.ensureLinkIndex();
    await ment.mergeNotes(ids.budget, ids.copy);
    const text = await body(ids.budget);
    assert.ok(text.includes('Доход 450 000') && text.includes('Доход 460 000'), text);
    const b = await notes.loadNoteBody(ids.budget);
    assert.ok(b.blocks.some((x) => x.type === 'divider'));
    assert.ok(b.blocks.some((x) => x.type === 'h2' && x.text === 'Бюджет октябрь'));
    assert.ok(notes.useNotes.getState().data!.notes.find((n) => n.id === ids.copy)!.trashed);
    assert.ok((await body(linkToCopy)).includes('[[Бюджет на октябрь|Бюджет октябрь]]'));
    await rel.ensureLinkIndex();
    assert.deepEqual(ment.noteDuplicates(ids.budget), []);
  });

  test('объединение в открытую заметку — через редактор (можно отменить)', async () => {
    const a = await note('Идеи подарков', 'Шарф, книга, сертификат в спа.');
    const b = await note('Подарки', 'Шарф, книга, сертификат в спа, цветы.');
    await notes.openNote(a);
    await ment.mergeNotes(a, b);
    assert.ok(notes.useNotes.getState().canUndo, 'есть шаг отмены');
    assert.ok(notes.useNotes.getState().openBody!.blocks.some((x) => x.text?.includes('цветы')));
    notes.undoOpenBody();
    assert.ok(!notes.useNotes.getState().openBody!.blocks.some((x) => x.text?.includes('цветы')));
    await notes.openNote(null);
  });
});
