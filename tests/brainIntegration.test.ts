/**
 * Интеграция «второго мозга» поверх настоящих хранилищ (IndexedDB — fake-indexeddb):
 * заметки, карты, задачи и цели → индекс связей → [[ссылки]], упоминания, проверка ИИ, синхронизация.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';
import type { MindDoc, Topic } from '../src/types.ts';

const notes = await import('../src/notes/store.ts');
const model = await import('../src/notes/model.ts');
const tasks = await import('../src/tasks/store.ts');
const goals = await import('../src/goals/store.ts');
const db = await import('../src/store/db.ts');
const kv = await import('../src/store/kv.ts');
const rel = await import('../src/notes/related.ts');
const links = await import('../src/notes/links.ts');
const review = await import('../src/notes/aiReview.ts');
const ai = await import('./fixtures/aiStub.ts');
const { mergeValues } = await import('../src/store/merge.ts');

const P = (text: string) => model.markdownToBlocks(text);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let tn = 0;
const topic = (text: string, children: Topic[] = []): Topic => ({ id: 'tp' + tn++, text, children }) as Topic;
const map = (id: string, title: string, root: Topic, extra: Partial<MindDoc> = {}): MindDoc =>
  ({ id, title, createdAt: 1, updatedAt: 2, sheets: [{ id: 's', title: 'Лист', root, floating: [], relationships: [], boundaries: [], summaries: [], structure: 'map', themeId: 'classic' }], ...extra }) as unknown as MindDoc;

/** создать заметку с текстом и дождаться записи */
async function note(title: string, text: string, folderId?: string) {
  const m = notes.createNote({ title, blocks: P(text), folderId })!;
  await notes.flushNotes();
  return m.id;
}
const related = (id: string) => links.relatedTo(rel.linkIndex()!, id).map((r) => r.id);

const ids: Record<string, string> = {};

before(async () => {
  await notes.ensureNotes();
  await tasks.ensureTasks();
  await goals.ensureGoals();
  ids.trip = await note('Поездка в Японию', 'Билеты до Токио, отель в Киото. Проездной JR Pass на 7 дней. Подробности — в карте [[Япония]].');
  ids.food = await note('Еда в Японии', 'Рамен в Токио, суши в Киото, матча. Проездной JR Pass помогает ездить по стране.');
  ids.budget = await note('Бюджет на октябрь', 'Доход, расходы, подушка безопасности. Откладываю на брокерский счёт.');
  ids.cushion = await note('Подушка безопасности', 'Финансовая подушка — шесть месяцев расходов. Пополняю из бюджета.');
  ids.serial = await note('Сериал «Подушка безопасности»', 'Детектив про автомобильную компанию, которая скрывала брак подушек безопасности. Актёры отличные.');
  ids.borsch = await note('Рецепт борща', 'Свёкла, капуста, картофель, говядина.');
  await db.saveDoc(map('m1', 'Япония', topic('Япония', [topic('Токио', [topic('Сибуя')]), topic('Киото', [topic('Храмы')]), topic('JR Pass проездной')])));
  // карту закрыли паролем: на диске — только шифр
  await db.saveDoc(map('m2', 'Секретная карта', topic('Япония Токио Киото')));
  await db.saveLocked({ id: 'm2', locked: true, salt: 's', iv: 'i', data: 'зашифровано', updatedAt: 5 }, 'Секретная карта');
  const t = tasks.addTask({ title: 'Купить JR Pass', notes: 'проездной по Японии на 7 дней, Токио — Киото' })!;
  ids.task = 'task:' + t.id;
  const g = goals.addGoal({ title: 'Выучить японский', why: 'для поездки в Японию и Токио' })!;
  ids.goal = 'goal:' + g.id;
  await tasks.flushTasks();
  await goals.flushGoals();
  await rel.ensureLinkIndex();
});

describe('все единицы мозга в одном индексе', () => {
  test('заметки, карта, задача и цель собраны; защищённая паролем карта — нет', () => {
    const kinds = new Map(rel.brainItems().map((i) => [i.id, i.kind]));
    assert.equal(kinds.get(ids.trip), 'note');
    assert.equal(kinds.get('map:m1'), 'map');
    assert.equal(kinds.get(ids.task), 'task');
    assert.equal(kinds.get(ids.goal), 'goal');
    assert.ok(!kinds.has('map:m2'), 'карта под паролем не анализируется');
  });

  test('заметка о поездке связана с картой, задачей и соседней заметкой', () => {
    const r = related(ids.trip);
    assert.ok(r.includes('map:m1'), r.join(', '));
    assert.ok(r.includes(ids.task), r.join(', '));
    assert.ok(r.includes(ids.food), r.join(', '));
    assert.ok(!r.includes(ids.borsch));
  });

  test('[[Япония]] — явная ссылка на карту', () => {
    assert.ok(rel.isWikiLink(ids.trip, 'map:m1'));
    assert.ok(rel.isWikiLink('map:m1', ids.trip), 'в обе стороны');
    const r = links.relatedTo(rel.linkIndex()!, ids.trip).find((x) => x.id === 'map:m1')!;
    assert.ok(r.confirmed);
  });

  test('поиск по названию: регистр и «ё» не важны', () => {
    assert.equal(rel.itemByTitle('япония')?.id, 'map:m1');
    assert.equal(rel.itemByTitle('ПОДУШКА БЕЗОПАСНОСТИ')?.id, ids.cushion, 'заметка раньше сериала с похожим названием');
    assert.equal(rel.itemByTitle('нет такого'), undefined);
  });

  test('упоминания: названия заметок, карт и целей находятся в тексте', () => {
    const mx = rel.useLinks.getState().mentions!;
    const t = 'Еду в Японию, хочу выучить японский. Подушка безопасности на месте. Купить JR Pass.';
    const found = links.findMentions(t, mx).map((m) => [t.slice(m.start, m.end), m.id]);
    assert.ok(found.some(([s, id]) => s === 'Подушка безопасности' && id === ids.cushion), JSON.stringify(found));
    assert.ok(found.some(([s, id]) => s === 'выучить японский' && id === ids.goal), JSON.stringify(found));
    assert.ok(!found.some(([, id]) => id === ids.food), '«Еду в Японию» — не заметка «Еда в Японии»');
    assert.ok(!found.some(([, id]) => id === ids.task), 'названия задач не подсвечиваются');
    // «Япония» встречается почти везде — однословное название такой частоты не подсвечивается
    assert.ok(!found.some(([, id]) => id === 'map:m1'));
  });
});

describe('изменения подхватываются', () => {
  test('правка заметки: признаки пересчитываются, связь появляется', async () => {
    assert.ok(!related(ids.borsch).includes(ids.food));
    await notes.openNote(ids.borsch);
    notes.editOpenBody((b) => void b.blocks.push(...P('А ещё рамен как в Токио и суши, как в Киото — по рецепту из поездки по Японии.')));
    await notes.flushNotes();
    await notes.openNote(null);
    await rel.ensureLinkIndex();
    assert.ok(related(ids.borsch).includes(ids.food), related(ids.borsch).join(', '));
  });

  test('корзина: заметка пропадает из связей и возвращается после восстановления', async () => {
    notes.trashNote(ids.food);
    await rel.ensureLinkIndex();
    assert.ok(!related(ids.trip).includes(ids.food));
    assert.ok(!rel.brainItems().some((i) => i.id === ids.food));
    notes.restoreNote(ids.food);
    await rel.ensureLinkIndex();
    assert.ok(related(ids.trip).includes(ids.food));
  });

  test('новая задача в другом разделе — в индексе после пересборки', async () => {
    const t = tasks.addTask({ title: 'Оформить страховку для поездки в Японию', notes: 'Токио, Киото, перелёт' })!;
    await rel.ensureLinkIndex();
    assert.ok(rel.brainItems().some((i) => i.id === 'task:' + t.id));
    assert.ok(related(ids.trip).includes('task:' + t.id) || related('task:' + t.id).includes(ids.trip));
  });

  test('удалённая навсегда заметка уходит и из кэша признаков', async () => {
    const id = await note('Временная', 'одноразовая заметка про японский рамен в Токио');
    await rel.ensureLinkIndex();
    assert.ok(rel.rawFeatures(id));
    notes.purgeNote(id);
    await rel.ensureLinkIndex();
    assert.equal(rel.rawFeatures(id), undefined);
  });

  test('ничего не изменилось — индекс тот же (без пересборки)', async () => {
    const a = await rel.ensureLinkIndex();
    const b = await rel.ensureLinkIndex();
    assert.equal(a, b);
  });

  test('одновременные запросы не ломают сборку', async () => {
    const all = await Promise.all([rel.ensureLinkIndex(), rel.ensureLinkIndex(), rel.ensureLinkIndex()]);
    assert.equal(all[0], all[2]);
  });
});

describe('проверка связей ИИ поверх настоящего хранилища', () => {
  test('случайная связь (сериал и финансовая подушка) убирается, правка слов сохраняется', async () => {
    const before = related(ids.serial);
    assert.ok(before.includes(ids.cushion), 'алгоритм связал по названию: ' + before.join(', '));
    ai.aiAnswers.push(
      JSON.stringify({
        keywords: [{ n: 1, keep: true }],
        missing: ['автомобильную компанию'],
        links: before.map((_, i) => ({ n: i + 1, ok: false, why: 'Автоподушки, а не финансы' })),
      }),
    );
    const res = await review.reviewNote(ids.serial);
    assert.ok(res.rejected.some((r) => r.id === ids.cushion));
    await rel.ensureLinkIndex();
    assert.ok(!related(ids.serial).includes(ids.cushion), related(ids.serial).join(', '));
    assert.ok(!related(ids.cushion).includes(ids.serial), 'и с другой стороны');
    const d = notes.useNotes.getState().data!;
    assert.deepEqual(d.aiTerms!.find((r) => r.id === ids.serial)!.add, ['автомобильную компанию']);
    assert.equal(review.reviewState(ids.serial)?.stale, false);
    // запрос к ИИ: текст заметки и кандидаты
    const req = ai.aiRequests.at(-1)!;
    assert.ok(req.messages[0].content.includes('Детектив про автомобильную компанию'));
    assert.ok(req.messages[0].content.includes('«Подушка безопасности»'));
  });

  test('«Отменить проверку» возвращает связи', async () => {
    ai.aiAnswers.push(JSON.stringify({ links: [{ n: 1, ok: false }] }));
    const first = links.relatedTo(rel.linkIndex()!, ids.budget, { raw: true, loose: true, min: 0.015 })[0].id;
    const res = await review.reviewNote(ids.budget);
    await rel.ensureLinkIndex();
    assert.ok(!related(ids.budget).includes(first));
    res.undo();
    await rel.ensureLinkIndex();
    assert.ok(res.rejected.some((r) => r.id === first), 'первый кандидат был связан и убран');
    assert.ok(related(ids.budget).includes(first), 'после отмены связь вернулась');
    assert.equal(review.reviewState(ids.budget), null, 'проверки как не было');
  });

  test('решение человека ИИ не меняет', async () => {
    review.setLinkVerdict(ids.serial, ids.cushion, true);
    await rel.ensureLinkIndex();
    assert.ok(related(ids.serial).includes(ids.cushion));
    ai.aiAnswers.push(JSON.stringify({ links: [{ n: 1, ok: false }, { n: 2, ok: false }, { n: 3, ok: false }] }));
    await review.reviewNote(ids.serial);
    await rel.ensureLinkIndex();
    assert.ok(related(ids.serial).includes(ids.cushion), 'осталась связь, которую вернул человек');
    const v = notes.useNotes.getState().data!.aiLinks!.find((r) => r.id === links.pairKey(ids.serial, ids.cushion))!;
    assert.equal(v.by, 'user');
    review.setLinkVerdict(ids.serial, ids.cushion, null);
    await rel.ensureLinkIndex();
  });

  test('явную [[ссылку]] ИИ не трогает', async () => {
    ai.aiAnswers.push(JSON.stringify({ links: [] }));
    await review.reviewNote(ids.trip);
    const req = ai.aiRequests.at(-1)!.messages[0].content;
    const candidates = req.slice(req.indexOf('Заметки-кандидаты'));
    assert.ok(!candidates.includes('Карта «Япония»'), candidates);
    assert.ok(rel.isWikiLink(ids.trip, 'map:m1'));
  });

  test('кандидаты для ИИ подписаны типом: «Карта», «Задача», «Цель»', async () => {
    ai.aiAnswers.push(JSON.stringify({ links: [] }));
    await review.reviewNote(ids.food);
    const req = ai.aiRequests.at(-1)!.messages[0].content;
    assert.ok(/Карта «|Задача «|Цель «/.test(req), req);
  });

  test('ошибка ИИ и непонятный ответ — понятные ошибки, ничего не меняется', async () => {
    const before = JSON.stringify(notes.useNotes.getState().data!.aiLinks);
    ai.aiAnswers.push(new ai.AIError('Бесплатный ИИ на сегодня исчерпан'));
    await assert.rejects(() => review.reviewNote(ids.food), /исчерпан/);
    ai.aiAnswers.push('Извините, не могу');
    await assert.rejects(() => review.reviewNote(ids.food), review.ReviewError);
    assert.equal(JSON.stringify(notes.useNotes.getState().data!.aiLinks), before);
  });

  test('заметка без текста — проверять нечего', async () => {
    const id = notes.createNote({ title: '' })!.id;
    await assert.rejects(() => review.reviewNote(id), /мало текста/);
  });

  test('массовая проверка берёт только непроверенные и изменённые', async () => {
    const list = await review.notesToReview([ids.serial, ids.borsch, 'map:m1']);
    assert.ok(!list.includes(ids.serial), 'уже проверена и не менялась');
    assert.ok(list.includes(ids.borsch));
    assert.ok(!list.includes('map:m1'), 'карты ИИ не проверяет');
  });
});

describe('хранилище заметок: гонки', () => {
  test('новая заметка с названием сразу открывается с названием (тело ещё пишется)', async () => {
    const m = notes.createNote({ title: 'Чек-лист перелёта' })!;
    const body = await notes.loadNoteBody(m.id);
    assert.equal(body.title, 'Чек-лист перелёта');
    await notes.openNote(m.id);
    assert.equal(notes.useNotes.getState().openBody?.title, 'Чек-лист перелёта');
    await notes.openNote(null);
  });

  test('flushNotes дожидается записей, которые уже идут', async () => {
    const m = notes.createNote({ title: 'Сразу на диск', blocks: P('текст') })!;
    await notes.flushNotes();
    const saved = await kv.get<{ title: string }>('note:' + m.id);
    assert.equal(saved?.title, 'Сразу на диск');
  });
});

describe('синхронизация решений ИИ между устройствами', () => {
  test('решения по разным парам с двух устройств сливаются, свежее побеждает', () => {
    const local = { version: 1, notes: [], folders: [], aiLinks: [{ id: 'a|b', ok: false, by: 'ai', updatedAt: 10 }, { id: 'c|d', ok: true, by: 'user', updatedAt: 30 }], aiTerms: [{ id: 'a', at: 1, drop: ['x'], add: [], checkedAt: 1, updatedAt: 5 }] };
    const remote = { version: 1, notes: [], folders: [], aiLinks: [{ id: 'a|b', ok: true, by: 'user', updatedAt: 20 }, { id: 'e|f', ok: false, by: 'ai', updatedAt: 15 }], aiTerms: [{ id: 'a', at: 1, drop: [], add: ['y'], checkedAt: 2, updatedAt: 9 }] };
    const m = mergeValues('notes', local, remote) as typeof local;
    const byId = new Map(m.aiLinks.map((r) => [r.id, r]));
    assert.equal(byId.size, 3);
    assert.equal(byId.get('a|b')!.by, 'user', 'свежее решение человека с другого устройства');
    assert.deepEqual(m.aiTerms[0].add, ['y']);
  });

  test('отменённая проверка не возвращается с другого устройства', () => {
    const local = { version: 1, notes: [], folders: [], aiTerms: [], gone: { 'aiTerm:a': 50 } };
    const remote = { version: 1, notes: [], folders: [], aiTerms: [{ id: 'a', at: 1, drop: [], add: [], checkedAt: 1, updatedAt: 40 }] };
    const m = mergeValues('notes', local, remote) as { aiTerms: unknown[] };
    assert.equal(m.aiTerms.length, 0);
  });

  test('решения ИИ попадают в сохранённый индекс заметок', async () => {
    await notes.flushNotes();
    const saved = await kv.get<{ aiLinks?: unknown[]; aiTerms?: unknown[] }>('notes');
    assert.ok(saved?.aiTerms?.length);
  });
});

describe('кэш признаков', () => {
  test('сохраняется на устройстве (версия 2), не синхронизируется', async () => {
    await sleep(3300);
    const c = await kv.get<{ v: number; items: Record<string, unknown> }>('cache:links');
    assert.equal(c?.v, 2);
    assert.ok(c!.items[ids.trip] && c!.items['map:m1'] && c!.items[ids.task]);
    assert.equal(kv.isSynced('cache:links'), false);
  });
});
