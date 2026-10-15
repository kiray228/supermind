/**
 * Индекс на большой базе: сборка порциями = обычной, точечное обновление ≈ полной пересборке,
 * и скорость (пороги с запасом — ловят возврат к квадратичным алгоритмам, а не загрузку машины).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';
import { CORPUS } from './fixtures/corpus.ts';

const L = await import('../src/notes/links.ts');

let seed = 11;
const rnd = () => {
  let t = (seed = (seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const base = [...new Set(CORPUS.flatMap((f) => (f.title + ' ' + f.text).toLowerCase().match(/[а-яё]{4,}/g) ?? []))];
const stems = base.map((w) => w.replace(/[аеиоуыэюяйь]+$/, ''));
const ENDINGS = ['', 'а', 'ы', 'ом', 'ами', 'ой'];
const topics = Array.from({ length: 40 }, (_, i) => Array.from({ length: 25 }, (_, j) => stems[(i * 31 + j * 7) % stems.length] + ['ик', 'ов', 'ан'][i % 3]));
const word = () => stems[Math.min(stems.length - 1, Math.floor(Math.exp(rnd() * Math.log(stems.length))))] + pick(ENDINGS);
const note = (i: number, tp = topics[i % topics.length]) => ({
  id: 'n' + i,
  title: pick(tp) + ' ' + i,
  text: Array.from({ length: 3 + Math.floor(rnd() * 15) }, () => Array.from({ length: 8 }, () => (rnd() < 0.3 ? pick(tp) : word())).join(' ') + '.').join(' '),
});

describe('сборка порциями и точечное обновление', () => {
  const notes = Array.from({ length: 800 }, (_, i) => note(i));
  const docs = notes.map((d) => ({ id: d.id, f: L.extractFeatures(d) }));
  const full = L.buildIndex(docs);

  test('сборка порциями — тот же индекс', async () => {
    const a = await L.buildIndexAsync(docs, {}, 1);
    for (let i = 0; i < 100; i++) {
      const id = 'n' + i * 7;
      assert.deepEqual(L.relatedTo(a, id, { limit: 8 }), L.relatedTo(full, id, { limit: 8 }));
    }
    assert.deepEqual(L.findDuplicates(a, a.docs.keys()), L.findDuplicates(full, full.docs.keys()));
  });

  test('правка записи: её связи — как при полной пересборке, остальные почти те же', () => {
    // запись n5 переписана на тему n6
    const edited = { ...notes[5], text: note(6, topics[6]).text + ' ' + note(46, topics[6]).text };
    const docs2 = docs.map((d) => (d.id === 'n5' ? { id: 'n5', f: L.extractFeatures(edited) } : d));
    const patched = L.patchIndex(full, docs2)!;
    assert.ok(patched, 'одна правка — точечно');
    assert.equal(patched.patches, 1);
    assert.deepEqual([...patched.changed!], ['n5']);
    const rebuilt = L.buildIndex(docs2);
    const ids = (ix: typeof full, id: string) => L.relatedTo(ix, id, { limit: 8 }).map((r) => r.id);
    // изменённая запись — теперь в теме 6
    const r5 = ids(patched, 'n5');
    assert.ok(r5.filter((id) => Number(id.slice(1)) % 40 === 6).length >= r5.length * 0.7, r5.join(','));
    let same = 0;
    for (let i = 0; i < 200; i++) {
      const a = ids(patched, 'n' + i * 4);
      const b = ids(rebuilt, 'n' + i * 4);
      same += a.filter((x) => b.includes(x)).length / Math.max(1, new Set([...a, ...b]).size);
    }
    assert.ok(same / 200 > 0.95, String(same / 200));
    // без изменений — тот же индекс
    assert.equal(L.patchIndex(full, docs), full);
  });

  test('новая и удалённая записи; повторное обновление поверх обновлённого', () => {
    const extra = note(900, topics[3]);
    const docs2 = [...docs.filter((d) => d.id !== 'n10'), { id: 'n900', f: L.extractFeatures(extra) }];
    const p1 = L.patchIndex(full, docs2)!;
    assert.ok(!p1.docs.has('n10'));
    assert.ok(p1.docs.has('n900'));
    assert.equal(p1.n, full.n);
    for (const r of L.relatedTo(p1, 'n13', { limit: 20 })) assert.notEqual(r.id, 'n10', 'удалённая не всплывает в связях');
    assert.ok(L.relatedTo(p1, 'n900', { limit: 8 }).some((r) => Number(r.id.slice(1)) % 40 === 3));
    // поиск по словам новой записи её находит
    assert.ok(L.searchIndex(p1, extra.title).some((h) => h.id === 'n900'));
    const docs3 = docs2.map((d) => (d.id === 'n900' ? { id: 'n900', f: L.extractFeatures({ ...extra, text: extra.text + ' дополнение' }) } : d));
    const p2 = L.patchIndex(p1, docs3)!;
    assert.equal(p2.patches, p1.patches + 1);
    assert.equal(p2.base, p1);
  });

  test('много правок сразу, другие решения по парам или синонимы — полная пересборка', () => {
    const many = docs.map((d, i) => (i < 60 ? { id: d.id, f: L.extractFeatures({ ...notes[i], text: notes[i].text + ' правка' }) } : d));
    assert.equal(L.patchIndex(full, many), null);
    const one = docs.map((d) => (d.id === 'n1' ? { id: 'n1', f: L.extractFeatures({ ...notes[1], text: 'x y z' }) } : d));
    assert.equal(L.patchIndex(full, one, { pairs: new Map([['n1|n2', true]]) }), null);
    assert.equal(L.patchIndex(full, one, { synonyms: [['a', 'b']] }), null);
  });
});

describe('скорость на 2000 записях', () => {
  const notes = Array.from({ length: 2000 }, (_, i) => note(i));
  // и почти-копии
  for (let i = 0; i < 20; i++) notes.push({ id: 'dup' + i, title: notes[i * 50].title + ' копия', text: notes[i * 50].text + ' ещё' });
  const docs = notes.map((d) => ({ id: d.id, f: L.extractFeatures(d) }));
  const ix = L.buildIndex(docs);

  test('все дубли — быстро и все найдены', () => {
    const t = performance.now();
    const d = L.findDuplicates(ix, ix.docs.keys());
    const ms = performance.now() - t;
    for (let i = 0; i < 20; i++) assert.ok(d.some((p) => (p.a === 'dup' + i || p.b === 'dup' + i) && (p.a === 'n' + i * 50 || p.b === 'n' + i * 50)), 'dup' + i);
    assert.ok(ms < 3000, `${ms.toFixed(0)} мс`);
  });

  test('все связи графа и точечное обновление — быстро', () => {
    let t = performance.now();
    L.allLinks(ix);
    const graph = performance.now() - t;
    assert.ok(graph < 4000, `граф: ${graph.toFixed(0)} мс`);
    const edited = docs.map((d) => (d.id === 'n7' ? { id: 'n7', f: L.extractFeatures({ ...notes[7], text: notes[7].text + ' новое слово' }) } : d));
    t = performance.now();
    const p = L.patchIndex(ix, edited);
    const patch = performance.now() - t;
    assert.ok(p);
    assert.ok(patch < 400, `точечно: ${patch.toFixed(0)} мс`);
  });
});
