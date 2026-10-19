/** Напоминание-будильник: признак в расписании, без «настойчивых» повторов, флаг доходит до задачи */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const tasks = await import('../src/tasks/store.ts');
const sync = await import('../src/tasks/sync.ts');
const { todayYmd, addDaysYmd } = await import('../src/utils/mapTasks.ts');

describe('будильник', () => {
  test('будильник помечен в расписании и не повторяется «настойчиво»; обычная задача — как раньше', async () => {
    await tasks.ensureTasks();
    tasks.setPrefs({ notify: true, nag: 10 });
    const day = addDaysYmd(todayYmd(), 1);
    const wake = tasks.addTask({ title: 'Подъём', date: day, time: '07:00', reminders: [0], alarm: true })!;
    const call = tasks.addTask({ title: 'Созвон', date: day, time: '07:00', reminders: [0] })!;
    const from = new Date(`${day}T00:00:00`).getTime();
    const planned = await sync.planReminders(from, from + 86400000);

    const w = planned.filter((p) => p.extra.taskId === wake.id);
    assert.equal(w.length, 1, 'у будильника нет повторов «настойчивого»');
    assert.equal(w[0].extra.alarm, 1);
    assert.match(w[0].title, /^⏰ Подъём/);
    assert.equal(new Date(w[0].at).getHours(), 7);

    const c = planned.filter((p) => p.extra.taskId === call.id);
    assert.equal(c.length, 4, 'обычное напоминание + 3 «настойчивых»');
    assert.ok(c.every((p) => p.extra.alarm === undefined));
    assert.equal(c[0].title, 'Созвон');
    tasks.setPrefs({ nag: 0 });
  });

  test('выключили будильник — снова обычное напоминание; выполненная задача не звонит', async () => {
    const day = addDaysYmd(todayYmd(), 2);
    const t = tasks.addTask({ title: 'Таблетки', date: day, time: '09:00', reminders: [0], alarm: true })!;
    const from = new Date(`${day}T00:00:00`).getTime();
    tasks.updateTask(t.id, { alarm: undefined });
    let p = (await sync.planReminders(from, from + 86400000)).find((x) => x.extra.taskId === t.id)!;
    assert.equal(p.extra.alarm, undefined);
    tasks.updateTask(t.id, { alarm: true });
    p = (await sync.planReminders(from, from + 86400000)).find((x) => x.extra.taskId === t.id)!;
    assert.equal(p.extra.alarm, 1);
    tasks.completeOccurrence(t.id, day);
    assert.equal((await sync.planReminders(from, from + 86400000)).some((x) => x.extra.taskId === t.id), false);
  });
});
