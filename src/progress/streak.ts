/**
 * Общая серия активных дней с «заморозками» (без зависимостей — проверяется тестами в node).
 * Каждые 7 активных дней подряд дают 1 заморозку (копится не больше 2). Пропущенный день
 * закрывается заморозкой автоматически — серия не рвётся, но и не растёт.
 * Ничего не хранится: всё выводится из истории активных дней, поэтому одинаково на всех устройствах.
 */

export const FREEZE_EVERY = 7;
export const FREEZE_MAX = 2;

export interface DayStreak {
  /** активных дней в текущей серии (может закончиться вчера — сегодня ещё не потеряно) */
  current: number;
  /** лучшая серия */
  best: number;
  /** заморозок потрачено в текущей серии */
  freezesUsed: number;
  /** заморозок в запасе */
  banked: number;
  /** все дни, закрытые заморозкой (для тепловой карты) */
  frozen: string[];
  /** активных дней за последние 30 (включая сегодня) */
  rolling30: number;
}

const DAY = 86400000;
const toN = (ymd: string) => Math.round(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / DAY);
const toYmdN = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

export function dayStreak(days: Iterable<string>, today: string): DayStreak {
  const t = toN(today);
  const set = new Set<number>();
  for (const d of days) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today) set.add(toN(d));
  let rolling30 = 0;
  for (let i = 0; i < 30; i++) if (set.has(t - i)) rolling30++;
  const out: DayStreak = { current: 0, best: 0, freezesUsed: 0, banked: 0, frozen: [], rolling30 };
  if (!set.size) return out;
  const first = Math.min(...set);
  let run = 0;
  let used = 0;
  let banked = 0;
  let earn = 0;
  // заморозки после последнего активного дня: если серия всё же прервётся, они ничего не спасли
  let tail = 0;
  // сегодня без активности — ещё не пропуск: серию считаем по вчерашний день
  const last = set.has(t) ? t : t - 1;
  for (let n = first; n <= last; n++) {
    if (set.has(n)) {
      run++;
      tail = 0;
      if (++earn >= FREEZE_EVERY) {
        earn = 0;
        banked = Math.min(FREEZE_MAX, banked + 1);
      }
      if (run > out.best) out.best = run;
    } else if (run > 0 && banked > 0) {
      banked--;
      used++;
      tail++;
      out.frozen.push(toYmdN(n));
    } else {
      if (tail) out.frozen.length -= tail;
      tail = 0;
      run = 0;
      used = 0;
      banked = 0;
      earn = 0;
    }
  }
  out.current = run;
  out.freezesUsed = run ? used : 0;
  out.banked = run ? banked : 0;
  return out;
}
