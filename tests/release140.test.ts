/** 1.40: разделение покупки по категориям, шаблоны задач, пункт чек-листа → отдельная задача */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const fin = await import('../src/finance/model.ts');
const finStore = await import('../src/finance/store.ts');
const tasks = await import('../src/tasks/store.ts');
const tpl = await import('../src/tasks/templates.ts');
const merge = await import('../src/store/merge.ts');
const { todayYmd, addDaysYmd } = await import('../src/utils/mapTasks.ts');

describe('разделение покупки', () => {
  test('части — отдельные операции, сумма та же, категории считаются по частям', async () => {
    await finStore.ensureFinance();
    const data = () => finStore.useFinance.getState().data!;
    const acc = data().accounts[0];
    const cats = fin.sortedCategories(data(), 'expense');
    const [food, home, other] = cats;
    const today = todayYmd();
    const t = finStore.addTransaction({ type: 'expense', amount: 10000, accountId: acc.id, categoryId: food.id, date: today, note: 'Магнит' }, { silent: true })!;
    const before = fin.summarize(data(), { from: today, to: today });
    const made = finStore.splitTransaction(t.id, [
      { categoryId: home.id, amount: 3000 },
      { categoryId: other.id, amount: 1500.555 },
      { categoryId: home.id, amount: 0 },
    ])!;
    assert.equal(made.length, 2, 'пустая часть пропущена');
    const group = finStore.splitParts(data(), t.id);
    assert.equal(group.length, 3);
    assert.ok(group.every((x) => x.splitId === t.id && x.note === 'Магнит' && x.accountId === acc.id && x.date === today));
    assert.equal(data().transactions.find((x) => x.id === t.id)!.amount, 5499.44);
    const after = fin.summarize(data(), { from: today, to: today });
    assert.equal(after.expense, before.expense, 'общий расход не изменился');
    assert.equal(after.byCat.get(home.id), (before.byCat.get(home.id) ?? 0) + 3000);
    assert.equal(after.byCat.get(food.id), (before.byCat.get(food.id) ?? 0) - 4500.56);
  });

  test('части не могут съесть всю сумму; перевод не делится', () => {
    const data = finStore.useFinance.getState().data!;
    const acc = data.accounts[0];
    const t = finStore.addTransaction({ type: 'expense', amount: 1000, accountId: acc.id, date: todayYmd() }, { silent: true })!;
    assert.equal(finStore.splitTransaction(t.id, [{ amount: 1000 }]), null);
    assert.equal(finStore.splitTransaction(t.id, []), null);
    const acc2 = finStore.useFinance.getState().data!.accounts[1] ?? acc;
    const tr = finStore.addTransaction({ type: 'transfer', amount: 500, accountId: acc.id, toAccountId: acc2.id, date: todayYmd() }, { silent: true })!;
    assert.equal(finStore.splitTransaction(tr.id, [{ amount: 100 }]), null);
  });

  test('повторное разделение части — та же группа; «Собрать в одну» возвращает сумму', () => {
    const data = () => finStore.useFinance.getState().data!;
    const acc = data().accounts[0];
    const t = finStore.addTransaction({ type: 'expense', amount: 900, accountId: acc.id, date: todayYmd() }, { silent: true })!;
    const [p] = finStore.splitTransaction(t.id, [{ amount: 300 }])!;
    finStore.splitTransaction(p.id, [{ amount: 100 }]);
    assert.equal(finStore.splitParts(data(), t.id).length, 3);
    assert.equal(finStore.mergeSplit(t.id), 2);
    const m = data().transactions.find((x) => x.id === t.id)!;
    assert.equal(m.amount, 900);
    assert.equal(m.splitId, undefined);
    assert.equal(finStore.splitParts(data(), t.id).length, 0);
    assert.ok(data().gone?.[p.id], 'убранные части не вернёт синхронизация');
  });
});

describe('шаблоны задач', () => {
  test('сохранить → создать по шаблону с датой раздела; время только при дате', async () => {
    await tasks.ensureTasks();
    const src = tasks.addTask({ title: 'Собрать чемодан', notes: 'Не забыть паспорт', priority: 2, tags: ['поездка'], date: todayYmd(), time: '19:00', duration: 30 })!;
    tasks.updateChecklist(src.id, () => [
      { id: 'a', text: 'Зарядка', done: true },
      { id: 'b', text: 'Документы', done: false },
      { id: 'c', text: '  ', done: false },
    ]);
    const t = tpl.saveTaskTemplate(src.id, ' Поездка ')!;
    assert.equal(t.name, 'Поездка');
    assert.deepEqual(t.checklist, ['Зарядка', 'Документы']);
    assert.equal(t.time, '19:00');
    assert.equal(tpl.listTaskTemplates()[0].id, t.id);

    const tomorrow = addDaysYmd(todayYmd(), 1);
    const a = tpl.taskFromTemplate(t.id, { date: tomorrow, tags: ['срочно'] })!;
    assert.equal(a.title, 'Собрать чемодан');
    assert.equal(a.date, tomorrow);
    assert.equal(a.time, '19:00');
    assert.equal(a.duration, 30);
    assert.equal(a.priority, 2);
    assert.equal(a.notes, 'Не забыть паспорт');
    assert.deepEqual(a.tags, ['поездка', 'срочно']);
    assert.deepEqual(a.checklist.map((c) => [c.text, c.done]), [['Зарядка', false], ['Документы', false]]);
    assert.notEqual(a.checklist[0].id, 'a', 'новые id пунктов');
    assert.ok(a.reminders.length > 0, 'напоминания по умолчанию для задачи со временем');

    const b = tpl.taskFromTemplate(t.id, {})!;
    assert.equal(b.date, undefined);
    assert.equal(b.time, undefined, 'без даты — без времени');
  });

  test('переименовать и удалить; удалённый не вернётся при синхронизации', () => {
    const [t] = tpl.listTaskTemplates();
    tpl.renameTaskTemplate(t.id, 'Командировка');
    assert.equal(tpl.listTaskTemplates()[0].name, 'Командировка');
    const before = structuredClone(tasks.tasksData()!);
    tpl.deleteTaskTemplate(t.id);
    assert.equal(tpl.listTaskTemplates().length, 0);
    const merged = merge.mergeValues('tasks', tasks.tasksData(), before) as { templates: { id: string }[] };
    assert.ok(!merged.templates.some((x) => x.id === t.id));
  });
});

describe('пункт чек-листа → отдельная задача', () => {
  test('становится задачей со связью, пункт убран, выполненный — выполненная', async () => {
    await tasks.ensureTasks();
    const p = tasks.addTask({ title: 'Ремонт', tags: ['дом'], priority: 1, listId: 'personal' })!;
    tasks.updateChecklist(p.id, () => [
      { id: 'x1', text: 'Купить краску', done: false },
      { id: 'x2', text: 'Позвать мастера', done: true },
    ]);
    const c = tasks.promoteChecklistItem(p.id, 'x1')!;
    assert.equal(c.title, 'Купить краску');
    assert.equal(c.parentId, p.id);
    assert.equal(c.listId, 'personal');
    assert.deepEqual(c.tags, ['дом']);
    assert.equal(c.done, false);
    assert.deepEqual(tasks.getTask(p.id)!.checklist.map((x) => x.id), ['x2']);
    const d = tasks.promoteChecklistItem(p.id, 'x2')!;
    assert.equal(d.done, true);
    assert.equal(tasks.getTask(p.id)!.checklist.length, 0);
    assert.deepEqual(tasks.childTasks(tasks.tasksData()!, p.id).map((x) => x.title).sort(), ['Купить краску', 'Позвать мастера']);
    tasks.trashTask(c.id);
    assert.equal(tasks.childTasks(tasks.tasksData()!, p.id).length, 1, 'удалённые не показываем');
    assert.equal(tasks.promoteChecklistItem(p.id, 'нет такого'), null);
  });
});
