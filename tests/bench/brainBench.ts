/**
 * Замер «второго мозга» на большой базе: N заметок живого русского текста (слова из реальных заметок,
 * с окончаниями), темы, [[ссылки]], задачи. Не входит в npm test — запуск:
 *   node tests/bench/brainBench.ts [N=5000]
 * Телефон в 4–8 раз медленнее компьютера — смотреть на порядок цифр, а не на точные мс.
 */
import '../tsResolve.ts';
import { CORPUS } from '../fixtures/corpus.ts';

const L = await import('../../src/notes/links.ts');
const { reviewFindings } = await import('../../src/notes/reviewCore.ts');
const { brainBriefOf } = await import('../../src/notes/brainBrief.ts');
const { parseVault } = await import('../../src/notes/obsidianImport.ts');
const { itemId } = await import('../../src/notes/brainDocs.ts');

const N = Number(process.argv[2]) || 5000;

let seed = 42;
const rnd = () => {
  let t = (seed = (seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

// словарь: настоящие слова из живых заметок + словоформы (окончания) — чтобы работал стеммер
const base = [...new Set(CORPUS.flatMap((f) => (f.title + ' ' + f.text).toLowerCase().match(/[а-яё]{4,}/g) ?? []))];
const ENDINGS = ['', 'а', 'ы', 'ом', 'ами', 'ой', 'ую', 'ых', 'ее', 'ого', 'ению', 'ость'];
const stems = base.map((w) => w.replace(/[аеиоуыэюяйь]+$/, ''));
// 150 тем: у каждой — свои 30 «предметных» слов (основа + суффикс темы), остальное — общий фон
const topics = Array.from({ length: 150 }, (_, i) => Array.from({ length: 30 }, (_, j) => stems[(i * 31 + j * 7) % stems.length] + ['ик', 'ов', 'ан', 'ер', 'он'][i % 5]));
const word = () => {
  // закон Ципфа по общему словарю
  const s = stems[Math.min(stems.length - 1, Math.floor(Math.exp(rnd() * Math.log(stems.length))))];
  return s + pick(ENDINGS);
};
const sentence = (tp: string[]) => {
  const n = 6 + Math.floor(rnd() * 12);
  const ws = Array.from({ length: n }, () => (rnd() < 0.3 ? pick(tp) + pick(ENDINGS) : word()));
  ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1);
  return ws.join(' ') + '.';
};
const titles: string[] = [];
const notes = Array.from({ length: N }, (_, i) => {
  const tp = topics[i % topics.length];
  const title = (pick(tp) + ' ' + word()).replace(/^./, (c) => c.toUpperCase()) + ' ' + i;
  titles.push(title);
  // размер: много коротких, немного длинных (от 20 до ~1500 слов)
  const sentences = Math.max(2, Math.floor(Math.exp(rnd() * Math.log(120))));
  const paras: string[] = [];
  for (let s = 0; s < sentences; s += 4) paras.push(Array.from({ length: Math.min(4, sentences - s) }, () => sentence(tp)).join(' '));
  // иногда — [[ссылка]] на другую заметку
  if (rnd() < 0.15 && i > 0) paras.push(`См. [[${titles[Math.floor(rnd() * i)]}]].`);
  return { id: 'n' + i, title, text: paras.join('\n\n'), updatedAt: Date.now() - Math.floor(rnd() * 400) * 86400000 };
});
const words = notes.reduce((n, d) => n + d.text.split(/\s+/).length, 0);

const rows: [string, number, string?][] = [];
const time = <T>(label: string, fn: () => T, note?: string): T => {
  const t = performance.now();
  const r = fn();
  rows.push([label, performance.now() - t, note]);
  return r;
};

const feats = time('признаки всех заметок (extractFeatures)', () => notes.map((d) => ({ id: d.id, f: L.extractFeatures(d) })));
const ix = time('индекс (buildIndex) — один раз; правки — точечно', () => L.buildIndex(feats));
time('точечное обновление после правки заметки (patchIndex)', () => {
  const edited = feats.map((d, i) => (i === 7 ? { id: d.id, f: L.extractFeatures({ title: notes[7].title, text: notes[7].text + ' новая мысль' }) } : d));
  return L.patchIndex(ix, edited);
}, 'после каждой паузы в наборе');
time('связи одной заметки × 100 (relatedTo)', () => {
  for (let i = 0; i < 100; i++) L.relatedTo(ix, 'n' + ((i * 37) % N), { limit: 8 });
}, 'открытие заметки');
const edges = time('все связи для графа (allLinks)', () => L.allLinks(ix));
const clusters = time('темы графа (clusterGraph)', () =>
  L.clusterGraph(
    [...ix.docs.keys()],
    edges.map((e) => ({ a: e.a, b: e.b, score: e.score })),
  ),
);
time('названия тем (clusterTopics)', () => L.clusterTopics(ix, clusters));
time('поиск × 20 (searchIndex)', () => {
  for (let i = 0; i < 20; i++) L.searchIndex(ix, topics[i][0] + ' ' + topics[i][3] + ' ' + word(), { limit: 8 });
}, '«Спросить у мозга»');
time('все дубли (findDuplicates)', () => L.findDuplicates(ix, ix.docs.keys()));
time('словарь для синонимов (vocabulary)', () => L.vocabulary(ix, 300));
const mx = time('индекс упоминаний (buildMentionIndex)', () => L.buildMentionIndex(notes.map((n) => ({ id: n.id, title: n.title })), { canon: ix.canonLex }));
time('упоминания в 200 заметках (findMentions)', () => {
  for (let i = 0; i < 200; i++) L.findMentions(notes[(i * 13) % N].text, mx);
}, 'подсветка названий в тексте');
time('обзор мозга (reviewFindings, связи — из графа)', () => {
  const near = new Map<string, string[]>();
  for (const e of edges) {
    (near.get(e.a) ?? near.set(e.a, []).get(e.a)!).push(e.b);
    (near.get(e.b) ?? near.set(e.b, []).get(e.b)!).push(e.a);
  }
  return reviewFindings({
    notes: notes.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt, wordCount: n.text.split(/\s+/).length })),
    related: (id) => near.get(id) ?? [],
    wiki: () => false,
    recent: new Map(notes.filter((n) => n.updatedAt > Date.now() - 7 * 86400000).map((n) => [n.id, n.updatedAt])),
    now: Date.now(),
  });
});
time('утренняя сводка (brainBriefOf)', () =>
  brainBriefOf({
    day: '2026-10-15',
    now: Date.now(),
    notes: notes.map((n) => ({ id: n.id, title: n.title, preview: '', createdAt: n.updatedAt, updatedAt: n.updatedAt })),
    cards: [],
    taskIds: [],
    ix,
  }),
);
time(`разбор хранилища Obsidian (${N} .md)`, () => parseVault(notes.map((n) => ({ path: `Vault/${n.title}.md`, text: n.text }))));
void itemId;

console.log(`\nВторой мозг: ${N} заметок, ${(words / 1000).toFixed(0)} тыс. слов, связей на графе: ${edges.length}, тем: ${new Set(clusters.values()).size}\n`);
for (const [l, ms, note] of rows) console.log(`${ms.toFixed(0).padStart(7)} мс  ${l}${note ? `  — ${note}` : ''}`);
const mem = process.memoryUsage();
console.log(`\nпамять: ${(mem.heapUsed / 1048576).toFixed(0)} МБ`);
