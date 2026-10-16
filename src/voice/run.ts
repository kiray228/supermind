/**
 * Голосовая команда → действия → выполнение (с отменой).
 * Сначала бесплатный разбор на устройстве; если фраза непонятна — бесплатная модель на сервере (если подключена).
 */
import { parseVoice, type VoiceAction } from './intent';
import { buildSplitPrompt, forcedSplit, isLongDictation, parseSplit, SPLIT_SYSTEM } from './dictation';
import { api, useCloud } from '../store/cloud';
import { addTask, ensureTasks, openTask, purgeTask } from '../tasks/store';
import { repeatLabel, type Priority, type RepeatRule } from '../tasks/model';
import { addTransaction, deleteTransaction, ensureFinance } from '../finance/store';
import { fmtMoney, sortedAccounts, sortedCategories, toMain, type FinancePrefs } from '../finance/model';
import { answer, dayLabel, findDone, markDone, type Done } from './answers';
import { createNote, ensureNotes, openNote, purgeNote } from '../notes/store';
import { markdownToBlocks } from '../notes/model';
import { loadPlanner, savePlanner } from '../store/db';
import { HABIT_LIBRARY } from '../habits/library';
import { cleanHabit, HABIT_COLORS } from '../habits/model';
import { syncSoon } from '../tasks/sync';
import { todayYmd } from '../utils/mapTasks';
import { uid } from '../utils/tree';
import type { Habit } from '../types';
import { useApp, type View } from '../store/appStore';

/** Сумма в основной валюте → в валюту счёта. null — курс не задан */
function toAccountCurrency(main: number, cur: string, prefs: FinancePrefs): number | null {
  if (cur === prefs.mainCurrency) return main;
  const r = prefs.rates[cur];
  return r && r > 0 ? main / r : null;
}

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
        ...(/^[A-Z]{3}$/.test(String(raw.currency ?? '')) ? { currency: String(raw.currency) } : {}),
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
      const times = Array.isArray(raw.times) ? [...new Set(raw.times.map(hhmm).filter((t): t is string => !!t))].sort().slice(0, 8) : [];
      return {
        type: 'add_habit',
        name,
        ...(times.length > 1 ? { times } : {}),
        ...(hhmm(raw.time) ? { time: hhmm(raw.time) } : {}),
        ...(pw >= 1 && pw <= 6 ? { perWeek: pw } : {}),
        ...(wd.length && wd.length < 7 ? { days: wd } : {}),
      };
    }
    case 'add_journal': {
      const text = str(raw.text, 5000);
      return text ? { type: 'add_journal', text, section: raw.section === 'results' ? 'results' : 'thoughts' } : null;
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

/** Разложить мысль ИИ (свой ключ Claude или модель на сервере). Не получилось — [] */
async function splitDictation(text: string): Promise<{ acts: VoiceAction[]; failed: boolean }> {
  try {
    const { hasOwnKey, streamText } = await import('../ai/claude');
    if (!hasOwnKey() && !useCloud.getState().account) return { acts: [], failed: true };
    const answer = await streamText({ system: SPLIT_SYSTEM, messages: [{ role: 'user', content: buildSplitPrompt(text) }], effort: 'low', signal: AbortSignal.timeout(30000) });
    return { acts: parseSplit(answer), failed: false };
  } catch {
    // нет сети или ИИ недоступен — разберём позже
    return { acts: [], failed: true };
  }
}

/** ИИ сейчас не разобрать: слова — в дневник (не потеряются), разбор — когда ИИ станет доступен */
const later = (text: string): { actions: VoiceAction[]; via: 'local' } => ({ actions: [{ type: 'add_journal', text, section: 'thoughts', later: true }], via: 'local' });

/** Понять фразу: на устройстве, при неуверенности — у модели на сервере */
export async function interpret(text: string): Promise<{ actions: VoiceAction[]; via: 'local' | 'ai' }> {
  // «Разбери: …» — разложить на заметку, задачи и дневник даже короткую фразу
  const forced = forcedSplit(text);
  if (forced) {
    const r = await splitDictation(forced);
    if (r.acts.length) return { actions: r.acts, via: 'ai' };
    if (r.failed) return later(forced);
  }
  const ctx = await context();
  const local = parseVoice(text, ctx);
  // длинная мысль — не команда: ИИ разложит её на заметку, задачи и запись в дневник
  // (кроме явных «запиши заметку», «в дневник», трат, привычек и вопросов — там человек сам сказал, что это)
  const explicit = local.actions.some((a) => a.type === 'add_note' || a.type === 'add_journal' || a.type === 'add_transaction' || a.type === 'add_habit' || a.type === 'ask');
  if (isLongDictation(text) && !explicit) {
    const r = await splitDictation(text);
    if (r.acts.length) return { actions: r.acts, via: 'ai' };
    if (r.failed) return later(text);
  }
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
  // лекарства раньше «пить»: «пить таблетки» — это не вода
  [/витамин|таблет|лекарств|капл[иья]|сироп|укол|инсулин|мазь|пилюл/, '💊', '#ec4899'],
  [/вод[аыу]|пить/, '💧', '#3b82f6'],
  [/чита|чтени|книг/, '📚', '#a855f7'],
  [/бег|пробеж/, '🏃', '#f97316'],
  [/медит|дыхан/, '🧘', '#14b8a6'],
  [/спорт|тренир|зал(?![а-яёa-z0-9])|отжим|присед|пресс|планк/, '💪', '#ef4444'],
  [/зарядк|растяжк|йог/, '🤸', '#22c55e'],
  [/шаг|ходьб|прогулк|гулять/, '👣', '#84cc16'],
  [/спать|сон|подъ[её]м|вставать/, '😴', '#6366f1'],
  [/английск|язык|слов/, '🗣️', '#0ea5e9'],
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
      const named = byName(accs, a.account);
      // «10 долларов» — счёт в этой валюте, если он есть
      const inCurrency = a.currency && !named ? accs.find((x) => x.currency === a.currency) : undefined;
      const account = named ?? inCurrency ?? accs.find((x) => x.id === d.prefs.lastAccountId) ?? accs[0];
      if (!account) return { ok: false, label: a.kind === 'income' ? 'Доход' : 'Расход', title: String(a.amount), meta: 'Нет счёта — создайте его в Финансах' };
      // валюта фразы не совпала со счётом — пересчёт по курсу из настроек Финансов; без курса не пишем неверную сумму
      let amount = a.amount;
      let note = a.note;
      if (a.currency && a.currency !== account.currency) {
        const main = toMain(a.amount, a.currency, d.prefs);
        const conv = main === null ? null : toAccountCurrency(main, account.currency, d.prefs);
        if (conv === null)
          return { ok: false, label: a.kind === 'income' ? 'Доход' : 'Расход', title: `${a.amount} ${a.currency}`, meta: `Нет счёта в ${a.currency} и курса — добавьте курс в Финансах` };
        amount = Math.round(conv * 100) / 100;
        note = [a.note, `${a.amount} ${a.currency}`].filter(Boolean).join(' · ');
      }
      const cats = sortedCategories(d, a.kind);
      const category = cats.find((c) => c.id === a.categoryId) ?? byName(cats, a.category);
      const date = a.date ?? todayYmd();
      const tx = addTransaction({
        type: a.kind,
        amount,
        accountId: account.id,
        date,
        ...(category ? { categoryId: category.id } : {}),
        ...(note ? { note } : {}),
      });
      if (!tx) return { ok: false, label: 'Финансы', title: String(amount), meta: 'Не удалось записать' };
      return {
        ok: true,
        label: a.kind === 'income' ? 'Доход' : 'Расход',
        title: `${a.kind === 'income' ? '+' : '−'}${fmtMoney(amount, account.currency)}`,
        meta: [category ? `${category.emoji} ${category.name}` : 'без категории', note, dayLabel(date), account.name].filter(Boolean).join(' · '),
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
        // несколько раз в день — цель из числа времён, а не из библиотеки («Пить воду» × 8)
        ...(look.target && !a.times?.length ? { target: look.target, ...(look.unit ? { unit: look.unit } : {}) } : {}),
        ...(a.days?.length ? { freq: 'weekdays' as const, days: a.days } : a.perWeek ? { freq: 'weekly' as const, perWeek: a.perWeek } : {}),
        ...(a.times && a.times.length > 1 ? { times: a.times } : a.time ? { time: a.time } : {}),
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
        meta: [freq, a.times && a.times.length > 1 ? `${a.times.length} раза: ${a.times.join(', ')}` : a.time].filter(Boolean).join(' · '),
        undo: async () => {
          const q = await loadPlanner();
          await savePlanner({ ...q, days: q.days ?? {}, habits: (q.habits ?? []).map((x) => (x.id === h.id ? { ...x, deleted: true, updatedAt: Date.now() } : x)) });
          window.dispatchEvent(new Event('sm-planner-changed'));
          syncSoon(300);
        },
        open: () => go('habits'),
      };
    }
    case 'add_journal': {
      const { appendToDaily, openDailyNote, removeBlocks } = await import('../notes/daily');
      const r = await appendToDaily(a.text, a.section);
      if (!r) return { ok: false, label: 'Дневник', title: a.text, meta: 'Не удалось записать' };
      // длинная мысль без ИИ: разобрать на заметку и задачи, когда ИИ станет доступен
      const q = a.later ? await import('../notes/aiQueue') : null;
      if (q) q.queueDictation(a.text, r);
      return {
        ok: true,
        label: a.section === 'results' ? 'Итоги дня' : 'Дневник',
        title: a.text,
        meta: a.later ? 'в заметку дня · ИИ разберёт на заметку и задачи, когда появится связь' : 'в заметку дня',
        undo: async () => {
          q?.dropQueued((x) => x.kind === 'dictation' && x.journal?.noteId === r.noteId && x.journal.blockIds[0] === r.blockIds[0]);
          await removeBlocks(r.noteId, r.blockIds);
        },
        open: () => void openDailyNote(),
      };
    }
    case 'add_note': {
      await ensureNotes();
      const n = createNote({ title: a.title, blocks: a.text && a.text !== a.title ? (/\n/.test(a.text) ? markdownToBlocks(a.text) : [{ id: uid(), type: 'p', text: a.text }]) : [] });
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
