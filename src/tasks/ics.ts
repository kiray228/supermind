import { addDaysYmd, fromYmd } from '../utils/mapTasks';
import type { RepeatRule, TaskItem } from './model';
import { startAt } from './model';

const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** RRULE (без префикса «RRULE:») для правила повтора */
export function toRRule(r: RepeatRule, date: string, opts: { allDay?: boolean; done?: number } = {}): string | null {
  if (r.fromCompletion) return null;
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'weekly') parts.push(`BYDAY=${(r.weekdays?.length ? r.weekdays : [fromYmd(date).getDay()]).map((d) => WD[d]).join(',')}`);
  if (r.freq === 'monthly') {
    if (r.monthWeek) parts.push(`BYDAY=${r.monthWeek.n}${WD[r.monthWeek.wd]}`);
    else if (r.lastDay) parts.push('BYMONTHDAY=-1');
    else {
      // «31-го числа» в коротких месяцах — последний день (как в приложении), а не пропуск месяца
      const day = r.day ?? fromYmd(date).getDate();
      if (day > 28) parts.push(`BYMONTHDAY=${Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`);
    }
  }
  if (r.count) parts.push(`COUNT=${Math.max(1, r.count - (opts.done ?? 0))}`);
  else if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}${opts.allDay ? '' : 'T235959Z'}`);
  return parts.join(';');
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Складывание длинных строк по RFC 5545 (75 октетов) */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 73) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function taskDescription(t: TaskItem): string {
  const lines: string[] = [];
  if (t.notes?.trim()) lines.push(t.notes.trim());
  if (t.checklist.length) lines.push(t.checklist.map((c) => `${c.done ? '☑' : '☐'} ${c.text}`).join('\n'));
  if (t.tags.length) lines.push(t.tags.map((g) => '#' + g).join(' '));
  lines.push('— SuperMind');
  return lines.join('\n\n');
}

function trigger(minutes: number): string {
  const neg = minutes < 0;
  let m = Math.abs(minutes);
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  let s = 'P';
  if (d) s += `${d}D`;
  if (h || m || !d) s += 'T' + (h ? `${h}H` : '') + (m || (!h && !d) ? `${m}M` : '');
  return (neg ? '-' : '') + s;
}

/** Файл календаря .ics с задачами (события с напоминаниями VALARM) — для iPhone, Google и любых календарей */
export function buildIcs(tasks: TaskItem[], name = 'SuperMind'): string {
  const L: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SuperMind//Tasks//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`];
  const now = utcStamp(Date.now());
  for (const t of tasks) {
    if (!t.date || t.deleted) continue;
    L.push('BEGIN:VEVENT', `UID:${t.id}@supermind`, `DTSTAMP:${now}`);
    L.push(`SUMMARY:${esc((t.done ? '✓ ' : '') + t.title)}`);
    if (t.time) {
      const s = startAt(t, t.date).getTime();
      L.push(`DTSTART:${utcStamp(s)}`, `DTEND:${utcStamp(s + (t.duration || 30) * 60000)}`);
    } else {
      L.push(`DTSTART;VALUE=DATE:${t.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDaysYmd(t.date, 1).replace(/-/g, '')}`);
    }
    const rr = t.repeat && !t.done ? toRRule(t.repeat, t.date, { allDay: !t.time, done: t.repeatDone }) : null;
    if (rr) L.push(`RRULE:${rr}`);
    L.push(`DESCRIPTION:${esc(taskDescription(t))}`);
    if (t.priority) L.push(`PRIORITY:${t.priority === 1 ? 1 : t.priority === 2 ? 5 : 9}`);
    if (t.tags.length) L.push(`CATEGORIES:${t.tags.map(esc).join(',')}`);
    if (!t.done)
      for (const r of t.reminders) {
        L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t.title)}`, `TRIGGER:${trigger(r)}`, 'END:VALARM');
      }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
