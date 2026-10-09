/**
 * «Что уже видели» (только на этом устройстве): для поздравлений с уровнем, достижениями и вехами серии.
 * Поздравляет ProgressWatcher (где бы ни был пользователь), раздел «Прогресс» лишь помечает новые награды.
 */

const SEEN_KEY = 'sm-progress-seen';
/** новые достижения, ещё не просмотренные в разделе «Прогресс» */
const FRESH_KEY = 'sm-progress-fresh';
/** вехи текущей серии, с которыми уже поздравили */
const MILESTONES_KEY = 'sm-streak-milestones';

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 365];

export interface Seen {
  level: number;
  ach: string[];
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* без сохранения */
  }
}

export function readSeen(): Seen | null {
  const v = read<Seen>(SEEN_KEY);
  return v && typeof v.level === 'number' && Array.isArray(v.ach) ? v : null;
}
export const writeSeen = (s: Seen) => write(SEEN_KEY, s);

export function addFresh(ids: string[]) {
  const cur = read<string[]>(FRESH_KEY);
  write(FRESH_KEY, [...new Set([...(Array.isArray(cur) ? cur : []), ...ids])]);
}

/** Новые награды с прошлого визита в «Прогресс» */
export function peekFresh(): Set<string> {
  const cur = read<string[]>(FRESH_KEY);
  return new Set(Array.isArray(cur) ? cur : []);
}

/** Награды показаны в «Прогрессе» — дальше они уже не новые */
export function clearFresh(ids: Set<string>) {
  const cur = read<string[]>(FRESH_KEY);
  write(FRESH_KEY, (Array.isArray(cur) ? cur : []).filter((id) => !ids.has(id)));
}

export function readMilestones(): number[] | null {
  const v = read<number[]>(MILESTONES_KEY);
  return Array.isArray(v) ? v.filter((x) => typeof x === 'number') : null;
}
export const writeMilestones = (v: number[]) => write(MILESTONES_KEY, [...new Set(v)].sort((a, b) => a - b));
