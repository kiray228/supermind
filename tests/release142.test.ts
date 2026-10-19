/** 1.42: импорт выписок, суммы, цели, поиск по заметкам, серии привычек — по третьему аудиту */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const csv = await import('../src/finance/csv.ts');
const fin = await import('../src/finance/model.ts');
const finStore = await import('../src/finance/store.ts');

describe('импорт выписки', () => {
  const KASPI = 'Выписка по карте Kaspi Gold\nДата;Сумма;Операция;Детали\n01.10.24;- 5 000,00 ₸;Покупки;MAGNUM ALMATY\n02.10.24;+ 20 000,00 ₸;Пополнения;С Kaspi Депозита\n';

  test('строка-заголовок над таблицей: разделитель, шапка и суммы — верные', () => {
    const delim = csv.detectDelimiter(KASPI);
    assert.equal(delim, ';');
    const rows = csv.dropPreamble(csv.parseCsv(KASPI, delim));
    assert.deepEqual(rows[0], ['Дата', 'Сумма', 'Операция', 'Детали']);
    assert.ok(csv.looksLikeHeader(rows[0]));
    const map = csv.guessColumns(rows[0]);
    assert.deepEqual([map.date, map.amount, map.description], [0, 1, 3], 'описание — «Детали» (продавец), а не «Операция»');
  });

  test('дата и время — не сумма; буквы — не сумма', () => {
    assert.equal(csv.parseAmount('01.10.24;- 5 000'), null);
    assert.equal(csv.parseAmount('12:30'), null);
    assert.equal(csv.parseAmount('Покупки'), null);
    assert.equal(csv.parseAmount('- 5 000,00 ₸'), -5000);
    assert.equal(csv.parseAmount('1 234,56 KZT'), 1234.56);
    assert.equal(csv.parseAmount('(500)'), -500);
  });

  test('время с часовым поясом — в местные сутки', () => {
    const r = csv.parseDate('2024-10-31T22:00:00Z')!;
    const d = new Date('2024-10-31T22:00:00Z');
    assert.equal(r.date, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    assert.equal(csv.parseDate('31.10.2024')!.date, '2024-10-31');
  });

  test('дубликаты: только на том же счёте; разделённая покупка — по общей сумме', async () => {
    await finStore.ensureFinance();
    const data = () => finStore.useFinance.getState().data!;
    const [cash, card] = data().accounts;
    finStore.addTransaction({ type: 'expense', amount: 2000, accountId: cash.id, date: '2024-10-01', note: 'MAGNUM ALMATY' }, { silent: true });
    const rows = [['01.10.2024', '-2000', 'MAGNUM ALMATY']];
    const map = { date: 0, amount: 1, description: 2, category: -1 };
    assert.equal(csv.buildImport(data(), rows, map, card.id).items.length, 1, 'на карте такой нет — не дубликат');
    assert.equal(csv.buildImport(data(), rows, map, cash.id).duplicates, 1);

    const t = finStore.addTransaction({ type: 'expense', amount: 5000, accountId: card.id, date: '2024-10-02', note: 'SMALL' }, { silent: true })!;
    finStore.splitTransaction(t.id, [{ amount: 2000 }]);
    const again = csv.buildImport(data(), [['02.10.2024', '-5000', 'SMALL']], map, card.id);
    assert.equal(again.duplicates, 1, 'разделённая покупка узнаётся по всей сумме');
    assert.equal(again.items.length, 0);
  });

  test('отмена импорта убирает добавленное', async () => {
    const data = () => finStore.useFinance.getState().data!;
    const n = data().transactions.length;
    const ids = finStore.addTransactions([{ type: 'expense', amount: 10, accountId: data().accounts[0].id, date: '2024-11-01' }]);
    assert.equal(data().transactions.length, n + 1);
    finStore.removeTransactions(ids);
    assert.equal(data().transactions.length, n);
  });

  test('«Kaspi магазин» — одежда, не продукты', () => {
    const d = finStore.useFinance.getState().data!;
    assert.equal(csv.autoCategory(d, 'KASPI МАГАЗИН одежда', 'expense', new Map()), 'c-clothes');
  });
});

describe('сумма в поле ввода', () => {
  test('слагаемые с разделителями тысяч; ошибка в слагаемом — ошибка', () => {
    assert.equal(fin.parseMoneyInput('1.200,50+300'), 1500.5);
    assert.equal(fin.parseMoneyInput('1 200,5 + 300,5'), 1501);
    assert.equal(fin.parseMoneyInput('1,200.50'), 1200.5);
    assert.equal(fin.parseMoneyInput('1200-200'), 1000);
    assert.equal(fin.parseMoneyInput('4,5к'), 4500);
    assert.equal(fin.parseMoneyInput('-300'), -300);
    assert.ok(Number.isNaN(fin.parseMoneyInput('abc')));
  });
});

describe('этап цели, выполненный через задачи', () => {
  test('не напоминает о сроке', async () => {
    const gm = await import('../src/goals/model.ts');
    const today = '2026-10-19';
    const data = {
      goals: [
        {
          id: 'g', title: 'Ремонт', status: 'active', mode: 'steps', createdAt: 1, updatedAt: 1,
          stages: [{ id: 's', title: 'Кухня', deadline: '2026-10-20', taskIds: [], steps: [{ id: 'p', title: 'Плитка', taskId: 't1' }] }], taskIds: [],
        },
      ],
    };
    const look = gm.makeTaskLookup([{ id: 't1', title: 'Плитка', done: true } as never]);
    assert.equal(gm.goalsDueBetween(data as never, today, '2026-10-30').length, 1, 'без задач — как раньше');
    assert.equal(gm.goalsDueBetween(data as never, today, '2026-10-30', look).length, 0);
  });
});

describe('серии привычек', () => {
  test('с памятью — то же, что без неё; новая история — новый результат', async () => {
    const hm = await import('../src/habits/model.ts');
    const { addDaysYmd } = await import('../src/utils/mapTasks.ts');
    const h = { id: 'h', name: 'Вода', color: '#0af' };
    const days: Record<string, { habits: string[] }> = {};
    const today = '2026-10-19';
    for (let i = 1; i <= 400; i++) days[addDaysYmd(today, -i)] = { habits: ['h'] };
    delete days[addDaysYmd(today, -50)];
    assert.deepEqual(hm.currentStreak(days as never, h as never, today), { n: 49, unit: 'day' });
    assert.deepEqual(hm.bestStreak(days as never, h as never, today), { n: 350, unit: 'day' });
    // тот же объект — тот же ответ (из памяти)
    assert.deepEqual(hm.currentStreak(days as never, h as never, today), { n: 49, unit: 'day' });
    const next = { ...days, [today]: { habits: ['h'] } };
    assert.deepEqual(hm.currentStreak(next as never, h as never, today), { n: 50, unit: 'day' });
  });
});

describe('поиск по заметкам', () => {
  test('находит по тексту, устаревший поиск прекращается', async () => {
    const notes = await import('../src/notes/store.ts');
    const kv = await import('../src/store/kv.ts');
    await notes.ensureNotes();
    const metas = [];
    for (let i = 0; i < 450; i++) {
      const id = 'srch' + i;
      metas.push({ id, title: 'Заметка ' + i, preview: '', createdAt: 1, updatedAt: 1 });
      await kv.set(`note:${id}`, { title: 'Заметка ' + i, blocks: [{ id: 'b', type: 'p', text: i === 321 ? 'тайный рецепт борща' : 'обычный текст' }], updatedAt: 1 });
    }
    const found = await notes.searchNotes('рецепт борща', metas as never);
    assert.deepEqual([...found], ['srch321']);
    let calls = 0;
    const stopped = await notes.searchNotes('что-то новое', metas.map((m) => ({ ...m, updatedAt: 2 })) as never, () => ++calls < 2);
    assert.equal(stopped.size, 0);
  });
});
