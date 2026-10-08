/**
 * Голосовая команда → действия → выполнение (с отменой).
 * Сначала бесплатный разбор на устройстве; если фраза непонятна — бесплатная модель на сервере (если подключена).
 */
import { parseVoice, type VoiceAction } from './intent';
import { api, useCloud } from '../store/cloud';
import { addTask, ensureTasks, openTask, purgeTask } from '../tasks/store';
import { repeatLabel, type Priority, type RepeatRule } from '../tasks/model';
import { addTransaction, deleteTransaction, ensureFinance } from '../finance/store';
import { fmtMoney, sortedAccounts, sortedCategories } from '../finance/model';
import { answer, dayLabel, findDone, markDone, type Done } from './answers';
import { createNote, ensureNotes, openNote, purgeNote } from '../notes/store';
import { loadPlanner, savePlanner } from '../store/db';
import { HABIT_LIBRARY } from '../habits/library';
import { cleanHabit, HABIT_COLORS } from '../habits/model';
import { syncSoon } from '../tasks/sync';
import { todayYmd } from '../utils/mapTasks';
import { uid } from '../utils/tree';
import type { Habit } from '../types';
import { useApp, type View } from '../store/appStore';

const go = (v: View) => useApp.getState().go(v);

export type { VoiceAction, Done };

/** ИИ на сервере не подключён — в этом сеансе больше не спрашиваем */
let aiOff = false;

async function context() {
  const d = await ensureFinance().catch(() => null);
  return {
    categories: d ? [...sortedCategories(d, 'expense'), ...sortedCategories(d, 'income')].map((c) => ({ id: c.id, name: c.name, kind: c.kind })) : undefined,
    accounts: d ? sortedAccounts(d).map((a) => ({ id: a.id, name: a.name })) : undefined,
  };
}

// ---------- Проверка ответа модели ----------

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max = 300) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined);
const ymd = (x: unknown) => {
  const s = str(x, 20);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 && y > 2000 ? s : undefined;
};
const hhmm = (x: unknown) => {
  const m = str(x, 8)?.match(/^(\d{1,2}):(\d{2})$/);
  return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : undefined;
};
const days = (x: unknown) => (Array.isArray(x) ? [...new Set(x.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))] : []);

function repeat(x: unknown): RepeatRule | undefined {
  if (!isObj(x)) return undefined;
  const f = x.freq;
  if (f !== 'daily' && f !== 'weekly' && f !== 'monthly' && f !== 'yearly') return undefined;
  const interval = Math.min(99, Math.max(1, Math.round(Number(x.interval) || 1)));
  const wd = days(x.weekdays);
  return { freq: f, interval, ...(f === 'weekly' && wd.length ? { weekdays: wd } : {}) };
}

export function fromAi(raw: unknown): VoiceAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'add_task': {
      const title = str(raw.title);
      if (!title) return null;
      const rep = repeat(raw.repeat);
      const date = ymd(raw.date) ?? (rep ? todayYmd() : undefined);
      const time = date ? hhmm(raw.time) : undefined;
      const pr = Number(raw.priority);
      return {
        type: 'add_task',
        title,
        ...(date ? { date } : {}),
        ...(time ? { time } : {}),
        ...(rep ? { repeat: rep } : {}),
        ...(raw.remind === true && time ? { remindAtTime: true } : {}),
        ...(pr === 1 || pr === 2 || pr === 3 ? { priority: pr as Priority } : {}),
        ...(str(raw.list, 80) ? { list: str(raw.list, 80) } : {}),
      };
    }
    case 'add_transaction': {
      const amount = Math.round(Math.abs(Number(String(raw.amount ?? '').replace(/\s/g, '').replace(',', '.'))) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return null;
      return {
        type: 'add_transaction',
        kind: raw.kind === 'income' ? 'income' : 'expense',
        amount,
        ...(str(raw.category, 80) ? { category: str(raw.category, 80) } : {}),
        ...(str(raw.account, 80) ? { account: str(raw.account, 80) } : {}),
        ...(str(raw.note) ? { note: str(raw.note) } : {}),
        ...(ymd(raw.date) ? { date: ymd(raw.date) } : {}),
      };
    }
    case 'add_habit': {
      const name = str(raw.name ?? raw.title, 80);
      if (!name) return null;
      const pw = Math.round(Number(raw.perWeek));
      const wd = days(raw.days);
      return {
        type: 'add_habit',
        name,
        ...(hhmm(raw.time) ? { time: hhmm(raw.time) } : {}),
        ...(pw >= 1 && pw <= 6 ? { perWeek: pw } : {}),
        ...(wd.length && wd.length < 7 ? { days: wd } : {}),
      };
    }
    case 'add_note': {
      const text = str(raw.text, 5000) ?? '';
      const title = str(raw.title, 120) ?? text.split('\n')[0].slice(0, 80);
      return title ? { type: 'add_note', title, text } : null;
    }
    case 'mark_done': {
      const query = str(raw.query ?? raw.title, 200);
      if (!query) return null;
      const n = Math.round(Number(raw.n));
      return { type: 'mark_done', query, strict: true, ...(n > 1 && n <= 100 ? { n } : {}) };
    }
    case 'ask': {
      if (raw.what === 'balance') return { type: 'ask', what: 'balance' };
      if (raw.what === 'agenda') return { type: 'ask', what: 'agenda', date: ymd(raw.date) ?? todayYmd() };
      if (raw.what !== 'spent' && raw.what !== 'income') return null;
      const today = todayYmd();
      const from = ymd(raw.from) ?? today.slice(0, 8) + '01';
      const to = ymd(raw.to) ?? today;
      const period = from === to ? (from === today ? 'сегодня' : `за ${dayLabel(from)}`) : `с ${dayLabel(from)} по ${dayLabel(to)}`;
      return { type: 'ask', what: raw.what, from, to, period, ...(str(raw.category, 80) ? { category: str(raw.category, 80) } : {}) };
    }
    default:
      return null;
  }
}

/** Понять фразу: на устройстве, при неуверенности — у модели на сервере */
export async function interpret(text: string): Promise<{ actions: VoiceAction[]; via: 'local' | 'ai' }> {
  const ctx = await context();
  const local = parseVoice(text, ctx);
  if (local.confident && local.actions.length) return { actions: local.actions, via: 'local' };
  // «выпил стакан воды» — если похоже на привычку, отмечаем без ИИ
  const md = local.actions[0];
  if (md?.type === 'mark_done' && (await findDone(md.query, false, md.kind))) return { actions: local.actions, via: 'local' };
  if (!aiOff && useCloud.getState().account) {
    try {
      const now = new Date();
      const r = await api<{ actions: unknown[] }>('/ai/command', {
        method: 'POST',
        body: JSON.stringify({
          text,
          today: todayYmd(),
          nowMin: now.getHours() * 60 + now.getMinutes(),
          categories: ctx.categories?.map((c) => ({ name: c.name, kind: c.kind })),
          accounts: ctx.accounts?.map((a) => a.name),
          lists: (await ensureTasks().catch(() => null))?.lists.map((l) => l.name),
        }),
        signal: AbortSignal.timeout(12000),
      });
      const acts = (r.actions ?? []).map(fromAi).filter((a): a is VoiceAction => !!a);
      if (acts.length) return { actions: acts, via: 'ai' };
    } catch (e) {
      if ((e as { status?: number }).status === 503) aiOff = true;
    }
  }
  return { actions: local.fallback ?? local.actions, via: 'local' };
}

// ---------- Выполнение ----------

const lower = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
function byName<T extends { id: string; name: string }>(items: T[], q?: string): T | undefined {
  if (!q) return undefined;
  const s = lower(q);
  return items.find((x) => lower(x.name) === s) ?? items.find((x) => lower(x.name).startsWith(s.slice(0, 5)) || s.startsWith(lower(x.name).slice(0, 5)));
}

/** Значок и цвет привычки: похожая из библиотеки или по умолчанию */
const HABIT_ICONS: [RegExp, string, string][] = [
  [/вод[аыу]|пить/, '💧', '#3b82f6'],
  [/чита|чтени|книг/, '📚', '#a855f7'],
  [/бег|пробеж/, '🏃', '#f97316'],
  [/медит|дыхан/, '🧘', '#14b8a6'],
  [/спорт|тренир|зал(?![а-яёa-z0-9])|отжим|присед|пресс|планк/, '💪', '#ef4444'],
  [/зарядк|растяжк|йог/, '🤸', '#22c55e'],
  [/шаг|ходьб|прогулк|гулять/, '👣', '#84cc16'],
  [/спать|сон|подъ[её]м|вставать/, '😴', '#6366f1'],
  [/английск|язык|слов/, '🗣️', '#0ea5e9'],
  [/витамин|таблет|лекарств/, '💊', '#ec4899'],
  [/учи|учеб|курс/, '🎓', '#0ea5e9'],
  [/дневник|писать|журнал/, '✍️', '#f59e0b'],
  [/сладк|сахар/, '🍬', '#ec4899'],
  [/кури|сигарет/, '🚭', '#64748b'],
  [/копить|деньг|сбереж|бюджет/, '💰', '#22c55e'],
  [/план/, '🗓️', '#6366f1'],
  [/уборк|убира/, '🧹', '#14b8a6'],
];

function habitLook(name: string): { icon: string; color: string; target?: number; unit?: string } {
  const low = lower(name);
  // точно как в библиотеке («Пить воду») — берём и цель-счётчик (8 стаканов)
  const same = HABIT_LIBRARY.find((h) => lower(h.name) === low);
  if (same) return { icon: same.icon ?? '✨', color: same.color ?? HABIT_COLORS[0], ...(same.target ? { target: same.target, unit: same.unit } : {}) };
  for (const [re, icon, color] of HABIT_ICONS) if (re.test(low)) return { icon, color };
  const words = lower(name).split(/[^\p{L}\d]+/u).filter((w) => w.length >= 4);
  const p = HABIT_LIBRARY.find((h) => lower(h.name).split(/[^\p{L}\d]+/u).some((w) => w.length >= 4 && words.some((x) => x.slice(0, 4) === w.slice(0, 4))));
  if (p) return { icon: p.icon ?? '✨', color: p.color ?? HABIT_COLORS[0] };
  return { icon: '✨', color: HABIT_COLORS[Math.floor(Math.random() * HABIT_COLORS.length)] };
}

export async function execute(a: VoiceAction): Promise<Done> {
  switch (a.type) {
    case 'mark_done':
      return markDone(a.query, a.strict, a.n, a.kind);
    case 'ask':
      return answer(a);
    case 'add_task': {
      const d = await ensureTasks();
      const list = byName(d.lists, a.list);
      const t = addTask({
        title: a.title,
        ...(a.date ? { date: a.date } : {}),
        ...(a.date && a.time ? { time: a.time } : {}),
        ...(a.repeat && a.date ? { repeat: a.repeat } : {}),
        ...(list ? { listId: list.id } : {}),
        ...(a.remindAtTime && a.time ? { reminders: [0] } : {}),
        priority: a.priority ?? 0,
      });
      if (!t) return { ok: false, label: 'Задача', title: a.title, meta: 'Не удалось добавить' };
      syncSoon(800);
      return {
        ok: true,
        label: a.repeat ? 'Повторяющаяся задача' : 'Задача',
        title: t.title,
        meta: [a.repeat ? repeatLabel(a.repeat) : a.date ? dayLabel(a.date) : 'без срока', a.time, list?.name].filter(Boolean).join(' · '),
        undo: () => purgeTask(t.id),
        open: () => {
          go('tasks');
          openTask(t.id);
        },
      };
    }
    case 'add_transaction': {
      const d = await ensureFinance();
      const accs = sortedAccounts(d);
      const account = byName(accs, a.account) ?? accs.find((x) => x.id === d.prefs.lastAccountId) ?? accs[0];
      if (!account) return { ok: false, label: a.kind === 'income' ? 'Доход' : 'Расход', title: String(a.amount), meta: 'Нет счёта — создайте его в Финансах' };
      const cats = sortedCategories(d, a.kind);
      const category = cats.find((c) => c.id === a.categoryId) ?? byName(cats, a.category);
      const date = a.date ?? todayYmd();
      const tx = addTransaction({
        type: a.kind,
        amount: a.amount,
        accountId: account.id,
        date,
        ...(category ? { categoryId: category.id } : {}),
        ...(a.note ? { note: a.note } : {}),
      });
      if (!tx) return { ok: false, label: 'Финансы', title: String(a.amount), meta: 'Не удалось записать' };
      return {
        ok: true,
        label: a.kind === 'income' ? 'Доход' : 'Расход',
        title: `${a.kind === 'income' ? '+' : '−'}${fmtMoney(a.amount, account.currency)}`,
        meta: [category ? `${category.emoji} ${category.name}` : 'без категории', a.note, dayLabel(date), account.name].filter(Boolean).join(' · '),
        undo: () => deleteTransaction(tx.id, false),
        open: () => go('finance'),
      };
    }
    case 'add_habit': {
      const p = await loadPlanner();
      const habits = p.habits ?? [];
      const same = habits.find((h) => !h.deleted && !h.archived && lower(h.name) === lower(a.name));
      if (same) return { ok: true, label: 'Привычка уже есть', title: `${same.icon ?? ''} ${same.name}`.trim(), open: () => go('habits') };
      const now = Date.now();
      const look = habitLook(a.name);
      const h: Habit = cleanHabit({
        id: uid(),
        name: a.name,
        icon: look.icon,
        color: look.color,
        ...(look.target ? { target: look.target, ...(look.unit ? { unit: look.unit } : {}) } : {}),
        ...(a.days?.length ? { freq: 'weekdays' as const, days: a.days } : a.perWeek ? { freq: 'weekly' as const, perWeek: a.perWeek } : {}),
        ...(a.time ? { time: a.time } : {}),
        createdAt: now,
        updatedAt: now,
      });
      await savePlanner({ ...p, days: p.days ?? {}, habits: [...habits, h] });
      window.dispatchEvent(new Event('sm-planner-changed'));
      syncSoon(300);
      const freq = a.days?.length ? 'по дням недели' : a.perWeek ? `${a.perWeek} раза в неделю` : 'каждый день';
      return {
        ok: true,
        label: 'Привычка',
        title: `${h.icon} ${h.name}`,
        meta: [freq, a.time].filter(Boolean).join(' · '),
        undo: async () => {
          const q = await loadPlanner();
          await savePlanner({ ...q, days: q.days ?? {}, habits: (q.habits ?? []).map((x) => (x.id === h.id ? { ...x, deleted: true, updatedAt: Date.now() } : x)) });
          window.dispatchEvent(new Event('sm-planner-changed'));
          syncSoon(300);
        },
        open: () => go('habits'),
      };
    }
    case 'add_note': {
      await ensureNotes();
      const n = createNote({ title: a.title, blocks: a.text && a.text !== a.title ? [{ id: uid(), type: 'p', text: a.text }] : [] });
      if (!n) return { ok: false, label: 'Заметка', title: a.title, meta: 'Не удалось создать' };
      return {
        ok: true,
        label: 'Заметка',
        title: a.title,
        meta: a.text && a.text !== a.title ? a.text.slice(0, 80) : undefined,
        undo: () => purgeNote(n.id),
        open: () => {
          go('notes');
          void openNote(n.id);
        },
      };
    }
  }
}
