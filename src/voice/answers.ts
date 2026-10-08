/**
 * Голосом: «выполнил…» (задача или привычка) и вопросы — что на день, сколько потрачено, баланс.
 */
import type { VoiceAction } from './intent';
import type { Habit } from '../types';
import { ensureTasks, mutateTasks, openTask, toggleDone } from '../tasks/store';
import { isActive, occurrences } from '../tasks/model';
import { ensureFinance } from '../finance/store';
import { balances, categoryMap, fmtMoney, sortedAccounts, summarize, toMainLoose } from '../finance/model';
import { bumpHabitOn, toggleHabitOn } from '../habits/store';
import { activeHabits, countOn, doneOn, dueOn, isCounter, targetOf } from '../habits/model';
import { loadPlanner } from '../store/db';
import { syncSoon } from '../tasks/sync';
import { useApp, type View } from '../store/appStore';
import { addDaysYmd, todayYmd } from '../utils/mapTasks';

export interface Done {
  ok: boolean;
  /** что сделано: «Задача», «Расход»… */
  label: string;
  title: string;
  meta?: string;
  undo?: () => void | Promise<void>;
  open?: () => void;
  /** ответ, который можно проговорить вслух */
  say?: string;
}

const go = (v: View) => useApp.getState().go(v);
const lower = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export function dayLabel(d: string): string {
  const t = todayYmd();
  if (d === t) return 'сегодня';
  if (d === addDaysYmd(t, 1)) return 'завтра';
  if (d === addDaysYmd(t, -1)) return 'вчера';
  const [, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}`;
}

// ---------- Поиск задачи или привычки по словам ----------

const stemOf = (w: string) => w.slice(0, Math.max(3, Math.min(5, w.length - 1)));
const wordsOf = (s: string) =>
  lower(s)
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length >= 3 && !/^(как|что|для|это|мне|уже|раз|все)$/.test(w));

/** Насколько фраза похожа на название: доля слов названия, найденных во фразе */
function score(query: string, name: string): number {
  // «прочитал» ~ «читать», «сходил» ~ «ходить»: приставку глагола тоже пробуем без неё
  const q = wordsOf(query).flatMap((w) => {
    const bare = w.replace(/^(про|вы|по|на|за|пере|до|от|с)(?=\p{L}{3,})/u, '');
    return bare !== w ? [stemOf(w), stemOf(bare)] : [stemOf(w)];
  });
  // «Читать 20 минут»: единицы и длительность в названии не обязательны для совпадения
  const all = wordsOf(name);
  const core = all.filter((w) => !/^(минут|час|раз|страниц|стакан|шаг|литр|день|дня|дней|утр|вечер)/.test(w));
  const n = core.length ? core : all;
  if (!n.length || !q.length) return 0;
  // короткий корень глагола («пил» ~ «пить») сравниваем по двум буквам
  const hit = n.filter((w) => q.some((x) => w.startsWith(x) || x.startsWith(stemOf(w)) || (x.length <= 3 && w.length <= 5 && w.slice(0, 2) === x.slice(0, 2)))).length;
  return hit / n.length + 0.01 * hit;
}

type Found = { kind: 'habit'; habit: Habit } | { kind: 'task'; id: string; title: string };

/** Лучшее совпадение среди привычек и невыполненных задач; strict — сказано явно («выполнил…», «отметь…») */
export async function findDone(query: string, strict: boolean, kind?: 'task' | 'habit'): Promise<Found | null> {
  const today = todayYmd();
  const p = await loadPlanner();
  let best: Found | null = null;
  let top = 0;
  // без «выполнил/отметь» требуем совпадения почти всех слов названия: «купил хлеб» → «Купить хлеб»
  const need = strict ? 0.5 : 0.6;
  for (const h of kind === 'task' ? [] : activeHabits(p.habits)) {
    // «выпил стакан воды» без уточнения — скорее привычка, чем задача
    const sc = score(query, h.name + (h.unit ? ' ' + h.unit : '')) + (dueOn(p.days ?? {}, h, today) ? 0.05 : 0) + (strict ? 0 : 0.15);
    if (sc >= need && sc > top) {
      top = sc;
      best = { kind: 'habit', habit: h };
    }
  }
  const d = await ensureTasks();
  for (const t of kind === 'habit' ? [] : d.tasks) {
    if (!isActive(t) || t.deleted) continue;
    const soon = !t.date || t.date <= addDaysYmd(today, 1);
    const sc = score(query, t.title) + (soon ? 0.04 : 0);
    if (sc >= (strict ? 0.5 : 0.75) && sc > top) {
      top = sc;
      best = { kind: 'task', id: t.id, title: t.title };
    }
  }
  return best;
}

// ---------- Отметить выполненным ----------

export async function markDone(query: string, strict: boolean, n?: number, kind?: 'task' | 'habit'): Promise<Done> {
  const f = await findDone(query, strict, kind);
  const today = todayYmd();
  if (!f) return { ok: false, label: 'Не нашёл', title: query, meta: 'Нет такой задачи или привычки' };
  if (f.kind === 'habit') {
    const h = f.habit;
    const title = `${h.icon ?? '✨'} ${h.name}`;
    if (isCounter(h)) {
      const add = n ?? 1;
      const now = await bumpHabitOn(h, today, add);
      return {
        ok: true,
        label: 'Привычка',
        title,
        meta: `${now} из ${targetOf(h)}${h.unit ? ' · ' + h.unit : ''}${now >= targetOf(h) ? ' — цель на сегодня выполнена 🎉' : ''}`,
        undo: () => void bumpHabitOn(h, today, -add),
        open: () => go('habits'),
      };
    }
    const p = await loadPlanner();
    if (doneOn(p.days ?? {}, h, today)) return { ok: true, label: 'Привычка', title, meta: 'Уже отмечена сегодня', open: () => go('habits') };
    await toggleHabitOn(h, today);
    return { ok: true, label: 'Привычка выполнена', title, meta: 'сегодня ✓', undo: () => void toggleHabitOn(h, today), open: () => go('habits') };
  }
  const d = await ensureTasks();
  const before = d.tasks.find((t) => t.id === f.id);
  if (!before) return { ok: false, label: 'Задача', title: f.title, meta: 'Не найдена' };
  const snap = structuredClone(before);
  toggleDone(f.id);
  const after = (await ensureTasks()).tasks.find((t) => t.id === f.id);
  syncSoon(800);
  return {
    ok: true,
    label: 'Задача выполнена',
    title: f.title,
    meta: snap.repeat && after?.date && after.date !== snap.date ? `следующий раз — ${dayLabel(after.date)}` : 'отмечено ✓',
    undo: () => {
      if (!snap.repeat) return toggleDone(f.id);
      // повтор уже перенесён на следующий срок — возвращаем задачу как была
      mutateTasks((x) => {
        const i = x.tasks.findIndex((t) => t.id === f.id);
        if (i >= 0) x.tasks[i] = { ...snap, updatedAt: Date.now() };
        const li = x.log.map((l) => l.taskId).lastIndexOf(f.id);
        if (li >= 0) x.log.splice(li, 1);
      });
    },
    open: () => {
      go('tasks');
      openTask(f.id);
    },
  };
}

// ---------- Ответы на вопросы ----------

function plural(n: number, f: [string, string, string]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2];
}

export async function answer(a: Extract<VoiceAction, { type: 'ask' }>): Promise<Done> {
  if (a.what === 'agenda') {
    const d = await ensureTasks();
    const today = todayYmd();
    const items = d.tasks
      .filter((t) => isActive(t) && !t.deleted && !!t.date && (t.repeat ? occurrences(t, a.date, a.date, 1).length > 0 : t.date === a.date || (a.date === today && t.date! < today)))
      .sort((x, y) => (x.time ?? '99').localeCompare(y.time ?? '99'));
    const p = await loadPlanner();
    const left = activeHabits(p.habits).filter(
      (h) => dueOn(p.days ?? {}, h, a.date) && !(isCounter(h) ? countOn(p.days?.[a.date], h) >= targetOf(h) : doneOn(p.days ?? {}, h, a.date)),
    );
    const day = dayLabel(a.date);
    const nTasks = `${items.length} ${plural(items.length, ['задача', 'задачи', 'задач'])}`;
    const list = items.slice(0, 6).map((t) => (t.time ? `${t.title} в ${t.time}` : t.title));
    const sayTasks = items.length ? `${day[0].toUpperCase() + day.slice(1)} ${nTasks}: ${list.join(', ')}${items.length > 6 ? ' и другие' : ''}.` : `На ${day} задач нет.`;
    const sayHabits = left.length ? ` Привычки: ${left.slice(0, 5).map((h) => h.name).join(', ')}.` : '';
    return {
      ok: true,
      label: `План на ${day}`,
      title: items.length ? nTasks + (left.length ? ` · ${left.length} ${plural(left.length, ['привычка', 'привычки', 'привычек'])}` : '') : 'Задач нет',
      meta: (list.join(' · ') || sayHabits.trim()).slice(0, 140) || undefined,
      say: sayTasks + sayHabits,
      open: () => go(a.date === today ? 'tasks' : 'calendar'),
    };
  }
  const d = await ensureFinance();
  const cur = d.prefs.mainCurrency;
  if (a.what === 'balance') {
    const bal = balances(d);
    const accs = sortedAccounts(d);
    const total = accs.reduce((s, x) => s + toMainLoose(bal.get(x.id) ?? 0, x.currency, d.prefs), 0);
    const parts = accs.map((x) => `${x.name} ${fmtMoney(bal.get(x.id) ?? 0, x.currency)}`);
    return { ok: true, label: 'Баланс', title: fmtMoney(total, cur), meta: parts.join(' · '), say: `Всего ${fmtMoney(total, cur)}. ${parts.join(', ')}.`, open: () => go('finance') };
  }
  const s = summarize(d, { from: a.from, to: a.to });
  const cats = categoryMap(d);
  const byCat = a.what === 'income' ? s.incByCat : s.byCat;
  // от ИИ приходит только название категории
  const catId =
    a.categoryId ??
    (a.category ? [...cats.values()].find((c) => c.kind === (a.what === 'income' ? 'income' : 'expense') && lower(c.name).startsWith(lower(a.category!).slice(0, 5)))?.id : undefined);
  const sum = catId ? (byCat.get(catId) ?? 0) : a.what === 'income' ? s.income : s.expense;
  const verb = a.what === 'income' ? 'Получено' : 'Потрачено';
  const top = catId ? [] : [...byCat].sort((x, y) => y[1] - x[1]).slice(0, 3);
  const topText = top.map(([id, v]) => `${cats.get(id)?.name ?? 'Без категории'} ${fmtMoney(v, cur)}`).join(', ');
  const what = a.category ? ` на «${a.category}»` : '';
  const title = fmtMoney(sum, cur);
  return {
    ok: true,
    label: `${verb}${what} ${a.period}`,
    title,
    meta: topText || undefined,
    say: `${verb}${what} ${a.period}: ${title}.${topText ? ` Больше всего: ${topText}.` : ''}`,
    open: () => go('finance'),
  };
}
