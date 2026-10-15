/** Длинная голосовая мысль → заметка, задачи, запись в дневник (ИИ — заглушка; хранилища — fake-indexeddb) */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const { forcedSplit, isLongDictation, parseSplit, buildSplitPrompt, SPLIT_SYSTEM } = await import('../src/voice/dictation.ts');
const voice = await import('../src/voice/run.ts');
const notes = await import('../src/notes/store.ts');
const tasks = await import('../src/tasks/store.ts');
const cloud = await import('../src/store/cloud.ts');
const daily = await import('../src/notes/daily.ts');
const { todayYmd } = await import('../src/utils/mapTasks.ts');
const ai = await import('./fixtures/aiStub.ts');

const LONG = 'слушай сегодня был тяжёлый день но интересный придумал идею для приложения чтобы карточки делались из всей темы сразу а ещё завтра в десять надо позвонить врачу и купить кроссовки до пятницы устал но доволен';

describe('разбор: когда и как', () => {
  test('«Разбери: …» — явно; длинная мысль — сама; короткая команда — нет', () => {
    assert.equal(forcedSplit('Разбери: завтра позвонить маме'), 'завтра позвонить маме');
    assert.equal(forcedSplit('разложи это — идея и дела'), 'идея и дела');
    assert.equal(forcedSplit('Разбери:'), null);
    assert.equal(forcedSplit('Купить хлеб'), null);
    assert.ok(isLongDictation(LONG));
    assert.ok(!isLongDictation('Купить хлеб завтра в 9'));
    assert.ok(!isLongDictation('Потратил 2000 на такси и 3500 на обед'));
    assert.ok(isLongDictation('Встретился с Аней. Обсудили проект по бегу. Решили запускать в мае. Надо подготовить план.'));
  });

  test('запрос: дата, день недели и время — чтобы «завтра» стало датой', () => {
    const p = buildSplitPrompt('текст', new Date(2026, 9, 15, 9, 5));
    assert.ok(p.startsWith('Сегодня 2026-10-15 (четверг), сейчас 09:05.'));
    assert.ok(p.endsWith('Запись:\nтекст'));
    assert.ok(SPLIT_SYSTEM.includes('"tasks"'));
  });

  test('ответ ИИ: заметка, задачи (даты и время проверяются), дневник; повторы и мусор — нет', () => {
    const acts = parseSplit(
      '```json\n' +
        JSON.stringify({
          note: { title: 'Карточки из темы', text: 'Идея:\n- делать карточки из всей темы' },
          tasks: [
            { title: 'Позвонить врачу', date: '2026-10-16', time: '10:00' },
            { title: 'позвонить врачу' },
            { title: 'Купить кроссовки', date: '2026-02-31', time: '25:00' },
            { title: '' },
            'мусор',
          ],
          journal: 'Тяжёлый, но интересный день. Устал, но доволен.',
        }) +
        '\n```',
    );
    assert.deepEqual(acts, [
      { type: 'add_note', title: 'Карточки из темы', text: 'Идея:\n- делать карточки из всей темы' },
      { type: 'add_task', title: 'Позвонить врачу', date: '2026-10-16', time: '10:00' },
      { type: 'add_task', title: 'Купить кроссовки' },
      { type: 'add_journal', text: 'Тяжёлый, но интересный день. Устал, но доволен.', section: 'thoughts' },
    ]);
    assert.deepEqual(parseSplit('{"note":null,"tasks":[],"journal":null}'), []);
    assert.deepEqual(parseSplit('не JSON'), []);
  });
});

describe('голосом: длинная мысль', () => {
  before(async () => {
    await notes.ensureNotes();
    await tasks.ensureTasks();
  });

  test('без ИИ (нет ключа и входа) — как раньше, без разбора', async () => {
    const n = ai.aiRequests.length;
    await voice.interpret(LONG);
    assert.equal(ai.aiRequests.length, n);
  });

  test('с ИИ: заметка, две задачи с датой, запись в дневник — и все выполняются', async () => {
    cloud.useCloud.setState({ account: { token: 't', user: { id: 'u', email: 'a@b.cd', name: 'A' } } as never });
    ai.aiAnswers.push(
      JSON.stringify({
        note: { title: 'Карточки из всей темы', text: 'Идея для приложения:\n- карточки делаются из всей темы сразу' },
        tasks: [
          { title: 'Позвонить врачу', date: todayYmd(), time: '10:00' },
          { title: 'Купить кроссовки' },
        ],
        journal: 'Тяжёлый, но интересный день. Устал, но доволен.',
      }),
    );
    const r = await voice.interpret(LONG);
    assert.equal(r.via, 'ai');
    assert.deepEqual(
      r.actions.map((a) => a.type),
      ['add_note', 'add_task', 'add_task', 'add_journal'],
    );
    assert.ok(ai.aiRequests.at(-1)!.messages[0].content.includes('Запись:\n' + LONG));
    const done = [];
    for (const a of r.actions) done.push(await voice.execute(a));
    assert.ok(done.every((d) => d.ok));
    await notes.flushNotes();
    await tasks.flushTasks();
    const note = notes.useNotes.getState().data!.notes.find((n) => n.title === 'Карточки из всей темы')!;
    const body = await notes.loadNoteBody(note.id);
    assert.deepEqual(
      body.blocks.map((b) => b.type),
      ['p', 'bullet'],
      'markdown — списком',
    );
    const t = tasks.useTasks.getState().data!.tasks.find((x) => x.title === 'Позвонить врачу')!;
    assert.equal(t.date, todayYmd());
    assert.equal(t.time, '10:00');
    const day = await notes.loadNoteBody(daily.dailyNoteOf(todayYmd())!);
    assert.ok(day.blocks.some((b) => b.text?.endsWith('· Тяжёлый, но интересный день. Устал, но доволен.')));
    // отмена каждой части
    for (const d of done) await d.undo?.();
    await notes.flushNotes();
    assert.ok(!notes.useNotes.getState().data!.notes.some((n) => n.title === 'Карточки из всей темы' && !n.trashed));
  });

  test('«Разбери: …» короткой фразы; ИИ не ответил — обычный разбор', async () => {
    ai.aiAnswers.push('{"note":null,"tasks":[{"title":"Позвонить маме","date":"' + todayYmd() + '"}],"journal":null}');
    const r = await voice.interpret('Разбери: позвонить маме сегодня');
    assert.deepEqual(r.actions, [{ type: 'add_task', title: 'Позвонить маме', date: todayYmd() }]);
    ai.aiAnswers.push(new ai.AIError('нет сети'));
    const r2 = await voice.interpret('Купить хлеб завтра в 9');
    assert.equal(r2.via, 'local');
    assert.equal(r2.actions[0].type, 'add_task');
  });
});
