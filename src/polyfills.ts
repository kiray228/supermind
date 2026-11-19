/**
 * Недостающее в старых встроенных браузерах (Android WebView до Chrome 98, ранние iOS 16).
 * Подключается первым в main.tsx: без structuredClone приложение падало при открытии карт и «Сегодня»
 * (отчёты об ошибках 1.51–1.52 с Android).
 */

type AnyRec = Record<PropertyKey, unknown>;

/** Глубокая копия как у structuredClone: объекты, массивы, Date, Map, Set, RegExp, типизированные массивы; циклы сохраняются. */
export function cloneDeep<T>(value: T, seen = new Map<unknown, unknown>()): T {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') throw new DOMException('could not be cloned', 'DataCloneError');
    return value;
  }
  if (seen.has(value)) return seen.get(value) as T;
  const v = value as unknown;
  if (v instanceof Date) return new Date(v.getTime()) as T;
  if (v instanceof RegExp) return new RegExp(v.source, v.flags) as T;
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v as T; // неизменяемый — копия не нужна
  if (v instanceof ArrayBuffer) return v.slice(0) as T;
  if (ArrayBuffer.isView(v)) {
    const C = (v as unknown as { constructor: new (b: ArrayBuffer) => T }).constructor;
    const src = v as ArrayBufferView;
    return new C(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength) as ArrayBuffer);
  }
  if (v instanceof Map) {
    const out = new Map();
    seen.set(v, out);
    v.forEach((val, key) => out.set(cloneDeep(key, seen), cloneDeep(val, seen)));
    return out as T;
  }
  if (v instanceof Set) {
    const out = new Set();
    seen.set(v, out);
    v.forEach((val) => out.add(cloneDeep(val, seen)));
    return out as T;
  }
  if (Array.isArray(v)) {
    const out: unknown[] = new Array(v.length);
    seen.set(v, out);
    for (let i = 0; i < v.length; i++) out[i] = cloneDeep(v[i], seen);
    return out as T;
  }
  // обычный объект (класс теряется — как и у structuredClone); функции в полях — ошибка, как в оригинале
  const out: AnyRec = {};
  seen.set(v, out);
  for (const k of Object.keys(v as AnyRec)) {
    const x = (v as AnyRec)[k];
    if (typeof x === 'function') throw new DOMException('could not be cloned', 'DataCloneError');
    out[k] = cloneDeep(x, seen);
  }
  return out as T;
}

const g = globalThis as unknown as AnyRec;

if (typeof g.structuredClone !== 'function') {
  g.structuredClone = <T>(v: T) => cloneDeep(v);
}

function define(proto: object, name: string, fn: unknown) {
  if (!(name in proto)) Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
}

// Chrome 92
define(Array.prototype, 'at', function (this: unknown[], i: number) {
  const n = Math.trunc(i) || 0;
  return this[n < 0 ? this.length + n : n];
});
define(String.prototype, 'at', function (this: string, i: number) {
  const n = Math.trunc(i) || 0;
  return this.charAt(n < 0 ? this.length + n : n) || undefined;
});
if (typeof (Object as unknown as AnyRec).hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', { value: (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k), writable: true, configurable: true });
}
// Chrome 97
define(Array.prototype, 'findLast', function (this: unknown[], f: (x: unknown, i: number, a: unknown[]) => unknown, t?: unknown) {
  for (let i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i];
  return undefined;
});
define(Array.prototype, 'findLastIndex', function (this: unknown[], f: (x: unknown, i: number, a: unknown[]) => unknown, t?: unknown) {
  for (let i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i;
  return -1;
});
// Chrome 110
define(Array.prototype, 'toSorted', function (this: unknown[], cmp?: (a: unknown, b: unknown) => number) {
  return this.slice().sort(cmp);
});
define(Array.prototype, 'toReversed', function (this: unknown[]) {
  return this.slice().reverse();
});
