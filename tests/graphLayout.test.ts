import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bounds, ForceLayout, type GLink, type GNode, spiralPosition } from '../src/notes/graphLayout.ts';

const mkNodes = (n: number): GNode[] => Array.from({ length: n }, (_, i) => ({ id: 'n' + i, ...spiralPosition(i), vx: 0, vy: 0, deg: 0 }));
const dist = (a: GNode, b: GNode) => Math.hypot(a.x - b.x, a.y - b.y);
const finite = (ns: GNode[]) => ns.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));

/** k кучек по size узлов: внутри кучки — связи по кругу и через одного, между кучками — ничего */
function clusters(k: number, size: number): { nodes: GNode[]; links: GLink[]; group: number[] } {
  const nodes = mkNodes(k * size);
  const links: GLink[] = [];
  const group: number[] = [];
  for (let c = 0; c < k; c++)
    for (let i = 0; i < size; i++) {
      const a = c * size + i;
      group[a] = c;
      links.push({ s: a, t: c * size + ((i + 1) % size), w: 0.4 });
      links.push({ s: a, t: c * size + ((i + 2) % size), w: 0.2 });
    }
  return { nodes, links, group };
}

describe('раскладка графа', () => {
  test('остывает и останавливается', () => {
    const { nodes, links } = clusters(4, 10);
    const lay = new ForceLayout(nodes, links);
    const ticks = lay.run(2000);
    assert.ok(!lay.active, 'остыла');
    assert.ok(ticks < 2000 && ticks > 50, `тиков: ${ticks}`);
    assert.ok(finite(nodes));
  });

  test('связанные узлы ближе друг к другу, чем к чужим кучкам', () => {
    const { nodes, links, group } = clusters(5, 12);
    new ForceLayout(nodes, links).run();
    let inSum = 0;
    let inN = 0;
    let outSum = 0;
    let outN = 0;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const d = dist(nodes[i], nodes[j]);
        if (group[i] === group[j]) {
          inSum += d;
          inN++;
        } else {
          outSum += d;
          outN++;
        }
      }
    const ratio = outSum / outN / (inSum / inN);
    assert.ok(ratio > 2, `чужие дальше своих в ${ratio.toFixed(2)} раза`);
  });

  test('узлы не слипаются', () => {
    const { nodes, links } = clusters(3, 15);
    new ForceLayout(nodes, links).run();
    let min = Infinity;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) min = Math.min(min, dist(nodes[i], nodes[j]));
    assert.ok(min > 4, `минимальное расстояние ${min.toFixed(1)}`);
  });

  test('одиночки не разлетаются далеко', () => {
    const { nodes, links } = clusters(2, 8);
    const all = [...nodes, ...mkNodes(10).map((n, i) => ({ ...n, id: 'solo' + i, ...spiralPosition(nodes.length + i) }))];
    new ForceLayout(all, links).run();
    const b = bounds(all)!;
    assert.ok(b.x1 - b.x0 < 2000 && b.y1 - b.y0 < 2000, JSON.stringify(b));
    assert.ok(finite(all));
  });

  test('совпавшие точки и пустой граф не ломают раскладку', () => {
    const same: GNode[] = Array.from({ length: 6 }, (_, i) => ({ id: 's' + i, x: 0, y: 0, vx: 0, vy: 0, deg: 0 }));
    new ForceLayout(same, [{ s: 0, t: 1, w: 0.5 }]).run();
    assert.ok(finite(same));
    assert.ok(dist(same[2], same[3]) > 1, 'разошлись');
    const empty = new ForceLayout([], []);
    empty.tick();
    assert.equal(bounds([]), null);
  });

  test('закреплённый узел стоит на месте, остальные подстраиваются', () => {
    const { nodes, links } = clusters(1, 6);
    const lay = new ForceLayout(nodes, links);
    lay.run();
    nodes[0].fx = 300;
    nodes[0].fy = -200;
    lay.reheat(0.5);
    lay.run();
    assert.equal(nodes[0].x, 300);
    assert.equal(nodes[0].y, -200);
    assert.ok(dist(nodes[1], nodes[0]) < 200, 'соседи подтянулись');
  });

  test('одинаковый вход — одинаковая раскладка', () => {
    const a = clusters(3, 7);
    const b = clusters(3, 7);
    new ForceLayout(a.nodes, a.links).run();
    new ForceLayout(b.nodes, b.links).run();
    assert.deepEqual(
      a.nodes.map((n) => [n.x, n.y]),
      b.nodes.map((n) => [n.x, n.y]),
    );
  });

  test('на высоком экране граф вытягивается по вертикали', () => {
    const wide = clusters(6, 8);
    const tall = clusters(6, 8);
    new ForceLayout(wide.nodes, wide.links).run();
    const lay = new ForceLayout(tall.nodes, tall.links);
    lay.aspect = 2;
    lay.run();
    const ratio = (ns: GNode[]) => {
      const b = bounds(ns)!;
      return (b.y1 - b.y0) / (b.x1 - b.x0);
    };
    assert.ok(ratio(tall.nodes) > ratio(wide.nodes) * 1.3, `${ratio(tall.nodes).toFixed(2)} против ${ratio(wide.nodes).toFixed(2)}`);
  });

  test('2000 узлов: тик быстрый', () => {
    const { nodes, links } = clusters(100, 20);
    const lay = new ForceLayout(nodes, links);
    const t = performance.now();
    for (let i = 0; i < 30; i++) lay.tick();
    const per = (performance.now() - t) / 30;
    console.log(`  тик на 2000 узлов: ${per.toFixed(1)} мс`);
    assert.ok(per < 60, `${per} мс`);
    assert.ok(finite(nodes));
  });
});
