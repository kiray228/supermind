import type { FloatingTopic, ID, Sheet, Topic } from '../types';

export function uid(): ID {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newTopic(text = '', children: Topic[] = []): Topic {
  return { id: uid(), text, children };
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Обход дерева (pre-order). Возврат false из cb прекращает спуск в детей. */
export function walk(
  t: Topic,
  cb: (t: Topic, parent: Topic | null, depth: number) => void | false,
  parent: Topic | null = null,
  depth = 0,
) {
  if (cb(t, parent, depth) === false) return;
  for (const c of t.children) walk(c, cb, t, depth + 1);
}

/** Все корни листа: центральная тема + плавающие */
export function sheetRoots(s: Sheet): Topic[] {
  return [s.root, ...s.floating];
}

export function walkSheet(s: Sheet, cb: (t: Topic, parent: Topic | null, depth: number) => void | false) {
  for (const r of sheetRoots(s)) walk(r, cb);
}

/** Сколько уровней под темой (0 — подтем нет) */
export function treeDepth(t: Topic): number {
  let n = 0;
  walk(t, (_x, _p, d) => {
    if (d > n) n = d;
  });
  return n;
}

/**
 * Если ветви свёрнуты ровно «до уровня N» (видны N уровней под корнями) — N;
 * всё развёрнуто — Infinity; свёрнуто вразнобой — null.
 */
export function shownLevel(roots: Topic[]): number | null {
  let n = Infinity;
  for (const r of roots)
    walk(r, (t, _p, d) => {
      if (t.children.length && t.collapsed) {
        n = Math.min(n, d);
        return false;
      }
    });
  if (n === Infinity) return n;
  let ok = true;
  for (const r of roots)
    walk(r, (t, _p, d) => {
      if (d < n) return;
      if (t.children.length && !t.collapsed) ok = false;
      return false;
    });
  return ok ? n : null;
}

export interface Found {
  topic: Topic;
  parent: Topic | null;
  index: number;
  /** корень, в котором найдено */
  root: Topic;
  depth: number;
}

export function findInSheet(s: Sheet, id: ID): Found | null {
  for (const r of sheetRoots(s)) {
    const f = findIn(r, id);
    if (f) return f;
  }
  return null;
}

export function findIn(root: Topic, id: ID): Found | null {
  let res: Found | null = null;
  walk(root, (t, parent, depth) => {
    if (res) return false;
    if (t.id === id) {
      res = { topic: t, parent, index: parent ? parent.children.indexOf(t) : 0, root, depth };
      return false;
    }
  });
  return res;
}

export function isFloating(s: Sheet, id: ID): FloatingTopic | undefined {
  return s.floating.find((f) => f.id === id);
}

/** Является ли a предком b (или равен) */
export function isAncestor(s: Sheet, a: ID, b: ID): boolean {
  const fa = findInSheet(s, a);
  if (!fa) return false;
  return !!findIn(fa.topic, b);
}

/** Путь от корня до темы */
export function pathTo(s: Sheet, id: ID): Topic[] {
  for (const r of sheetRoots(s)) {
    const p: Topic[] = [];
    const rec = (t: Topic): boolean => {
      p.push(t);
      if (t.id === id) return true;
      for (const c of t.children) if (rec(c)) return true;
      p.pop();
      return false;
    };
    if (rec(r)) return p;
  }
  return [];
}

export function countTopics(s: Sheet): number {
  let n = 0;
  walkSheet(s, () => {
    n++;
  });
  return n;
}

/** Пересоздать id во всём поддереве (при вставке копии) */
export function reId(t: Topic): Topic {
  const c = clone(t);
  walk(c, (x) => {
    x.id = uid();
  });
  return c;
}

/** Видимые (не свёрнутые) потомки в порядке обхода */
export function visibleOrder(s: Sheet): Topic[] {
  const out: Topic[] = [];
  for (const r of sheetRoots(s)) {
    walk(r, (t) => {
      out.push(t);
      if (t.collapsed) return false;
    });
  }
  return out;
}

export function plainText(t: Topic, depth = 0): string {
  let s = '  '.repeat(depth) + '- ' + (t.text || '') + '\n';
  for (const c of t.children) s += plainText(c, depth + 1);
  return s;
}
