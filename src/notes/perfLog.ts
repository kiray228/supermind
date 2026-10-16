/**
 * Журнал скорости второго мозга на этом устройстве: сколько заняли разбор заметок, сборка индекса,
 * точечное обновление, граф, обзор и дубли — и на скольких записях. Видно, если на телефоне что-то медленно.
 */

export type PerfOp = 'features' | 'index' | 'patch' | 'graph' | 'graph-patch' | 'review' | 'dups';

export interface PerfEntry {
  at: number;
  op: PerfOp;
  ms: number;
  /** записей в мозге (или обработано — для разбора) */
  n: number;
}

export const PERF_LABEL: Record<PerfOp, string> = {
  features: 'Разбор новых и изменённых записей',
  index: 'Полная сборка индекса',
  patch: 'Обновление после правки',
  graph: 'Связи для графа',
  'graph-patch': 'Граф после правки',
  review: 'Обзор мозга',
  dups: 'Поиск дублей',
};

/** медленно — с какого времени (мс) стоит насторожиться */
export const PERF_SLOW: Record<PerfOp, number> = { features: 15000, index: 6000, patch: 800, graph: 10000, 'graph-patch': 1500, review: 5000, dups: 5000 };

const KEY = 'sm-brain-perf';
const MAX = 80;
let buf: PerfEntry[] | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function entries(): PerfEntry[] {
  if (!buf) {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      buf = Array.isArray(v) ? v.filter((x) => x && typeof x.ms === 'number' && x.op in PERF_LABEL) : [];
    } catch {
      buf = [];
    }
  }
  return buf;
}

/** Записать замер (пустяки — меньше 5 мс — не пишем) */
export function logPerf(op: PerfOp, ms: number, n: number, at = Date.now()) {
  if (ms < 5) return;
  const list = entries();
  list.push({ at, op, ms: Math.round(ms), n });
  if (list.length > MAX) list.splice(0, list.length - MAX);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(entries()));
    } catch {
      /* не страшно */
    }
  }, 2000);
}

/** Засечь время: const done = perfStart(); …; done('index', n) */
export const perfStart = () => {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return (op: PerfOp, n: number) => logPerf(op, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t, n);
};

export interface PerfRow {
  op: PerfOp;
  label: string;
  /** медиана последних замеров */
  ms: number;
  /** самый долгий из последних */
  max: number;
  n: number;
  count: number;
  slow: boolean;
}

/** Сводка по последним (до 5) замерам каждого вида */
export function perfSummary(list: PerfEntry[] = entries()): PerfRow[] {
  const rows: PerfRow[] = [];
  for (const op of Object.keys(PERF_LABEL) as PerfOp[]) {
    const last = list.filter((e) => e.op === op).slice(-5);
    if (!last.length) continue;
    const sorted = last.map((e) => e.ms).sort((a, b) => a - b);
    const ms = sorted[Math.floor(sorted.length / 2)];
    rows.push({ op, label: PERF_LABEL[op], ms, max: sorted[sorted.length - 1], n: last[last.length - 1].n, count: list.filter((e) => e.op === op).length, slow: ms >= PERF_SLOW[op] });
  }
  return rows;
}

export const fmtMs = (ms: number) => (ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} с`);

/** Текст отчёта — скопировать и прислать разработчику */
export function perfReport(device: string, notes: number, list: PerfEntry[] = entries()): string {
  const rows = perfSummary(list);
  const lines = [`SuperMind — скорость второго мозга`, `Устройство: ${device}`, `Заметок: ${notes}`, ''];
  for (const r of rows) lines.push(`${r.label}: ${fmtMs(r.ms)} (макс. ${fmtMs(r.max)}, записей ${r.n}, замеров ${r.count})${r.slow ? ' — МЕДЛЕННО' : ''}`);
  if (!rows.length) lines.push('Замеров пока нет.');
  return lines.join('\n');
}

/** только для тестов */
export function resetPerf(list: PerfEntry[] = []) {
  buf = list;
}
