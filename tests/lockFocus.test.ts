/** Код-пароль (хеш, попытки, пауза), фокус на ветке карты — Node, хранилища в памяти */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const lock = await import('../src/ui/lock.ts');
const { focusSheet, focusPath } = await import('../src/editor/focus.ts');
const docs = await import('../src/store/docStore.ts');
const { newTopic } = await import('../src/utils/tree.ts');

describe('код-пароль', () => {
  before(() => lock.disableLock());

  test('код хранится хешем с солью; верный открывает, неверный — нет', async () => {
    await lock.setPin('2580');
    const cfg = lock.lockConfig()!;
    assert.ok(cfg.hash.length === 64 && cfg.salt.length === 32);
    assert.ok(!JSON.stringify(cfg).includes('2580'), 'сам код не хранится');
    assert.equal(cfg.after, 1, 'по умолчанию — через минуту');
    lock.lockNow();
    assert.equal(lock.useLock.getState().locked, true);
    assert.equal(await lock.tryUnlock('1111'), 'wrong');
    assert.equal(lock.useLock.getState().locked, true);
    assert.equal(await lock.tryUnlock('2580'), 'ok');
    assert.equal(lock.useLock.getState().locked, false);
  });

  test('одинаковый код — разные хеши (соль); смена кода', async () => {
    await lock.setPin('1234');
    const a = lock.lockConfig()!.hash;
    await lock.setPin('1234');
    assert.notEqual(lock.lockConfig()!.hash, a);
    assert.equal(await lock.tryUnlock('1234'), 'ok');
  });

  test('только 4–6 цифр', async () => {
    assert.ok(lock.validPin('0000') && lock.validPin('123456'));
    assert.ok(!lock.validPin('123') && !lock.validPin('1234567') && !lock.validPin('12a4'));
    await assert.rejects(lock.setPin('12'), /от 4 до 6/);
  });

  test('5 ошибок — пауза 30 с, потом минута; во время паузы даже верный код не проверяется', async () => {
    await lock.setPin('2580');
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 4; i++) assert.equal(await lock.tryUnlock('0000', t0), 'wrong');
    assert.equal(lock.lockWait(t0), 0, 'четыре — ещё можно');
    assert.equal(await lock.tryUnlock('0000', t0), 'wrong');
    assert.equal(lock.lockWait(t0), 30_000);
    assert.equal(await lock.tryUnlock('2580', t0 + 1000), 'wait');
    const t1 = t0 + 31_000;
    for (let i = 0; i < 5; i++) await lock.tryUnlock('0000', t1);
    assert.equal(lock.lockWait(t1), 60_000, 'вторая пятёрка — минута');
    assert.equal(await lock.tryUnlock('2580', t1 + 61_000), 'ok');
    assert.equal(lock.lockWait(), 0, 'верный код сбрасывает счётчик');
  });

  test('выключить — не заперто, конфиг удалён; «запирать через» сохраняется', async () => {
    await lock.setPin('2580');
    lock.setLockAfter(5);
    assert.equal(lock.lockConfig()!.after, 5);
    await lock.setPin('9999');
    assert.equal(lock.lockConfig()!.after, 5, 'смена кода не сбрасывает время');
    lock.lockNow();
    lock.disableLock();
    assert.equal(lock.lockConfig(), null);
    assert.deepEqual(lock.useLock.getState(), { locked: false, enabled: false });
    lock.lockNow();
    assert.equal(lock.useLock.getState().locked, false, 'без кода не запирается');
  });
});

describe('фокус на ветке', () => {
  const sheetOf = () => {
    const doc = docs.newDoc('Ф');
    const s = doc.sheets[0];
    const a = newTopic('Работа', [newTopic('Проект А', [newTopic('Код'), newTopic('Тесты')]), newTopic('Проект Б')]);
    const b = newTopic('Дом', [newTopic('Сад')]);
    a.collapsed = true;
    s.root.children = [a, b];
    const projA = a.children[0];
    s.relationships = [
      { id: 'r1', from: projA.children[0].id, to: projA.children[1].id },
      { id: 'r2', from: projA.id, to: b.id },
    ];
    s.boundaries = [
      { id: 'b1', topicId: projA.id },
      { id: 'b2', topicId: projA.children[0].id },
    ];
    s.summaries = [{ id: 's1', topicId: b.id, text: 'итог' }];
    return { doc, s, a, b, projA };
  };

  test('вид: ветка — центр (раскрыта, без стороны), только её связи, границы и итоги; лист не меняется', () => {
    const { s, a, projA } = sheetOf();
    a.side = 'left';
    const v = focusSheet(s, a.id)!;
    assert.equal(v.root.id, a.id);
    assert.equal(v.root.collapsed, false);
    assert.equal(v.root.side, undefined);
    assert.equal(a.collapsed, true, 'настоящая тема не тронута');
    assert.equal(a.side, 'left');
    assert.notEqual(v.id, s.id, 'другой id — вид заново вписывается в экран');
    assert.deepEqual(v.floating, []);
    assert.deepEqual(v.relationships.map((r) => r.id), ['r1']);
    assert.deepEqual(v.boundaries.map((b) => b.id), ['b1', 'b2']);
    assert.deepEqual(v.summaries, []);
    const v2 = focusSheet(s, projA.id)!;
    assert.deepEqual(v2.boundaries.map((b) => b.id), ['b2'], 'граница самой ветки — нет, она центр');
    assert.equal(focusSheet(s, s.root.id), null, 'центральная тема — обычный вид');
    assert.equal(focusSheet(s, 'нет'), null);
    assert.deepEqual(focusPath(s, projA.id).map((t) => t.text), ['Работа', 'Проект А']);
  });

  test('в фокусе: «Тема рядом» на центре ветки — подтема (не невидимая соседняя); удалили ветку — фокус снят в редакторе', () => {
    const { doc, a } = sheetOf();
    docs.useDoc.getState().open(doc);
    const st = () => docs.useDoc.getState();
    st().setFocus(a.id);
    assert.equal(st().focusId, a.id);
    assert.deepEqual(st().selection, [a.id]);
    const before = st().sheet()!.root.children.length;
    const id = st().addSibling(a.id)!;
    st().setEditing(null);
    const workKids = st().sheet()!.root.children[0].children.map((t) => t.id);
    assert.ok(workKids.includes(id));
    assert.equal(st().sheet()!.root.children.length, before);
    st().setFocus(st().sheet()!.root.id);
    assert.equal(st().focusId, null, 'центральная — значит, вся карта');
    st().setFocus('нет-такой');
    assert.equal(st().focusId, null);
    st().setFocus(a.id);
    st().setActiveSheet(st().doc!.sheets[0].id);
    assert.equal(st().focusId, null, 'смена листа — вся карта');
    st().close();
  });
});
