/**
 * Шаблоны заметок, заметка дня по своему шаблону, утренние уведомления мозга (вопрос дня и карточка,
 * ответ прямо из шторки) — поверх настоящих хранилищ (fake-indexeddb; ИИ — заглушка).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const notes = await import('../src/notes/store.ts');
const model = await import('../src/notes/model.ts');
const tasks = await import('../src/tasks/store.ts');
const cloud = await import('../src/store/cloud.ts');
const tpl = await import('../src/notes/templates.ts');
const tc = await import('../src/notes/templatesCore.ts');
const daily = await import('../src/notes/daily.ts');
const brain = await import('../src/notes/brain.ts');
const question = await import('../src/notes/question.ts');
const bn = await import('../src/notes/brainNotify.ts');
const cards = await import('../src/notes/cards.ts');
const sync = await import('../src/tasks/sync.ts');
const app = await import('../src/store/appStore.ts');
const { todayYmd, addDaysYmd } = await import('../src/utils/mapTasks.ts');
const ai = await import('./fixtures/aiStub.ts');

const DAY = 86400000;
const data = () => notes.useNotes.getState().data!;
const lines = async (id: string) => (await notes.loadNoteBody(id)).blocks.map((b) => `${b.type}:${b.text ?? ''}`);
const byName = (name: string) => tpl.listTemplates().find((n) => tc.templateName(n.title) === name)!;
const old: string[] = [];

before(async () => {
  await notes.ensureNotes();
  await tasks.ensureTasks();
  // ИИ «недоступен», пока тест сам не включит
  cloud.useCloud.setState({ account: null } as never);
  // давние содержательные заметки — для вопроса дня
  const topics = ['Подушка безопасности', 'План тренировок к марафону', 'Ремонт кухни', 'Изучение английского', 'Идеи для отпуска', 'Чтение по утрам', 'Сад и огород', 'Гитара'];
  for (const t of topics) {
    const m = notes.createNote({ title: t, blocks: model.markdownToBlocks(Array.from({ length: 6 }, (_, i) => `${t}: подробная мысль номер ${i}, с деталями и планами на будущее.`).join('\n')) })!;
    old.push(m.id);
  }
  await notes.flushNotes();
  notes.mutateNotes((d) => {
    for (const n of d.notes) if (old.includes(n.id)) n.updatedAt = Date.now() - 90 * DAY;
  });
});

describe('шаблоны', () => {
  test('готовые шаблоны: папка «Шаблоны», без повторов', async () => {
    assert.equal(tpl.listTemplates().length, 0);
    assert.equal(await tpl.addPresetTemplates(), 4);
    assert.equal(await tpl.addPresetTemplates(), 0, 'второй раз — ничего');
    const folder = data().folders.find((f) => f.name === tc.TEMPLATE_FOLDER)!;
    assert.ok(folder);
    assert.deepEqual(
      tpl.listTemplates().map((n) => tc.templateName(n.title)),
      ['Встреча', 'Заметка дня', 'Книга', 'Проект'],
    );
    assert.equal(tc.templateName(tpl.dailyTemplate()!.title), 'Заметка дня');
  });

  test('новая заметка по шаблону: название и текст заполнены, связь с шаблоном, папка — не «Шаблоны»', async () => {
    const meet = byName('Встреча');
    const work = notes.addFolder('Работа')!;
    const m = (await tpl.createFromTemplate(meet.id, { folderId: work.id, open: false }))!;
    const today = new Date();
    assert.match(m.title, new RegExp(`^Встреча ${today.getDate()} \\p{L}+ ${today.getFullYear()}$`, 'u'));
    assert.equal(m.tpl, meet.id);
    assert.equal(m.folderId, work.id);
    const l = await lines(m.id);
    assert.match(l[0], /^p:\d\d:\d\d · Участники: $/);
    assert.ok(l.includes('h2:Повестка') && l.includes('todo:'));
    const inTpl = (await tpl.createFromTemplate(meet.id, { folderId: meet.folderId, open: false }))!;
    assert.equal(inTpl.folderId, undefined, 'в папку шаблонов — нет');
    const book = (await tpl.createFromTemplate(byName('Книга').id, { open: false }))!;
    assert.equal(book.title, '', 'название без подстановок — впишете сами');
  });

  test('шаблоны не участвуют в связях и вопросе дня; Obsidian «Templates» — тоже шаблоны', async () => {
    const items = await brain.collectItems();
    const ids = new Set(items.map((i) => i.id));
    for (const t of tpl.listTemplates()) assert.ok(!ids.has(t.id), t.title);
    const f = notes.addFolder('Templates')!;
    const ob = notes.createNote({ title: 'Obsidian шаблон', folderId: f.id, blocks: model.markdownToBlocks('## {{date}}') })!;
    assert.ok(tpl.isTemplateNote(ob));
    assert.ok(tpl.listTemplates().some((n) => n.id === ob.id));
  });

  test('заметка по шаблону: в связях нет общего текста шаблона и составленного им названия', async () => {
    const meet = byName('Встреча');
    const m = (await tpl.createFromTemplate(meet.id, { open: false }))!;
    const b = await notes.loadNoteBody(m.id);
    b.blocks.find((x) => x.type === 'bullet')!.text = 'Ремонт кухни: выбрать плитку';
    b.blocks[0].text = '10:00 · Участники: Иван';
    notes.saveNoteBody(m.id, b);
    await notes.flushNotes();
    const doc = (await brain.itemText(m.id))!;
    assert.equal(doc.title, '');
    assert.deepEqual(doc.headings, []);
    assert.ok(doc.text.includes('Иван') && doc.text.includes('выбрать плитку'));
    assert.ok(!/Участники|Повестка|Решения/.test(doc.text));
  });

  test('заметка дня по своему шаблону «Заметка дня»', async () => {
    const d = tpl.dailyTemplate()!;
    const body = await notes.loadNoteBody(d.id);
    body.blocks.push(model.newBlock('h2', { text: 'Благодарность' }), model.newBlock('bullet'));
    notes.saveNoteBody(d.id, body);
    await notes.flushNotes();
    const ymd = addDaysYmd(todayYmd(), 3);
    tasks.addTask({ title: 'Сдать отчёт', date: ymd });
    const id = (await daily.ensureDailyNote(ymd))!;
    const meta = data().notes.find((n) => n.id === id)!;
    assert.equal(meta.day, ymd);
    assert.equal(meta.tpl, d.id);
    const l = await lines(id);
    assert.ok(l.includes('bullet:[[Сдать отчёт]]'), l.join(' | '));
    assert.ok(l.includes('h2:Благодарность'));
    assert.ok(l.includes('h2:Мысли'));
    // запись в дневник находит раздел «Мысли» и в своём шаблоне
    await daily.appendToDaily('Хорошая мысль', 'thoughts', ymd);
    const after = await lines(id);
    assert.ok(after[after.indexOf('h2:Мысли') + 1].endsWith('Хорошая мысль'));
  });
});

describe('утренние уведомления мозга', () => {
  const brief = '08:00';
  const span = () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    return [from.getTime(), from.getTime() + 8 * DAY - 1] as const;
  };

  test('вопрос дня — каждый день своя давняя заметка, сразу после «Плана на день»; кнопка «Ответить» с вводом', async () => {
    localStorage.removeItem('sm-question-plan');
    localStorage.removeItem('sm-question-day');
    question.useQuestion.setState({ q: null });
    const [from, to] = span();
    const list = (await bn.planBrainNotifications(from, to, brief)).filter((x) => x.extra.brain === 'question');
    assert.equal(list.length, 7, 'на неделю вперёд');
    const notesIn = list.map((x) => x.extra.noteId);
    assert.equal(new Set(notesIn).size, 7, 'без повторов');
    assert.ok(notesIn.every((id) => old.includes(String(id))), 'только давние заметки, не шаблоны');
    for (const x of list) {
      const at = new Date(x.at);
      assert.equal(`${at.getHours()}:${at.getMinutes()}`, '8:1');
      assert.equal(x.title, '❓ Вопрос дня');
      assert.equal(x.actionTypeId, 'sm-question');
      assert.match(x.body, /^«.+» — это всё ещё так\?/);
    }
    const again = (await bn.planBrainNotifications(from, to, brief)).filter((x) => x.extra.brain === 'question');
    assert.deepEqual(again.map((x) => x.extra.noteId), notesIn, 'план не меняется');
    const answer = bn.BRAIN_ACTION_TYPES.find((t) => t.id === 'sm-question')!.actions[0];
    assert.equal(answer.input, true);
  });

  test('в приложении — тот же вопрос, что в уведомлении; ИИ готовит и завтрашний', async () => {
    const [from, to] = span();
    const plan = (await bn.planBrainNotifications(from, to, brief)).filter((x) => x.extra.brain === 'question');
    cloud.useCloud.setState({ account: { token: 't', user: { id: 'u', email: 'a@b.cd', name: 'A' } } } as never);
    ai.aiAnswers.push('Что из этого ты уже сделал?', 'А как сейчас с этим?');
    const q = (await question.ensureQuestion())!;
    assert.equal(q.noteId, plan[0].extra.noteId);
    assert.equal(q.question, 'Что из этого ты уже сделал?');
    // завтрашний — в фоне
    for (let i = 0; i < 50 && !(await question.questionPlan())[addDaysYmd(todayYmd(), 1)]?.ai; i++) await new Promise((r) => setTimeout(r, 10));
    const p2 = await question.questionPlan();
    assert.equal(p2[addDaysYmd(todayYmd(), 1)].question, 'А как сейчас с этим?');
    assert.equal(p2[addDaysYmd(todayYmd(), 1)].noteId, plan[1].extra.noteId, 'заметка та же');
    const next = (await bn.planBrainNotifications(from, to, brief)).filter((x) => x.extra.brain === 'question');
    assert.equal(next[0].body, 'Что из этого ты уже сделал?');
    assert.equal(next[1].body, 'А как сейчас с этим?');
    cloud.useCloud.setState({ account: null } as never);
  });

  test('ответ из шторки — в заметку дня; сегодняшнего уведомления больше нет', async () => {
    const day = todayYmd();
    const [from, to] = span();
    const today = (await bn.planBrainNotifications(from, to, brief)).find((x) => x.extra.brain === 'question' && x.extra.date === day)!;
    const ex = Object.fromEntries(Object.entries(today.extra).map(([k, v]) => [k, String(v)]));
    await bn.brainAction('answer', ex, 'Сделал половину, остальное в ноябре');
    const l = await lines(daily.dailyNoteOf(day)!);
    assert.ok(l.some((x) => x.includes('❓ Что из этого ты уже сделал? — Сделал половину, остальное в ноябре')), l.join(' | '));
    assert.equal(question.useQuestion.getState().q!.state, 'answered');
    assert.equal(app.useApp.getState().toast, 'Ответ записан в заметку дня');
    const after = (await bn.planBrainNotifications(from, to, brief)).filter((x) => x.extra.brain === 'question');
    assert.ok(!after.some((x) => x.extra.date === day));
    assert.equal(after.length, 6);
  });

  test('«Не сегодня» из шторки — вопрос дня откладывается', async () => {
    question.useQuestion.setState({ q: null });
    localStorage.removeItem('sm-question-day');
    const day = todayYmd();
    const p = (await question.questionPlan())[day];
    bn.brainAction('skip', { brain: 'question', date: day, noteId: p.noteId });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(question.useQuestion.getState().q?.state, 'dismissed');
    assert.equal(question.useQuestion.getState().q?.noteId, p.noteId);
  });

  test('карточка дня: вопрос в уведомлении, «✓ Помню» — оценка и следующая', async () => {
    const [from, to] = span();
    assert.ok(!(await bn.planBrainNotifications(from, to, brief)).some((x) => x.extra.brain === 'cards'), 'карточек нет — уведомления нет');
    const c1 = cards.addCard(old[0], 'Сколько месяцев в подушке?', 'Шесть')!;
    const c2 = cards.addCard(old[1], 'Длина марафона?', '42 км')!;
    const list = (await bn.planBrainNotifications(from, to, brief)).filter((x) => x.extra.brain === 'cards');
    assert.equal(list.length, 8, 'пока не повторили — и в следующие дни');
    assert.equal(list[0].extra.date, todayYmd());
    assert.equal(list[0].body, c1.q);
    assert.match(list[0].title, /Вспомните ответ · ещё 1 карточка/);
    assert.equal(new Date(list[0].at).getMinutes(), 2);
    await bn.brainAction('card-good', { brain: 'cards', cardId: c1.id, date: todayYmd() });
    const graded = data().cards!.find((c) => c.id === c1.id)!;
    assert.equal(graded.reps, 1);
    assert.ok(graded.due > todayYmd());
    assert.match(app.useApp.getState().toast!, /Следующий раз — через .+\. Ещё 1 карточка/);
    const now = (await bn.planBrainNotifications(from, to, brief)).filter((x) => x.extra.brain === 'cards');
    assert.equal(now[0].body, c2.q, 'теперь — следующая');
    assert.ok(now.every((x) => x.extra.cardId !== c1.id || String(x.extra.date) >= graded.due), 'повторённая — только когда снова пора');
    assert.match(now[0].title, /^🗂 Вспомните ответ$/);
  });

  test('«Показать ответ» — повторение с этой карточки, ответ уже открыт', async () => {
    const c2 = cards.todaysCards()[0];
    await bn.brainAction('card-show', { brain: 'cards', cardId: c2.id, date: todayYmd() }).catch(() => undefined);
    const ui = cards.useCardsUi.getState();
    assert.equal(ui.review, true);
    assert.equal(ui.first, c2.id);
    assert.equal(ui.flipped, true);
    cards.closeCards();
  });

  test('настройки: выключить вопрос или карточки', async () => {
    const [from, to] = span();
    bn.setBrainNotify({ question: false });
    let list = await bn.planBrainNotifications(from, to, brief);
    assert.ok(!list.some((x) => x.extra.brain === 'question'));
    assert.ok(list.some((x) => x.extra.brain === 'cards'));
    bn.setBrainNotify({ question: true, cards: false });
    list = await bn.planBrainNotifications(from, to, brief);
    assert.ok(list.some((x) => x.extra.brain === 'question') && !list.some((x) => x.extra.brain === 'cards'));
    bn.setBrainNotify({ cards: true });
    assert.deepEqual(bn.brainNotifyPrefs(), { question: true, cards: true });
  });

  test('«План на день» выключен — в 9:01; пустой промежуток — ничего не считает', async () => {
    const [from, to] = span();
    const list = await bn.planBrainNotifications(from, to, '');
    const q = list.find((x) => x.extra.brain === 'question')!;
    assert.equal(new Date(q.at).getHours(), 9);
    const n = Date.now();
    const quiet = await bn.planBrainNotifications(n + 3 * 3600000, n + 3 * 3600000 + 15000, '23:59');
    assert.ok(quiet.length <= 1);
  });

  test('общее расписание напоминаний включает уведомления мозга', async () => {
    tasks.setPrefs({ notify: true, briefing: '07:30' });
    const [from, to] = span();
    const planned = await sync.planReminders(from, to);
    const q = planned.filter((p) => p.extra.brain === 'question');
    assert.ok(q.length >= 6);
    assert.equal(new Date(q[0].at).getHours(), 7);
    assert.equal(new Date(q[0].at).getMinutes(), 31);
    assert.ok(q.every((p) => p.extra.sm === 1 && p.id >= 1_000_000));
    assert.equal(new Set(planned.map((p) => p.id)).size, planned.length, 'id не повторяются');
  });
});
