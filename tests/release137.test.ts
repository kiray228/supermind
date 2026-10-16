/** 1.37: привычки «раз в N дней», что видит ассистент — поверх настоящих хранилищ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const hm = await import('../src/habits/model.ts');
const privacy = await import('../src/assistant/privacy.ts');
const ctx = await import('../src/assistant/context.ts');
const finStore = await import('../src/finance/store.ts');
const { todayYmd, addDaysYmd } = await import('../src/utils/mapTasks.ts');

describe('привычка «раз в N дней»', () => {
  const h = { id: 'w', name: 'Полить цветы', color: '#22c55e', freq: 'every' as const, everyDays: 3, everyFrom: '2026-10-01' };

  test('по графику каждый третий день от дня отсчёта (и назад тоже)', () => {
    const on = ['2026-10-01', '2026-10-04', '2026-10-07', '2026-09-28'];
    const off = ['2026-10-02', '2026-10-03', '2026-10-05'];
    for (const d of on) assert.ok(hm.scheduledOn(h, d), d);
    for (const d of off) assert.ok(!hm.scheduledOn(h, d), d);
    assert.equal(hm.freqOf(h), 'every');
    assert.equal(hm.freqLabel(h), 'Раз в 3 дня');
    assert.equal(hm.freqLabel({ ...h, everyDays: 2 }), 'Через день');
    assert.equal(hm.freqLabel({ ...h, everyDays: 7 }), 'Раз в 7 дней');
  });

  test('в план дня: только по графику; отмеченная в другой день — тоже в плане', () => {
    const days = { '2026-10-02': { journal: '', tasks: [], habits: ['w'] } };
    assert.ok(hm.dueOn({}, h, '2026-10-04'));
    assert.ok(!hm.dueOn({}, h, '2026-10-05'));
    assert.ok(hm.dueOn(days as never, h, '2026-10-02'), 'сделали вне графика — засчитано');
  });

  test('серия: дни вне графика не рвут её, пропуск по графику — рвёт', () => {
    const mark = (ds: string[]) => Object.fromEntries(ds.map((d) => [d, { journal: '', tasks: [], habits: ['w'] }]));
    assert.equal(hm.currentStreak(mark(['2026-10-01', '2026-10-04', '2026-10-07']) as never, h, '2026-10-08').n, 3);
    assert.equal(hm.currentStreak(mark(['2026-10-01', '2026-10-07']) as never, h, '2026-10-08').n, 1, '04.10 пропущено');
  });

  test('старое устройство без поддержки: freqOf без everyDays — каждый день; сохранение чистит лишнее', () => {
    assert.equal(hm.freqOf({ ...h, everyDays: undefined }), 'daily');
    const c = hm.cleanHabit({ ...h, everyFrom: undefined, perWeek: 3, days: [1] });
    assert.equal(c.everyDays, 3);
    assert.equal(c.everyFrom, todayYmd(), 'отсчёт — с сегодня');
    assert.equal(c.perWeek, undefined);
    assert.equal(c.days, undefined);
    const back = hm.cleanHabit({ ...c, freq: undefined });
    assert.equal(back.everyDays, undefined);
    assert.equal(back.everyFrom, undefined);
    assert.equal(hm.everyDaysOf({ ...h, everyDays: 99 }), 30);
  });
});

describe('что видит ассистент', () => {
  test('по умолчанию — всё; финансы и настроение можно скрыть', async () => {
    localStorage.removeItem('sm-ai-privacy');
    assert.deepEqual(privacy.assistantPrivacy(), { finance: true, mood: true });
    await finStore.ensureFinance();
    const acc = finStore.useFinance.getState().data!.accounts[0];
    finStore.addTransaction({ type: 'expense', amount: 4321, accountId: acc.id, date: addDaysYmd(todayYmd(), 0), tags: [], note: 'Кофейня у дома' } as never);
    const withFin = await ctx.buildContext();
    assert.ok(withFin.includes('Кофейня у дома'));
    privacy.setAssistantPrivacy({ finance: false });
    const noFin = await ctx.buildContext();
    assert.ok(!noFin.includes('Кофейня у дома'));
    assert.ok(!/Финансы \(основная валюта/.test(noFin));
    assert.ok(noFin.includes('пользователь скрыл их от ассистента'));
    assert.deepEqual(privacy.assistantPrivacy(), { finance: false, mood: true });
    privacy.setAssistantPrivacy({ finance: true });
  });
});
