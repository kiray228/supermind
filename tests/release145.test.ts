/** Редактор карт (фокус на ветке, вставка Markdown, стороны, рыбья кость) и доступность (окна, тема) */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const { useDoc, newDoc } = await import('../src/store/docStore.ts');
const { findInSheet } = await import('../src/utils/tree.ts');
const S = () => useDoc.getState();

describe('фокус на ветке', () => {
  test('стрелки не уводят за пределы видимой ветки', () => {
    S().open(newDoc('Ф'));
    const root = S().sheet()!.root.id;
    const M = S().addChild(root, 'Ветка')!;
    const A = S().addChild(M, 'A')!;
    S().setEditing(null);
    S().setFocus(M);
    S().select(M);
    S().navigate('left');
    S().navigate('up');
    const sel = S().selection[0];
    assert.ok(sel === M || findInSheet(S().sheet()!, sel)?.parent?.id === M || sel === A, 'выделение осталось в ветке');
    assert.notEqual(sel, root);
  });
});

describe('удаление и вставка', () => {
  test('после удаления выбрана существующая тема', () => {
    S().open(newDoc('У'));
    const root = S().sheet()!.root.id;
    const A = S().addChild(root, 'A')!;
    const B1 = S().addChild(A, 'B1')!;
    S().addChild(A, 'B2');
    S().deleteTopics([B1, A]);
    const sel = S().selection[0];
    assert.ok(findInSheet(S().sheet()!, sel), 'выбранная тема существует');
  });

  test('вставка Markdown с заголовками — вложенно', async () => {
    const { textToTopics } = await import('../src/io/markdown.ts');
    const shape = (t: { text: string; children: unknown[] }): unknown => [t.text, (t.children as (typeof t)[]).map(shape)];
    assert.deepEqual(textToTopics('# План\n## Неделя 1\n- пн\n- вт\n## Неделя 2').map(shape), [['План', [['Неделя 1', [['пн', []], ['вт', []]]], ['Неделя 2', []]]]]);
    assert.deepEqual(textToTopics('один\n  два\nтри').map(shape), [['один', [['два', []]]], ['три', []]], 'обычный текст с отступами — как раньше');
  });

  test('новый родитель главной темы — на её стороне', () => {
    S().open(newDoc('С'));
    const root = S().sheet()!.root.id;
    const A = S().addChild(root, 'A', 'left')!;
    S().addChild(root, 'B');
    S().setEditing(null);
    const P = S().addParent(A)!;
    const sh = S().sheet()!;
    assert.equal(findInSheet(sh, P)!.topic.side, 'left');
    assert.equal(findInSheet(sh, A)!.topic.side, undefined);
  });
});

describe('раскладка «рыбья кость»', () => {
  test('главные темы не налезают; у свёрнутой центральной — кнопка', async () => {
    // ширина текста без canvas: 8 px на символ
    const g = globalThis as { document?: unknown };
    const hadDoc = !!g.document;
    if (!hadDoc)
      g.document = { createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 8 }) }) }) };
    try {
      const { layoutSheet } = await import('../src/layout/layout.ts');
      S().open(newDoc('Р'));
      const root = S().sheet()!.root.id;
      for (const t of ['Очень длинная главная тема 1', 'Очень длинная главная тема 2', 'Очень длинная главная тема 3', 'Очень длинная главная тема 4']) S().addChild(root, t);
      S().setEditing(null);
      S().setSheetProps({ structure: 'fishbone' });
      const lay = layoutSheet(S().sheet()!);
      const mains = lay.order.filter((n) => n.depth === 1);
      for (let i = 0; i < mains.length; i++)
        for (let j = i + 1; j < mains.length; j++) {
          const a = mains[i];
          const b = mains[j];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          assert.ok(!overlap, `темы ${i} и ${j} не пересекаются`);
        }
      S().toggleCollapse(root, true);
      const lay2 = layoutSheet(S().sheet()!);
      assert.ok(lay2.order.find((n) => n.depth === 0)!.toggle, 'кнопка развернуть есть');
    } finally {
      if (!hadDoc) delete g.document;
    }
  });
});

describe('тема из прошлого запуска', () => {
  test('настройки стартуют с сохранённой темой', async () => {
    localStorage.setItem('sm-theme', 'dark');
    const fresh = await import('../src/store/appStore.ts?theme=' + Date.now());
    assert.equal(fresh.useApp.getState().settings.theme, 'dark');
    localStorage.removeItem('sm-theme');
  });
});
