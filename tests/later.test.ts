/**
 * «Доделать, когда появится связь», вопрос дня и журнал скорости — поверх настоящих хранилищ
 * (fake-indexeddb; ИИ и сервер — заглушки).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const notes = await import('../src/notes/store.ts');
const model = await import('../src/notes/model.ts');
const tasks = await import('../src/tasks/store.ts');
const cloud = await import('../src/store/cloud.ts');
const queue = await import('../src/notes/aiQueue.ts');
const article = await import('../src/notes/article.ts');
const voice = await import('../src/voice/run.ts');
const daily = await import('../src/notes/daily.ts');
const question = await import('../src/notes/question.ts');
const qc = await import('../src/notes/questionCore.ts');
const perf = await import('../src/notes/perfLog.ts');
const { todayYmd } = await import('../src/utils/mapTasks.ts');
const ai = await import('./fixtures/aiStub.ts');

const data = () => notes.useNotes.getState().data!;
const lines = async (id: string) => (await notes.loadNoteBody(id)).blocks.map((b) => `${b.type}:${b.text ?? ''}`);
const PAGE = `<html><head><title>Сон и восстановление</title><meta property="og:site_name" content="Спорт"></head><body><article>
<p>Сон восемь часов ускоряет восстановление после длинной пробежки и снижает риск травм у бегунов.</p>
<p>Перед сном лучше не тренироваться интенсивно, а лёгкая растяжка помогает расслабиться и уснуть быстрее.</p>
<p>Дневной сон двадцать минут тоже полезен, но не позже четырёх часов дня, иначе ночью сложнее заснуть.</p>
</article></body></html>`;
let siteDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).endsWith('/web/page')) {
    if (siteDown) return new Response(JSON.stringify({ error: 'Нет связи' }), { status: 502 });
    const { url } = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ url, contentType: 'text/html; charset=utf-8', base64: Buffer.from(PAGE).toString('base64') }), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

before(async () => {
  await notes.ensureNotes();
  await tasks.ensureTasks();
  cloud.useCloud.setState({ account: { token: 't', user: { id: 'u', email: 'a@b.cd', name: 'A' } } as never });
  localStorage.removeItem('sm-ai-queue');
});

describe('доделать, когда появится связь', () => {
  test('статья: ИИ не ответил — сохранена без пересказа и ждёт; потом пересказ встаёт на место начала', async () => {
    ai.aiAnswers.push(new ai.AIError('нет сети'));
    const r = await article.saveArticle('https://sport.test/sleep');
    assert.equal(r.summary, false);
    assert.equal(queue.useAiQueue.getState().items.length, 1);
    assert.ok((await lines(r.id)).includes('h2:Начало статьи'));
    ai.aiAnswers.push('Статья о сне и восстановлении.\n\n## Главные мысли\n- Сон 8 часов ускоряет восстановление');
    const res = await queue.processQueue();
    assert.equal(res.done, 1);
    assert.match(res.messages[0], /Пересказ статьи «Сон и восстановление» готов/);
    const l = await lines(r.id);
    assert.ok(!l.includes('h2:Начало статьи'));
    assert.ok(l.includes('h2:Главные мысли'));
    assert.equal(l[0], 'p:Источник: [Спорт](https://sport.test/sleep)');
    assert.equal(queue.useAiQueue.getState().items.length, 0);
  });

  test('статью уже правили — пересказ дописывается в конец, правки не теряются', async () => {
    ai.aiAnswers.push(new ai.AIError('нет сети'));
    const r = await article.saveArticle('https://sport.test/sleep2');
    await notes.openNote(r.id);
    notes.editOpenBody((bd) => void bd.blocks.push(model.newBlock('p', { text: 'Моя заметка к статье' })));
    await notes.flushNotes();
    ai.aiAnswers.push('Кратко о сне.');
    await queue.processQueue();
    const l = await lines(r.id);
    assert.ok(l.includes('p:Моя заметка к статье'));
    assert.ok(l.includes('h2:Начало статьи'), 'исходное не тронуто');
    assert.deepEqual(l.slice(-2), ['h2:Главное от ИИ', 'p:Кратко о сне.']);
  });

  test('нет связи — попытка позже (с паузой), заметка в корзине — задача снимается', async () => {
    ai.aiAnswers.push(new ai.AIError('нет сети'));
    const r = await article.saveArticle('https://sport.test/sleep3');
    siteDown = true;
    const t0 = Date.now();
    const res = await queue.processQueue(t0);
    assert.equal(res.done, 0);
    const it = queue.useAiQueue.getState().items[0];
    assert.equal(it.tries, 1);
    assert.ok(it.next > t0, 'следующая попытка — не сразу');
    assert.equal((await queue.processQueue(t0 + 1000)).done, 0, 'до паузы не пробует');
    siteDown = false;
    notes.trashNote(r.id);
    await queue.processQueue(t0 + 3_600_000);
    assert.equal(queue.useAiQueue.getState().items.length, 0);
  });

  test('голос: длинная мысль без ИИ — слова в дневнике, потом ИИ раскладывает их на заметку и задачи', async () => {
    const LONG = 'сегодня думал про отпуск хочу в горы в августе надо до пятницы купить билеты и забронировать гостиницу а ещё спросить у Ани про палатку настроение отличное';
    ai.aiAnswers.push(new ai.AIError('нет сети'));
    const r = await voice.interpret(LONG);
    assert.deepEqual(r.actions, [{ type: 'add_journal', text: LONG, section: 'thoughts', later: true }]);
    const done = await voice.execute(r.actions[0]);
    assert.ok(done.ok);
    assert.match(done.meta!, /ИИ разберёт/);
    const dayId = daily.dailyNoteOf(todayYmd())!;
    assert.ok((await lines(dayId)).some((x) => x.endsWith('· ' + LONG)));
    assert.equal(queue.useAiQueue.getState().items[0].kind, 'dictation');
    ai.aiAnswers.push(JSON.stringify({ note: { title: 'Отпуск в горах', text: 'Август, горы' }, tasks: [{ title: 'Купить билеты' }, { title: 'Забронировать гостиницу' }], journal: 'Думал про отпуск, настроение отличное.' }));
    const res = await queue.processQueue();
    assert.match(res.messages[0], /Голосовая запись разобрана: заметка «Отпуск в горах», задач: 2/);
    assert.ok(data().notes.some((n) => n.title === 'Отпуск в горах'));
    await tasks.flushTasks();
    assert.ok(tasks.useTasks.getState().data!.tasks.some((t) => t.title === 'Купить билеты'));
    const l = await lines(dayId);
    assert.ok(l.some((x) => /^p:\d\d:\d\d · Думал про отпуск, настроение отличное\.$/.test(x)), 'сырая расшифровка заменена аккуратной записью');
    assert.ok(!l.some((x) => x.endsWith(LONG)));
  });

  test('отменили запись — из очереди тоже', async () => {
    ai.aiAnswers.push(new ai.AIError('нет сети'));
    const r = await voice.interpret('Разбери: позвонить в банк и спросить про вклад а потом записать идею про бюджет');
    const done = await voice.execute(r.actions[0]);
    assert.equal(queue.useAiQueue.getState().items.length, 1);
    await done.undo!();
    assert.equal(queue.useAiQueue.getState().items.length, 0);
  });
});

describe('вопрос дня', () => {
  const DAY = 86400000;
  const now = Date.UTC(2026, 9, 16, 8);
  const n = (id: string, age: number, words: number, extra: Partial<{ day: string; digest: boolean; trashed: number }> = {}) => ({ id, title: 'Заметка ' + id, updatedAt: now - age * DAY, wordCount: words, ...extra });

  test('выбор: давняя, содержательная, обычная; на день — постоянный; «другой» — следующая', () => {
    const list = [n('fresh', 3, 200), n('short', 60, 10), n('day', 60, 200, { day: '2026-08-01' }), n('dig', 60, 200, { digest: true }), n('bin', 60, 200, { trashed: 1 }), n('a', 30, 100), n('b', 90, 300), n('c', 200, 50)];
    const p = qc.pickQuestionNote(list, '2026-10-16', now)!;
    assert.ok(['a', 'b', 'c'].includes(p.id));
    assert.equal(qc.pickQuestionNote(list, '2026-10-16', now)!.id, p.id, 'в течение дня — та же');
    const others = new Set([0, 1, 2].map((k) => qc.pickQuestionNote(list, '2026-10-16', now, {}, k)!.id));
    assert.equal(others.size, 3, 'другой вопрос — другая заметка');
    // недавно спрашивали — пропускается
    const asked = { a: now - 5 * DAY, b: now - 5 * DAY };
    assert.equal(qc.pickQuestionNote(list, '2026-10-16', now, asked)!.id, 'c');
    assert.equal(qc.pickQuestionNote([n('fresh', 3, 200)], '2026-10-16', now), null);
  });

  test('вопрос из ответа ИИ', () => {
    assert.equal(qc.parseQuestion('Вопрос: «Ты всё ещё откладываешь 20% дохода?»'), 'Ты всё ещё откладываешь 20% дохода?');
    assert.equal(qc.parseQuestion('1. Что изменилось с планом тренировок.'), 'Что изменилось с планом тренировок?');
    assert.equal(qc.parseQuestion('ок'), null);
    assert.ok(qc.fallbackQuestion('Бюджет').includes('«Бюджет»'));
  });

  test('в приложении: вопрос от ИИ по давней заметке, ответ — в дневник и в заметку', async () => {
    const m = notes.createNote({ title: 'План накоплений', blocks: model.markdownToBlocks(Array.from({ length: 8 }, (_, i) => `Откладываю двадцать процентов дохода на подушку безопасности, шаг ${i}.`).join('\n')) })!;
    await notes.flushNotes();
    notes.mutateNotes((d) => {
      for (const x of d.notes) if (x.id !== m.id) x.trashed = x.trashed ?? 1;
      d.notes.find((x) => x.id === m.id)!.updatedAt = Date.now() - 60 * DAY;
    });
    localStorage.removeItem('sm-question-day');
    question.useQuestion.setState({ q: null });
    ai.aiAnswers.push('Ты всё ещё откладываешь двадцать процентов?');
    const q = (await question.ensureQuestion())!;
    assert.equal(q.noteId, m.id);
    assert.equal(q.question, 'Ты всё ещё откладываешь двадцать процентов?');
    assert.equal(await question.ensureQuestion(), q, 'второй раз за день — тот же, без ИИ');
    assert.ok(await question.answerQuestion('Да, и ещё десять на инвестиции', true));
    const day = await lines(daily.dailyNoteOf(todayYmd())!);
    assert.ok(day.some((x) => x.includes('❓ Ты всё ещё откладываешь двадцать процентов? — Да, и ещё десять на инвестиции')));
    assert.match((await lines(m.id)).at(-1)!, /^p:\*\*Обновление .+:\*\* Да, и ещё десять на инвестиции$/);
    assert.equal(question.useQuestion.getState().q!.state, 'answered');
  });
});

describe('журнал скорости', () => {
  test('сводка: медиана последних, «медленно» по порогу; отчёт для отправки', () => {
    perf.resetPerf();
    for (const ms of [100, 120, 9000, 110, 130]) perf.logPerf('patch', ms, 5000);
    perf.logPerf('index', 7000, 5000);
    perf.logPerf('graph', 3, 10);
    const rows = perf.perfSummary();
    const patch = rows.find((r) => r.op === 'patch')!;
    assert.equal(patch.ms, 120);
    assert.equal(patch.max, 9000);
    assert.equal(patch.slow, false);
    assert.equal(rows.find((r) => r.op === 'index')!.slow, true);
    assert.ok(!rows.some((r) => r.op === 'graph'), 'пустяки не пишутся');
    const rep = perf.perfReport('Android 14; Pixel 7, ядер: 8', 5000);
    assert.ok(rep.includes('Устройство: Android 14; Pixel 7'));
    assert.ok(rep.includes('Полная сборка индекса: 7.0 с'));
    assert.ok(rep.includes('— МЕДЛЕННО'));
    assert.equal(perf.fmtMs(450), '450 мс');
  });
});
