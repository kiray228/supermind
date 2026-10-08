import { addDaysYmd, fromYmd, todayYmd, toYmd } from '../utils/mapTasks';
import type { Priority, RepeatRule } from './model';
import { minutesOf, pad2 } from './model';

/**
 * Разбор быстрого ввода задачи на русском (как «умный ввод» в TickTick):
 * «Позвонить маме завтра в 18:30 каждую неделю !1 #семья ~Личное напомнить за 15 минут»
 */
export interface ParsedTask {
  title: string;
  date?: string;
  time?: string;
  duration?: number;
  priority?: Priority;
  tags: string[];
  /** название списка после ~ */
  list?: string;
  repeat?: RepeatRule;
  reminder?: number;
  /** дата не написана, а подставлена (сегодня/завтра по времени) — у выбранного дня приоритет */
  dateImplicit?: boolean;
  /** найденные фрагменты [начало, конец) — для подсветки */
  spans: [number, number][];
}

const B = '(?<=^|[\\s,.;:()])';
/** после «в N» без минут: время, только если дальше конец текста или дата/метка */
/** после числа идёт единица измерения — это не дата */
const UNIT_NEXT = /^(час|мин|сек|л(?![а-яё])|литр|мл|кг|г(?![а-яё])|гр|грам|м(?![а-яё])|км|см|мм|%|раз|шт|руб|₽|\$|тыс|недел|дн|лет|год|месяц|подход|повтор|круг|стакан|страниц|глав|человек|чел(?![а-яё]))/i;
const BARE_HOUR_NEXT = /^($|[#!~^,.]|сегодня|завтра|послезавтра|кажд|ежедн|еженед|по |в |во |на |напомн|через|\d{1,2}[./]\d|\d{1,2}\s+[а-яё]{3})/i;
const E = '(?=$|[\\s,.;:!?()])';

const MONTHS: [RegExp, number][] = [
  [/^янв/, 0],
  [/^фев/, 1],
  [/^мар/, 2],
  [/^апр/, 3],
  [/^ма[йя]/, 4],
  [/^июн/, 5],
  [/^июл/, 6],
  [/^авг/, 7],
  [/^сен/, 8],
  [/^окт/, 9],
  [/^ноя/, 10],
  [/^дек/, 11],
];
const MONTH_RE = '(январ[ья]|янв|феврал[ья]|фев|марта?|мар|апрел[ья]|апр|мая|май|июн[ья]|июн|июл[ья]|июл|августа?|авг|сентябр[ья]|сен|сент|октябр[ья]|окт|ноябр[ья]|ноя|декабр[ья]|дек)';

const WD: [RegExp, number][] = [
  [/^понедельник|^пн/, 1],
  [/^вторник|^вт/, 2],
  [/^сред|^ср/, 3],
  [/^четверг|^чт/, 4],
  [/^пятниц|^пт/, 5],
  [/^суббот|^сб/, 6],
  [/^воскресень|^вс/, 0],
];
const WD_RE = '(понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям|понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье|пн|вт|ср|чт|пт|сб|вс)';
/** перед «в N» уже стоит дата («завтра в 8 бег») — голый час тоже время */
const DATE_BEFORE = new RegExp(`(?:^|[\\s,])(сегодня|завтра|послезавтра|${WD_RE}|\\d{1,2}[./]\\d{1,2}(?:[./]\\d{2,4})?|\\d{1,2}\\s+${MONTH_RE}\\.?)\\s*$`, 'i');
const U_MIN = 'минуту|минуты|минут|мин';
const U_HOUR = 'часов|часа|час|ч';
const U_DAY = 'день|дня|дней';
const U_WEEK = 'неделю|недели|недель|нед';
const U_MONTH = 'месяцев|месяца|месяц|мес';
const U_YEAR = 'года|год|лет';

function wdOf(s: string): number {
  for (const [re, n] of WD) if (re.test(s)) return n;
  return 1;
}
function monthOf(s: string): number {
  for (const [re, n] of MONTHS) if (re.test(s)) return n;
  return 0;
}

const NUM_WORDS: Record<string, number> = { один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, десять: 10, полчаса: 30 };
const numOf = (s: string | undefined) => (s ? (NUM_WORDS[s] ?? Number(s)) || 1 : 1);
const NUM_RE = '(\\d+|один|одну|два|две|три|четыре|пять|шесть|семь|десять)';

/** Ближайший день недели (сегодня не считается, если strictFuture) */
function nextWeekday(today: string, wd: number, strictFuture = false): string {
  const cur = fromYmd(today).getDay();
  let diff = (wd - cur + 7) % 7;
  if (diff === 0 && strictFuture) diff = 7;
  return addDaysYmd(today, diff);
}

export function parseTask(input: string, now = new Date()): ParsedTask {
  const today = toYmd(now);
  const spans: [number, number][] = [];
  const out: ParsedTask = { title: '', tags: [], spans };
  let s = input;

  /** Найти шаблон, применить и «вырезать» из текста (заменив пробелами, чтобы индексы не съехали) */
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    let hit = false;
    while ((m = g.exec(s))) {
      if (fn(m) === false) continue;
      spans.push([m.index, m.index + m[0].length]);
      s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length);
      hit = true;
      if (!g.flags.includes('g')) break;
    }
    return hit;
  };

  // ---------- повторы ----------
  const R = (rule: RepeatRule) => (m: RegExpExecArray) => {
    if (out.repeat) return false;
    out.repeat = rule;
    void m;
  };
  take(new RegExp(`${B}(ежедневно|каждый день)${E}`, 'i'), R({ freq: 'daily', interval: 1 }));
  take(new RegExp(`${B}по будням${E}`, 'i'), R({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }));
  take(new RegExp(`${B}по выходным${E}`, 'i'), R({ freq: 'weekly', interval: 1, weekdays: [0, 6] }));
  take(new RegExp(`${B}(еженедельно|каждую неделю)${E}`, 'i'), R({ freq: 'weekly', interval: 1 }));
  take(new RegExp(`${B}(ежемесячно|каждый месяц)${E}`, 'i'), R({ freq: 'monthly', interval: 1 }));
  take(new RegExp(`${B}(ежегодно|каждый год)${E}`, 'i'), R({ freq: 'yearly', interval: 1 }));
  take(new RegExp(`${B}кажд(?:ые|ый|ую|ое)\\s+${NUM_RE}\\s+(${U_DAY}|${U_WEEK}|${U_MONTH}|${U_YEAR})${E}`, 'i'), (m) => {
    if (out.repeat) return false;
    const n = numOf(m[1].toLowerCase());
    const u = m[2].toLowerCase();
    out.repeat = { freq: u.startsWith('д') ? 'daily' : u.startsWith('н') ? 'weekly' : u.startsWith('м') ? 'monthly' : 'yearly', interval: n };
  });
  take(new RegExp(`${B}(?:кажд(?:ый|ую|ое)|по)\\s+${WD_RE}(?:(?:\\s*,\\s*|\\s+и\\s+)${WD_RE})*${E}`, 'i'), (m) => {
    if (out.repeat) return false;
    const days = [...m[0].toLowerCase().matchAll(new RegExp(WD_RE, 'gi'))].map((x) => wdOf(x[1].toLowerCase()));
    out.repeat = { freq: 'weekly', interval: 1, weekdays: [...new Set(days)] };
  });

  // ---------- напоминание ----------
  take(new RegExp(`${B}напомни(?:ть)?\\s+за\\s+${NUM_RE}?\\s*(полчаса|${U_MIN}|${U_HOUR}|${U_DAY}|${U_WEEK})${E}`, 'i'), (m) => {
    const n = numOf(m[1]?.toLowerCase());
    const u = m[2].toLowerCase();
    out.reminder = -(u === 'полчаса' ? 30 : u.startsWith('м') ? n : u.startsWith('ч') ? n * 60 : u.startsWith('н') ? n * 10080 : n * 1440);
  });

  // ---------- интервал времени «с 14 до 16», «14:00-15:30» ----------
  const T = '(\\d{1,2})(?:[:.](\\d{2}))?';
  take(new RegExp(`${B}(?:с\\s+)?${T}\\s*(?:-|–|—|до)\\s*${T}${E}`, 'i'), (m) => {
    if (!/[:.]/.test(m[0]) && !/^с\s/i.test(m[0])) return false;
    const h1 = +m[1], m1 = +(m[2] ?? 0), h2 = +m[3], m2 = +(m[4] ?? 0);
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return false;
    const a = h1 * 60 + m1;
    let b = h2 * 60 + m2;
    if (b <= a) b += 1440;
    out.time = `${pad2(h1)}:${pad2(m1)}`;
    out.duration = b - a;
  });

  // ---------- время ----------
  if (!out.time) {
    take(new RegExp(`${B}(?:в|к)\\s+${T}(\\s*час(?:а|ов|ам)?)?(?:\\s*(утра|дня|вечера|ночи))?${E}`, 'i'), (m) => {
      let h = +m[1];
      const mi = +(m[2] ?? 0);
      const hourWord = !!m[3];
      const part = m[4]?.toLowerCase();
      if (part === 'дня' || part === 'вечера') h = h < 12 ? h + 12 : h;
      if (part === 'ночи' && h === 12) h = 0;
      if (h > 23 || mi > 59) return false;
      // «в 3 раза» — не время: голый час принимаем только в конце или перед датой/меткой
      // …или рядом уже есть повтор/дата: «каждый день в 8 бег», «завтра в 8 бег»
      const rest = s.slice(m.index + m[0].length).trimStart();
      const ctx = (!!out.repeat || DATE_BEFORE.test(s.slice(0, m.index))) && !UNIT_NEXT.test(rest);
      if (!m[2] && !part && !hourWord && !ctx && !BARE_HOUR_NEXT.test(rest)) return false;
      // «встреча в 3» — скорее днём, чем в 3 ночи
      if (!m[2] && !part && h >= 1 && h <= 5) h += 12;
      out.time = `${pad2(h)}:${pad2(mi)}`;
    });
  }
  if (!out.time) {
    take(new RegExp(`${B}(\\d{1,2})[:](\\d{2})${E}`, 'i'), (m) => {
      if (+m[1] > 23 || +m[2] > 59) return false;
      out.time = `${pad2(+m[1])}:${m[2]}`;
    });
  }
  if (!out.time) {
    take(new RegExp(`${B}(утром|с утра|днём|днем|в обед|вечером|ночью|в полдень|в полночь)${E}`, 'i'), (m) => {
      const w = m[1].toLowerCase();
      out.time = w.includes('утр') ? '09:00' : w.includes('полдень') || w.includes('обед') ? '13:00' : w.startsWith('дн') ? '14:00' : w.startsWith('веч') ? '19:00' : w.includes('полночь') ? '00:00' : '22:00';
    });
  }

  // ---------- дата ----------
  const D = (d: string) => () => {
    if (out.date) return false;
    out.date = d;
  };
  take(new RegExp(`${B}послезавтра${E}`, 'i'), D(addDaysYmd(today, 2)));
  take(new RegExp(`${B}завтра${E}`, 'i'), D(addDaysYmd(today, 1)));
  take(new RegExp(`${B}сегодня${E}`, 'i'), D(today));
  take(new RegExp(`${B}через\\s+${NUM_RE}?\\s*(полчаса|${U_MIN}|${U_HOUR}|${U_DAY}|${U_WEEK}|${U_MONTH}|${U_YEAR})${E}`, 'i'), (m) => {
    if (out.date) return false;
    const n = numOf(m[1]?.toLowerCase());
    const u = m[2].toLowerCase();
    if (u.startsWith('мин') || u.startsWith('ч') || u === 'полчаса') {
      const add = u === 'полчаса' ? 30 : u.startsWith('мин') ? n : n * 60;
      const t = new Date(now.getTime() + add * 60000);
      out.date = toYmd(t);
      out.time = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
    } else if (u.startsWith('д')) out.date = addDaysYmd(today, n);
    else if (u.startsWith('н')) out.date = addDaysYmd(today, 7 * n);
    else if (u.startsWith('м')) {
      const t = fromYmd(today);
      t.setMonth(t.getMonth() + n);
      out.date = toYmd(t);
    } else {
      const t = fromYmd(today);
      t.setFullYear(t.getFullYear() + n);
      out.date = toYmd(t);
    }
  });
  take(new RegExp(`${B}на следующей неделе${E}`, 'i'), D(nextWeekday(today, 1, true)));
  take(new RegExp(`${B}на (?:этих )?выходных${E}`, 'i'), D(nextWeekday(today, 6)));
  take(new RegExp(`${B}(?:в|во)?\\s*(следующ(?:ий|ую|ее))?\\s*${WD_RE}${E}`, 'i'), (m) => {
    if (out.date) return false;
    // без предлога («окружающая среда») — не дата
    if (!/^(в|во)\s/i.test(m[0].trim()) && !m[1]) return false;
    const wd = wdOf(m[2].toLowerCase());
    out.date = nextWeekday(today, wd, !!m[1]);
    if (m[1] && out.date && daysBetweenSimple(today, out.date) < 7) out.date = addDaysYmd(out.date, 7);
  });
  // «до пятницы», «к пятнице» — срок в этот день
  take(new RegExp(`${B}(?:до|к|ко)\\s+(понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|понедельнику|вторнику|среде|четвергу|пятнице|субботе|воскресенью)${E}`, 'i'), (m) => {
    if (out.date) return false;
    out.date = nextWeekday(today, wdOf(m[1].toLowerCase()));
  });
  take(new RegExp(`${B}(?:(?:до|к)\\s+)?(\\d{1,2})\\s+${MONTH_RE}\\.?(?:\\s+(\\d{4}))?${E}`, 'i'), (m) => {
    if (out.date) return false;
    const day = +m[1];
    const mon = monthOf(m[2].toLowerCase());
    let year = m[3] ? +m[3] : fromYmd(today).getFullYear();
    let d = new Date(year, mon, day);
    if (d.getMonth() !== mon) return false;
    if (!m[3] && toYmd(d) < today) d = new Date(++year, mon, day);
    out.date = toYmd(d);
  });
  take(new RegExp(`${B}(\\d{1,2})[./](\\d{2})(?:[./](\\d{2,4}))?${E}`, 'i'), (m) => {
    if (out.date) return false;
    if (UNIT_NEXT.test(s.slice(m.index + m[0].length).trimStart())) return false;
    const day = +m[1];
    const mon = +m[2] - 1;
    if (mon < 0 || mon > 11 || day < 1 || day > 31) return false;
    let year = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : fromYmd(today).getFullYear();
    let d = new Date(year, mon, day);
    if (d.getMonth() !== mon) return false;
    if (!m[3] && toYmd(d) < today) d = new Date(++year, mon, day);
    out.date = toYmd(d);
  });

  // ---------- приоритет ----------
  take(/(?<=^|\s)!(1|2|3|высокий|высок|средний|сред|низкий|низк|!!|!)(?=$|\s)/i, (m) => {
    const v = m[1].toLowerCase();
    out.priority = (v === '1' || v.startsWith('выс') || v === '!!' ? 1 : v === '2' || v.startsWith('сред') || v === '!' ? 2 : 3) as Priority;
  });

  // ---------- теги и список ----------
  take(/(?<=^|\s)#([\p{L}\p{N}_\-/]+)/u, (m) => {
    if (!out.tags.includes(m[1])) out.tags.push(m[1]);
  });
  take(/(?<=^|\s)[~^]([\p{L}\p{N}_-]+)/u, (m) => {
    out.list = m[1];
  });

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const passedToday = !!out.time && minutesOf(out.time) <= nowMin;
  // повтор без даты — первый подходящий день (сегодняшний, только если время ещё не прошло)
  if (out.repeat && !out.date) {
    if (out.repeat.freq === 'weekly' && out.repeat.weekdays?.length) {
      const cands = out.repeat.weekdays.map((w) => nextWeekday(today, w)).sort();
      out.date = cands.find((d) => d !== today || !passedToday) ?? addDaysYmd(cands[0], 7);
    } else out.date = passedToday && out.repeat.freq === 'daily' ? addDaysYmd(today, 1) : today;
  }
  // время без даты — сегодня (или завтра, если время уже прошло); вызывающий может подставить выбранный день
  if (out.time && !out.date) {
    out.date = passedToday ? addDaysYmd(today, 1) : today;
    out.dateImplicit = true;
  }

  out.title = s.replace(/\s+/g, ' ').trim();
  if (!out.title) out.title = input.trim();
  spans.sort((a, b) => a[0] - b[0]);
  return out;
}

function daysBetweenSimple(a: string, b: string) {
  return Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / 86400000);
}

export { todayYmd };
