/** 1.43: изменения копируют только тронутое — нетронутые записи остаются теми же объектами */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const tasks = await import('../src/tasks/store.ts');
const finStore = await import('../src/finance/store.ts');
const { stampChanged } = await import('../src/store/blobSync.ts');
const { todayYmd } = await import('../src/utils/mapTasks.ts');

describe('задачи: копируется только изменённая', () => {
  test('updateTask: остальные задачи — те же объекты, изменённая — новая и с отметкой времени', async () => {
    await tasks.ensureTasks();
    const a = tasks.addTask({ title: 'A' })!;
    const b = tasks.addTask({ title: 'B' })!;
    const before = tasks.tasksData()!;
    const bObj = before.tasks.find((t) => t.id === b.id)!;
    const aObj = before.tasks.find((t) => t.id === a.id)!;
    tasks.updateTask(a.id, { title: 'A2', date: todayYmd() });
    const after = tasks.tasksData()!;
    assert.notEqual(after, before);
    assert.notEqual(after.tasks, before.tasks);
    assert.equal(after.tasks.find((t) => t.id === b.id), bObj, 'нетронутая — тот же объект');
    const a2 = after.tasks.find((t) => t.id === a.id)!;
    assert.notEqual(a2, aObj);
    assert.equal(aObj.title, 'A', 'прежнее состояние не изменилось');
    assert.equal(a2.title, 'A2');
    assert.ok(a2.reminders.length > 0, 'напоминания по умолчанию при появлении даты');
    // сравнение при сохранении: отметку получает только изменённая
    const { value, stamped } = stampChanged(after, before);
    assert.equal(stamped, true);
    assert.equal(value.tasks.find((t) => t.id === b.id), bObj);
  });

  test('выполнение и «Отменить» не меняют прежнее состояние журнала', () => {
    const t = tasks.addTask({ title: 'Журнал', date: todayYmd() })!;
    const before = tasks.tasksData()!;
    const logBefore = before.log;
    const len = logBefore.length;
    tasks.toggleDone(t.id);
    const after = tasks.tasksData()!;
    assert.equal(after.log.length, len + 1);
    assert.equal(logBefore.length, len, 'старый массив журнала не тронут');
    assert.equal(before.tasks.find((x) => x.id === t.id)!.done, false, 'старая задача не тронута');
    tasks.toggleDone(t.id); // снять отметку
    const undone = tasks.tasksData()!;
    assert.equal(undone.log.length, len);
    assert.equal(after.log.length, len + 1, 'и тот массив не тронут');
    assert.ok(Object.keys(undone.gone ?? {}).some((k) => k.startsWith('log:' + t.id)));
  });

  test('чек-лист и восстановление из корзины — через ту же копию одной задачи', () => {
    const t = tasks.addTask({ title: 'Чек' })!;
    const other = tasks.tasksData()!.tasks.find((x) => x.id !== t.id)!;
    tasks.updateChecklist(t.id, () => [{ id: 'q', text: 'пункт', done: true }]);
    assert.equal(tasks.getTask(t.id)!.checklist[0].doneAt! > 0, true);
    tasks.trashTask(t.id);
    tasks.restoreTask(t.id);
    assert.equal(tasks.getTask(t.id)!.deleted, undefined);
    assert.equal(tasks.tasksData()!.tasks.find((x) => x.id === other.id), other);
  });
});

describe('финансы: копируется только изменённая операция', () => {
  test('добавить, изменить, удалить', async () => {
    await finStore.ensureFinance();
    const acc = finStore.useFinance.getState().data!.accounts[0];
    const t1 = finStore.addTransaction({ type: 'expense', amount: 100, accountId: acc.id, date: todayYmd() }, { silent: true })!;
    const t2 = finStore.addTransaction({ type: 'expense', amount: 200, accountId: acc.id, date: todayYmd() }, { silent: true })!;
    const before = finStore.useFinance.getState().data!;
    const o1 = before.transactions.find((x) => x.id === t1.id)!;
    finStore.updateTransaction(t2.id, { amount: 250 });
    const after = finStore.useFinance.getState().data!;
    assert.equal(after.transactions.find((x) => x.id === t1.id), o1);
    assert.equal(after.transactions.find((x) => x.id === t2.id)!.amount, 250);
    assert.equal(before.transactions.find((x) => x.id === t2.id)!.amount, 200, 'прежнее состояние не изменилось');
    finStore.deleteTransaction(t2.id, false);
    const del = finStore.useFinance.getState().data!;
    assert.ok(!del.transactions.some((x) => x.id === t2.id));
    assert.ok(del.gone?.[t2.id]);
    assert.ok(after.transactions.some((x) => x.id === t2.id), 'и после удаления прежний массив цел');
  });
});
