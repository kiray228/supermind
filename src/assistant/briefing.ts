/**
 * Утренний брифинг: сводка дня, которая считается локально (без ИИ),
 * и необязательная ИИ-сводка (кэшируется на день).
 */
import { streamText } from '../ai/claude';
import { get } from '../store/kv';
import { useCloud } from '../store/cloud';
import { ensureTasks, useTasks } from '../tasks/store';
import { isActive, longDate, type TaskItem, type TasksData } from '../tasks/model';
import { ensureGoals, goalsDueBetween, useGoals, type GoalDue } from '../goals/store';
import type { GoalsData } from '../goals/model';
import { ensureFinance, upcomingPayments, useFinance } from '../finance/store';
import { fmtMoney, type FinanceData, type UpcomingPayment } from '../finance/model';
import { addDaysYmd, fromYmd, todayYmd, toYmd } from '../utils/mapTasks';
import type { PlannerData } from '../types';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

export interface BriefHabit {
  id: string;
  name: string;
  color: string;
  icon?: string;
  done: boolean;
  /** для привычек «N раз в день» */
  count?: number;
  target?: number;
}

export interface BriefingData {
  today: string;
  greeting: string;
  /** имя пользователя (из облачного аккаунта), может быть пустым */
  name: string;
  dateLabel: string;
  overdue: TaskItem[];
  /** все активные задачи на сегодня — по важности, затем по времени */
  todayTasks: TaskItem[];
  /** главное: первые 5 задач на сегодня */
  top: TaskItem[];
  /** задачи на сегодня со временем — по времени */
  scheduled: TaskItem[];
  doneToday: number;
  habits: BriefHabit[];
  goals: GoalDue[];
  payments: UpcomingPayment[];
  yesterday: { count: number; titles: string[] };
  /** настроение за последние дни (новые — первыми) */
  moods: { date: string; mood: string }[];
}

export interface BriefingInputs {
  tasks: TasksData | null;
  goals: GoalsData | null;
  finance: FinanceData | null;
  planner: PlannerData | null;
  name?: string;
  now?: Date;
}

export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

export function firstName(full: string | undefined | null): string {
  const s = (full ?? '').trim().split(/\s+/)[0] ?? '';
  // e-mail вместо имени не показываем
  return s.includes('@') ? '' : s.slice(0, 24);
}

/** 1 — высокий … 3 — низкий, 0 (без приоритета) — в конце */
export const prioRank = (p: number | undefined) => (p && p >= 1 && p <= 3 ? p : 9);

export function byPriorityThenTime(a: TaskItem, b: TaskItem): number {
  return prioRank(a.priority) - prioRank(b.priority) || (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.order - b.order;
}

// ---------- Привычки (поля могут добавляться — читаем осторожно) ----------

function numArray(x: unknown): number[] | null {
  return Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'number') ? (x as number[]) : null;
}

/** Запланирована ли привычка на этот день (если у неё есть дни недели) */
export function habitScheduledOn(h: Obj, date: Date): boolean {
  if (h.archived || h.paused || h.deleted) return false;
  const freq = isObj(h.frequency) ? h.frequency : isObj(h.schedule) ? h.schedule : null;
  const days = numArray(h.days) ?? numArray(h.weekdays) ?? (freq ? numArray(freq.days) ?? numArray(freq.weekdays) : null);
  if (days) return days.includes(date.getDay());
  return true;
}

function habitTarget(h: Obj): number {
  const freq = isObj(h.frequency) ? h.frequency : null;
  const t = Number(h.target ?? h.perDay ?? h.times ?? (freq ? freq.perDay ?? freq.times : undefined));
  return Number.isFinite(t) && t > 1 ? Math.min(99, Math.round(t)) : 1;
}

export function habitsForDay(planner: PlannerData | null, ymd: string): BriefHabit[] {
  if (!planner || !Array.isArray(planner.habits)) return [];
  const day = (isObj(planner.days) ? (planner.days as Obj)[ymd] : undefined) as Obj | undefined;
  const doneIds = Array.isArray(day?.habits) ? (day!.habits as unknown[]) : [];
  const counts = isObj(day?.habitCounts) ? (day!.habitCounts as Obj) : {};
  const date = fromYmd(ymd);
  const out: BriefHabit[] = [];
  for (const raw of planner.habits as unknown[]) {
    if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
    if (!habitScheduledOn(raw, date)) continue;
    const target = habitTarget(raw);
    const cnt = Number(counts[raw.id]);
    const count = Number.isFinite(cnt) ? cnt : doneIds.includes(raw.id) ? target : 0;
    out.push({
      id: raw.id,
      name: raw.name,
      color: typeof raw.color === 'string' ? raw.color : '#22c55e',
      icon: typeof raw.icon === 'string' ? raw.icon : undefined,
      done: doneIds.includes(raw.id) || count >= target,
      ...(target > 1 ? { count, target } : {}),
    });
  }
  return out;
}

export function recentMoods(planner: PlannerData | null, today: string, days = 7): { date: string; mood: string }[] {
  const out: { date: string; mood: string }[] = [];
  if (!planner || !isObj(planner.days)) return out;
  for (let i = 0; i < days; i++) {
    const d = addDaysYmd(today, -i);
    const m = (planner.days as Obj)[d];
    if (isObj(m) && typeof m.mood === 'string' && m.mood) out.push({ date: d, mood: m.mood });
  }
  return out;
}

// ---------- Расчёт ----------

export function computeBriefing({ tasks, goals, finance, planner, name, now = new Date() }: BriefingInputs): BriefingData {
  const today = toYmd(now);
  const yesterday = addDaysYmd(today, -1);
  const list = (tasks?.tasks ?? []).filter(isActive);
  const overdue = list.filter((t) => !!t.date && t.date < today).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || byPriorityThenTime(a, b));
  const todayTasks = list.filter((t) => t.date === today).sort(byPriorityThenTime);
  const scheduled = todayTasks.filter((t) => !!t.time).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

  const dayStart = fromYmd(today).getTime();
  const yStart = fromYmd(yesterday).getTime();
  const log = tasks?.log ?? [];
  const yLog = log.filter((l) => l.at >= yStart && l.at < dayStart);
  const doneToday = log.filter((l) => l.at >= dayStart).length;

  let payments: UpcomingPayment[] = [];
  try {
    if (finance) payments = upcomingPayments(finance, today, addDaysYmd(today, 6));
  } catch {
    payments = [];
  }

  return {
    today,
    greeting: greetingFor(now.getHours()),
    name: firstName(name),
    dateLabel: longDate(today),
    overdue,
    todayTasks,
    top: todayTasks.slice(0, 5),
    scheduled,
    doneToday,
    habits: habitsForDay(planner, today),
    goals: goals ? goalsDueBetween(goals, today, addDaysYmd(today, 7)) : [],
    payments,
    yesterday: { count: yLog.length, titles: yLog.slice(-5).map((l) => l.title) },
    moods: recentMoods(planner, today),
  };
}

/** Загрузить всё нужное для брифинга (каждый раздел — независимо: ошибка одного не мешает другим) */
export async function loadBriefingInputs(): Promise<BriefingInputs> {
  const [t, g, f, p] = await Promise.allSettled([ensureTasks(), ensureGoals(), ensureFinance(), get<PlannerData>('planner')]);
  return {
    tasks: t.status === 'fulfilled' ? t.value : useTasks.getState().data,
    goals: g.status === 'fulfilled' ? g.value : useGoals.getState().data,
    finance: f.status === 'fulfilled' ? f.value : useFinance.getState().data,
    planner: p.status === 'fulfilled' ? (p.value ?? null) : null,
    name: useCloud.getState().account?.user.name,
  };
}

// ---------- Текст для уведомления ----------

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function relDay(ymd: string, today: string): string {
  const diff = Math.round((fromYmd(ymd).getTime() - fromYmd(today).getTime()) / 86400000);
  if (diff <= 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  return `через ${diff} ${plural(diff, 'день', 'дня', 'дней')}`;
}

/** Короткий текст для уведомления: заголовок ≤ 50 символов, текст ≤ 180 */
export function formatBriefing(b: BriefingData): { title: string; body: string } {
  const icon = b.greeting === 'Доброе утро' ? '☀️' : b.greeting === 'Доброй ночи' ? '🌙' : '👋';
  let title = `${icon} ${b.greeting}${b.name ? ', ' + b.name : ''}!`;
  if (title.length > 50) title = `${icon} ${b.greeting}!`;

  const parts: string[] = [];
  const n = b.todayTasks.length;
  let first = n ? `Сегодня ${n} ${plural(n, 'задача', 'задачи', 'задач')}` : 'На сегодня задач нет';
  if (b.overdue.length) first += `, ${b.overdue.length} ${plural(b.overdue.length, 'просрочена', 'просрочены', 'просрочено')}`;
  parts.push(first);
  const main = b.top[0];
  if (main) parts.push(`Главное: ${cut(main.title, 40)}${main.time ? ` в ${main.time}` : ''}`);
  const firstTimed = b.scheduled[0];
  if (firstTimed && firstTimed !== main) parts.push(`Первая задача в ${firstTimed.time}`);
  const habitsLeft = b.habits.filter((h) => !h.done).length;
  if (habitsLeft) parts.push(`Привычки: ${habitsLeft}`);
  const g = b.goals[0];
  if (g) parts.push(`Срок «${cut(g.title, 30)}» ${relDay(g.date, b.today)}`);
  const p = b.payments[0];
  if (p) parts.push(`Платёж ${cut(p.title, 24)} ${fmtMoney(p.amount, p.currency)} ${relDay(p.date, b.today)}`);
  if (b.yesterday.count) parts.push(`Вчера сделано: ${b.yesterday.count}`);

  let body = '';
  for (const part of parts) {
    const next = body ? `${body}. ${part}` : part;
    if (next.length + 1 > 180) break;
    body = next;
  }
  return { title, body: cut(body ? body + '.' : '', 180) };
}

/**
 * Брифинг для утреннего уведомления (без ИИ, работает офлайн).
 * Заголовок ≤ 50 символов, текст ≤ 180.
 */
export async function buildBriefing(): Promise<{ title: string; body: string; data: BriefingData }> {
  const data = computeBriefing(await loadBriefingInputs());
  return { ...formatBriefing(data), data };
}

// ---------- ИИ-сводка (кэш на день) ----------

const AI_CACHE = 'sm-assistant-brief';

export function cachedAiBrief(today = todayYmd()): string | null {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_CACHE) ?? 'null') as { date?: string; text?: string } | null;
    return raw && raw.date === today && typeof raw.text === 'string' ? raw.text : null;
  } catch {
    return null;
  }
}

function saveAiBrief(text: string, today: string) {
  try {
    localStorage.setItem(AI_CACHE, JSON.stringify({ date: today, text }));
  } catch {
    /* хранилище недоступно — просто без кэша */
  }
}

export function briefingAsText(b: BriefingData): string {
  const t = (x: TaskItem) => `${x.time ? x.time + ' ' : ''}${x.title}${x.priority ? ` (приоритет ${x.priority === 1 ? 'высокий' : x.priority === 2 ? 'средний' : 'низкий'})` : ''}`;
  const lines = [`Сегодня: ${b.dateLabel}. Сейчас ${new Date().toTimeString().slice(0, 5)}.`];
  lines.push(b.todayTasks.length ? `Задачи на сегодня (${b.todayTasks.length}):\n${b.todayTasks.slice(0, 15).map((x) => '- ' + t(x)).join('\n')}` : 'Задач на сегодня нет.');
  if (b.overdue.length) lines.push(`Просрочено (${b.overdue.length}):\n${b.overdue.slice(0, 8).map((x) => `- ${x.title} (срок ${x.date})`).join('\n')}`);
  if (b.habits.length) lines.push(`Привычки на сегодня: ${b.habits.map((h) => `${h.name}${h.done ? ' ✓' : ''}`).join(', ')}`);
  if (b.goals.length) lines.push(`Сроки целей на неделе: ${b.goals.map((g) => `${g.title} — ${g.date}`).join('; ')}`);
  if (b.payments.length) lines.push(`Платежи на неделе: ${b.payments.slice(0, 5).map((p) => `${p.title} ${fmtMoney(p.amount, p.currency)} — ${p.date}`).join('; ')}`);
  lines.push(`Вчера выполнено задач: ${b.yesterday.count}${b.yesterday.titles.length ? ` (${b.yesterday.titles.join(', ')})` : ''}.`);
  if (b.moods.length) lines.push(`Настроение за последние дни: ${b.moods.map((m) => m.mood).join(' ')}`);
  return lines.join('\n\n');
}

/** Попросить Claude о коротком мотивирующем плане на день (ответ кэшируется до конца дня) */
export async function aiBrief(b: BriefingData, opts: { onText?: (s: string) => void; signal?: AbortSignal } = {}): Promise<string> {
  const text = await streamText({
    system: `Ты — тёплый и практичный личный ассистент в приложении SuperMind. По данным пользователя составь короткий мотивирующий план на день.
Формат (Markdown, без заголовков и таблиц):
- одна живая фраза-приветствие${b.name ? ` (имя: ${b.name})` : ''};
- 3–5 пунктов плана «- **время или блок дня** — что сделать», самое важное — первым, учитывай задачи со временем и просрочку;
- в конце одна строка с советом или поддержкой.
Не больше 110 слов. Пиши по-русски, конкретно, без воды и без выдуманных задач.`,
    messages: [{ role: 'user', content: briefingAsText(b) }],
    effort: 'low',
    onText: opts.onText,
    signal: opts.signal,
  });
  const clean = text.trim();
  if (clean) saveAiBrief(clean, b.today);
  return clean;
}
