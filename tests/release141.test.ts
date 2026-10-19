/** 1.41: исправления по глубокому аудиту — заметки, голос, сводка, очередь ИИ, пароль карт, импорт, повторы, опыт */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const kv = await import('../src/store/kv.ts');
const merge = await import('../src/store/merge.ts');
const { todayYmd, addDaysYmd } = await import('../src/utils/mapTasks.ts');

describe('заметка, текст которой не дошёл', () => {
  test('не открывается пустой и не удаляется при закрытии', async () => {
    const notes = await import('../src/notes/store.ts');
    await notes.ensureNotes();
    // карточка пришла синхронизацией, а тела на устройстве нет
    const id = 'far-note';
    notes.mutateNotes((d) => void d.notes.push({ id, title: 'Большая заметка с фото', preview: 'Поездка…', createdAt: 1, updatedAt: 2, wordCount: 300, hasImage: true }));
    await notes.openNote(id);
    assert.equal(notes.useNotes.getState().openMissing, true);
    assert.equal(notes.useNotes.getState().openBody, null, 'пустой редактор не показывается');
    await notes.openNote(null);
    assert.ok(notes.useNotes.getState().data!.notes.some((n) => n.id === id), 'заметка не удалена');
    assert.ok(!notes.useNotes.getState().data!.gone?.[id], 'и без отметки об удалении');
    // тело пришло — открывается как обычно
    await kv.setFromSync(`note:${id}`, { title: 'Большая заметка с фото', blocks: [{ id: 'b1', type: 'p', text: 'Поездка в горы' }], updatedAt: 3 });
    await notes.openNote(id);
    assert.equal(notes.useNotes.getState().openMissing, false);
    assert.equal(notes.useNotes.getState().openBody?.blocks[0]?.text, 'Поездка в горы');
    await notes.openNote(null);
  });

  test('новая пустая заметка по-прежнему исчезает без следа', async () => {
    const notes = await import('../src/notes/store.ts');
    const m = notes.createNote()!;
    await notes.openNote(m.id);
    assert.equal(notes.useNotes.getState().openMissing, false);
    await notes.openNote(null);
    assert.ok(!notes.useNotes.getState().data!.notes.some((n) => n.id === m.id));
  });
});

describe('голосовые команды', () => {
  const now = new Date(2026, 9, 13, 12, 0); // вторник
  const voice = async (s: string) => (await import('../src/voice/intent.ts')).parseVoice(s, { now } as never).actions[0] as Record<string, unknown>;

  test('«мне перевели / скинули» — доход, «перевёл» — расход', async () => {
    assert.equal((await voice('мне перевели 10000')).kind, 'income');
    assert.equal((await voice('перевели мне зарплату 300000')).kind, 'income');
    assert.equal((await voice('мне скинули 5000')).kind, 'income');
    assert.equal((await voice('перевёл другу 5000')).kind, 'expense');
  });

  test('«тысячу двести» — 1200, «тысячу» — 1000, «две тысячи пятьсот» — 2500', async () => {
    assert.equal((await voice('потратил тысячу двести на такси')).amount, 1200);
    assert.equal((await voice('потратил тысячу на такси')).amount, 1000);
    assert.equal((await voice('потратил две тысячи пятьсот')).amount, 2500);
    assert.equal((await voice('потратил 2к на такси')).amount, 2000);
  });

  test('«в пять к врачу» — не 5000; «в полдень» — 12:00', async () => {
    const a = await voice('завтра в пять к врачу');
    assert.equal(a.type, 'add_task');
    assert.doesNotMatch(String(a.title), /5000/);
    assert.equal((await voice('завтра в полдень обед')).time, '12:00');
  });

  test('«что у меня на послезавтра / в пятницу» — вопрос, а не задача', async () => {
    assert.deepEqual(await voice('что у меня на послезавтра'), { type: 'ask', what: 'agenda', date: '2026-10-15' });
    assert.deepEqual(await voice('что у меня в пятницу'), { type: 'ask', what: 'agenda', date: '2026-10-16' });
  });
});

describe('утренняя сводка: привычки по расписанию', () => {
  test('«раз в 3 дня» и дни недели — только в свои дни', async () => {
    const { habitsForDay } = await import('../src/assistant/briefing.ts');
    const today = '2026-10-13'; // вторник
    const planner = {
      days: {},
      habits: [
        { id: 'every3', name: 'Полить цветы', color: '#0a0', freq: 'every', everyDays: 3, everyFrom: '2026-10-12' },
        { id: 'tue', name: 'Бассейн', color: '#00a', freq: 'weekdays', days: [2] },
        { id: 'wed', name: 'Языки', color: '#a00', freq: 'weekdays', days: [3] },
        { id: 'daily', name: 'Вода', color: '#0aa' },
        { id: 'old', name: 'Архив', color: '#aaa', archived: true },
      ],
    };
    assert.deepEqual(habitsForDay(planner as never, today).map((h) => h.id).sort(), ['daily', 'tue']);
    assert.deepEqual(habitsForDay(planner as never, '2026-10-15').map((h) => h.id).sort(), ['daily', 'every3']);
  });
});

describe('очередь ИИ', () => {
  test('неделя прошла — запись уходит, даже если ИИ недоступен', async () => {
    const q = await import('../src/notes/aiQueue.ts');
    const old = Date.now() - 8 * 86400000;
    q.queueDictation('старая мысль', undefined, old);
    q.queueDictation('свежая мысль');
    assert.equal(q.useAiQueue.getState().items.length, 2);
    await q.processQueue();
    assert.deepEqual(q.useAiQueue.getState().items.map((x) => (x.kind === 'dictation' ? x.text : '')), ['свежая мысль']);
    q.dropQueued(() => true);
  });
});

describe('пароль карты', () => {
  const plain = (at: number, unlockedAt?: number) => ({ id: 'm', title: 'Карта', sheets: [], activeSheet: 's', createdAt: 1, updatedAt: at, ...(unlockedAt ? { unlockedAt } : {}) });
  const locked = (at: number) => ({ id: 'm', locked: true, salt: 's', iv: 'i', data: 'd', updatedAt: at });

  test('правка без пароля (даже более поздняя) не снимает пароль; явное снятие — снимает', () => {
    assert.ok('locked' in (merge.mergeValues('doc:m', plain(500), locked(100)) as object), 'новее, но пароль не снимали');
    assert.ok('locked' in (merge.mergeValues('doc:m', locked(100), plain(500)) as object));
    assert.ok(!('locked' in (merge.mergeValues('doc:m', plain(500, 400), locked(100)) as object)), 'пароль сняли после шифрования');
    assert.ok('locked' in (merge.mergeValues('doc:m', plain(500, 50), locked(100)) as object), 'сняли раньше, потом снова поставили');
  });

  test('карта с паролем — без превью и числа тем в списке', async () => {
    const db = await import('../src/store/db.ts');
    await kv.set('docs:index', [{ id: 'lk', title: 'Секрет', createdAt: 1, updatedAt: 1, topicCount: 12, preview: { root: 'План побега', k: [] } }]);
    await db.saveLocked({ ...locked(5), id: 'lk' } as never, 'Секрет');
    const meta = (await db.listDocs()).find((m) => m.id === 'lk')!;
    assert.equal(meta.locked, true);
    assert.equal(meta.preview, undefined);
    assert.equal(meta.topicCount, undefined);
  });

  test('поставили и сняли пароль — свежая отметка времени и отметка снятия', async () => {
    const { useDoc } = await import('../src/store/docStore.ts');
    const doc = { id: 'pw', title: 'Т', sheets: [{ id: 's', title: 'Лист', root: { id: 'r', text: 'R', children: [] }, floating: [], relationships: [], boundaries: [], summaries: [], structure: 'map' }], activeSheet: 's', createdAt: 1, updatedAt: 10 };
    useDoc.getState().open(doc as never);
    useDoc.getState().setPassword('1234');
    const a = useDoc.getState().doc!;
    assert.ok(a.updatedAt > 10);
    assert.equal(a.unlockedAt, undefined);
    useDoc.getState().setPassword(null);
    assert.ok(useDoc.getState().doc!.unlockedAt! >= a.updatedAt);
    useDoc.getState().close();
  });
});

describe('импорт карт', () => {
  test('.supermind с числом вместо подписи — подписи-не-строки отбрасываются', async () => {
    const io = await import('../src/io/index.ts');
    const doc = io.parseNative(
      JSON.stringify({
        title: 'X',
        sheets: [
          {
            root: { id: 'r', text: 'R', labels: ['ok', 5, null], markers: 'flag', children: [{ id: 'c', text: 'C', side: 'up', children: [] }] },
            relationships: [{ id: 'rel', from: 'r', to: 'c', label: 5, color: { x: 1 } }],
            boundaries: [{ id: 'b', topicId: 'c', label: ['a'] }],
          },
        ],
      }),
    );
    const sh = doc.sheets[0];
    assert.deepEqual(sh.root.labels, ['ok']);
    assert.equal(sh.root.markers, undefined);
    assert.equal(sh.root.children[0].side, undefined);
    assert.equal(sh.relationships[0].label, undefined);
    assert.equal(sh.relationships[0].color, undefined);
    assert.equal(sh.boundaries[0].label, undefined);
  });
});

describe('повторы, чек-лист, журнал, фокус', () => {
  test('«3 раза»: заранее выполненный повтор идёт в счёт серии', async () => {
    const tasks = await import('../src/tasks/store.ts');
    const { occurrences } = await import('../src/tasks/model.ts');
    await tasks.ensureTasks();
    const today = todayYmd();
    const t = tasks.addTask({ title: 'Три раза', date: today, repeat: { freq: 'daily', interval: 1, count: 3 } as never })!;
    // завтрашний выполнили заранее (из уведомления)
    assert.equal(tasks.completeOccurrence(t.id, addDaysYmd(today, 1)), true);
    assert.deepEqual(occurrences(tasks.getTask(t.id)!, today, addDaysYmd(today, 10)), [today, addDaysYmd(today, 2)]);
    tasks.toggleDone(t.id); // сегодняшний
    const x = tasks.getTask(t.id)!;
    assert.equal(x.date, addDaysYmd(today, 2));
    assert.deepEqual(occurrences(x, today, addDaysYmd(today, 10)), [addDaysYmd(today, 2)], 'остался один — третий');
    tasks.toggleDone(t.id);
    assert.equal(tasks.getTask(t.id)!.done, true, 'после третьего — серия закончилась');
  });

  test('пункт чек-листа помнит время отметки; повтор сохраняет их число в журнале', async () => {
    const tasks = await import('../src/tasks/store.ts');
    const t = tasks.addTask({ title: 'Уборка', date: todayYmd(), repeat: { freq: 'daily', interval: 1 } as never })!;
    tasks.updateChecklist(t.id, () => [
      { id: 'a', text: 'Пол', done: true },
      { id: 'b', text: 'Окна', done: false },
    ]);
    assert.ok(tasks.getTask(t.id)!.checklist[0].doneAt! > 0);
    assert.equal(tasks.getTask(t.id)!.checklist[1].doneAt, undefined);
    tasks.updateChecklist(t.id, (c) => c.map((x) => (x.id === 'a' ? { ...x, done: false } : x)));
    assert.equal(tasks.getTask(t.id)!.checklist[0].doneAt, undefined, 'сняли отметку — время ушло');
    tasks.updateChecklist(t.id, (c) => c.map((x) => ({ ...x, done: true })));
    tasks.toggleDone(t.id);
    const last = tasks.tasksData()!.log.at(-1)!;
    assert.equal(last.taskId, t.id);
    assert.equal(last.ck, 2);
    assert.ok(tasks.getTask(t.id)!.checklist.every((c) => !c.done && !c.doneAt));
  });

  test('журнал больше 5000 — вытесненное идёт в итоги дня, опыт не уменьшается', async () => {
    const tasks = await import('../src/tasks/store.ts');
    const { computeProgress } = await import('../src/progress/model.ts');
    const d = structuredClone(tasks.tasksData()!);
    d.log = [];
    d.logArchive = {};
    const base = new Date(2026, 0, 5, 7, 30).getTime();
    for (let i = 0; i < 5010; i++) tasks.pushLog(d, { taskId: 'gone-task', title: 'x', listId: 'inbox', at: base + i * 60000 });
    assert.equal(d.log.length, 5000);
    const arch = Object.values(d.logArchive!);
    assert.equal(arch.reduce((a, x) => a + x.n, 0), 10);
    assert.equal(arch.reduce((a, x) => a + x.early, 0), 10, 'до 9 утра — ранние');
    const src = { tasks: d, goals: null, finance: null, notes: null, docs: null, planner: null };
    const p = computeProgress(src as never, todayYmd());
    assert.equal(p.counters.tasksDone >= 5010, true);
  });

  test('одна и та же сессия фокуса не записывается дважды', async () => {
    const tasks = await import('../src/tasks/store.ts');
    const n = tasks.tasksData()!.focus.length;
    tasks.addFocusSession({ start: 123456, minutes: 25, kind: 'pomo' });
    tasks.addFocusSession({ start: 123456, minutes: 25, kind: 'pomo' });
    assert.equal(tasks.tasksData()!.focus.length, n + 1);
    const a = tasks.tasksData()!;
    const b = structuredClone(a);
    b.focus = b.focus.map((f) => ({ ...f }));
    const m = merge.mergeValues('tasks', a, b) as { focus: unknown[] };
    assert.equal(m.focus.length, n + 1, 'та же сессия с другой вкладки — одна');
  });
});
