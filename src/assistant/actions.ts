/**
 * Действия, которые ассистент предлагает выполнить (одним касанием).
 * Модель дописывает в конец ответа блок ```actions с JSON-массивом —
 * здесь он разбирается, проверяется и выполняется.
 */
import { addTask, ensureTasks, getTask, toggleDone, updateTask, useTasks } from '../tasks/store';
import { isActive, type Priority } from '../tasks/model';
import { createNote, ensureNotes } from '../notes/store';
import { markdownToBlocks } from '../notes/model';
import { addTransaction, ensureFinance } from '../finance/store';
import { sortedAccounts, sortedCategories, fmtMoney, type FinanceData } from '../finance/model';
import { addGoal, addStages, ensureGoals, getGoal } from '../goals/store';
import { addDaysYmd, todayYmd } from '../utils/mapTasks';
import { uid } from '../utils/tree';
import { isEn, LOCALE, t } from '../i18n/index';

export type AssistantAction =
  | { type: 'add_task'; title: string; date?: string; time?: string; priority?: Priority; notes?: string; list?: string; duration?: number }
  | { type: 'complete_task'; id: string; title?: string }
  | { type: 'reschedule_task'; id: string; date: string; time?: string | null; title?: string }
  | { type: 'add_note'; title: string; text: string }
  | { type: 'add_journal'; text: string; section?: 'thoughts' | 'results'; date?: string }
  | { type: 'add_transaction'; kind: 'expense' | 'income'; amount: number; category?: string; account?: string; note?: string; date?: string }
  | { type: 'add_goal'; title: string; deadline?: string; emoji?: string; why?: string }
  | { type: 'add_goal_stage'; goalId: string; title: string; steps: string[]; deadline?: string };

/** Действие в сообщении: с отметкой о выполнении */
export type ActionItem = AssistantAction & { key: string; status?: 'done' | 'error'; info?: string };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

const str = (x: unknown, max = 500): string | undefined => {
  if (typeof x !== 'string' && typeof x !== 'number') return undefined;
  const s = String(x).trim();
  return s ? s.slice(0, max) : undefined;
};

function ymd(x: unknown): string | undefined {
  const s = str(x, 40)?.toLowerCase();
  if (!s) return undefined;
  if (s === 'today' || s === 'сегодня') return todayYmd();
  if (s === 'tomorrow' || s === 'завтра') return addDaysYmd(todayYmd(), 1);
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return undefined;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2200) return undefined;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function hhmm(x: unknown): string | undefined {
  const s = str(x, 10);
  const m = s?.match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return undefined;
  const h = +m[1];
  const mi = +m[2];
  if (h > 23 || mi > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function priority(x: unknown): Priority | undefined {
  if (typeof x === 'string') {
    const s = x.toLowerCase();
    if (/high|высок/.test(s)) return 1;
    if (/med|сред/.test(s)) return 2;
    if (/low|низк/.test(s)) return 3;
    if (/none|нет|без/.test(s)) return 0;
  }
  const n = Number(x);
  return n === 0 || n === 1 || n === 2 || n === 3 ? (n as Priority) : undefined;
}

function amount(x: unknown): number | undefined {
  // ИИ иногда присылает «4500 ₸» или −4500 для расхода — берём модуль числа
  const n = Math.abs(typeof x === 'number' ? x : Number(String(x ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')));
  return Number.isFinite(n) && n > 0 && n < 1e12 ? Math.round(n * 100) / 100 : undefined;
}

/** Проверить одно действие. Неизвестные и некорректные — null */
export function validateAction(raw: unknown): AssistantAction | null {
  if (!isObj(raw)) return null;
  const type = str(raw.type ?? raw.action, 40);
  switch (type) {
    case 'add_task': {
      const title = str(raw.title, 300);
      if (!title) return null;
      const date = ymd(raw.date);
      const time = date ? hhmm(raw.time) : undefined;
      const dur = Number(raw.duration);
      return {
        type,
        title,
        ...(date ? { date } : {}),
        ...(time ? { time } : {}),
        ...(priority(raw.priority) ? { priority: priority(raw.priority) } : {}),
        ...(str(raw.notes, 2000) ? { notes: str(raw.notes, 2000) } : {}),
        ...(str(raw.list, 80) ? { list: str(raw.list, 80) } : {}),
        ...(time && Number.isFinite(dur) && dur > 0 && dur <= 24 * 60 ? { duration: Math.round(dur) } : {}),
      };
    }
    case 'complete_task': {
      const id = str(raw.id, 80);
      return id ? { type, id, ...(str(raw.title, 300) ? { title: str(raw.title, 300) } : {}) } : null;
    }
    case 'reschedule_task': {
      const id = str(raw.id, 80);
      const date = ymd(raw.date);
      if (!id || !date) return null;
      const time = raw.time === null ? null : hhmm(raw.time);
      return { type, id, date, ...(time !== undefined ? { time } : {}), ...(str(raw.title, 300) ? { title: str(raw.title, 300) } : {}) };
    }
    case 'add_journal': {
      const text = str(raw.text ?? raw.content, 5000);
      if (!text) return null;
      const date = ymd(raw.date);
      return { type, text, ...(raw.section === 'results' ? { section: 'results' as const } : {}), ...(date ? { date } : {}) };
    }
    case 'add_note': {
      const text = str(raw.text ?? raw.content ?? raw.body, 20000);
      const title = str(raw.title, 200) ?? text?.split('\n')[0].slice(0, 80);
      return title ? { type, title, text: text ?? '' } : null;
    }
    case 'add_transaction': {
      const sum = amount(raw.amount);
      if (!sum) return null;
      const k = str(raw.kind ?? raw.txType ?? raw.direction, 20)?.toLowerCase();
      const kind = k === 'income' || k === 'доход' ? 'income' : 'expense';
      return {
        type,
        kind,
        amount: sum,
        ...(str(raw.category, 80) ? { category: str(raw.category, 80) } : {}),
        ...(str(raw.account, 80) ? { account: str(raw.account, 80) } : {}),
        ...(str(raw.note, 300) ? { note: str(raw.note, 300) } : {}),
        ...(ymd(raw.date) ? { date: ymd(raw.date) } : {}),
      };
    }
    case 'add_goal': {
      const title = str(raw.title, 200);
      if (!title) return null;
      return {
        type,
        title,
        ...(ymd(raw.deadline) ? { deadline: ymd(raw.deadline) } : {}),
        ...(str(raw.emoji, 8) ? { emoji: str(raw.emoji, 8) } : {}),
        ...(str(raw.why, 500) ? { why: str(raw.why, 500) } : {}),
      };
    }
    case 'add_goal_stage': {
      const goalId = str(raw.goalId ?? raw.goal_id ?? raw.id, 80);
      const title = str(raw.title, 200);
      if (!goalId || !title) return null;
      const steps = Array.isArray(raw.steps) ? raw.steps.map((s) => str(s, 200)).filter((s): s is string => !!s).slice(0, 20) : [];
      return { type, goalId, title, steps, ...(ymd(raw.deadline) ? { deadline: ymd(raw.deadline) } : {}) };
    }
    default:
      return null;
  }
}

// ---------- Разбор ответа ----------

const FENCE = /```actions[^\n]*\n?([\s\S]*?)(?:```|$)/i;

/**
 * Отделить блок действий от текста. Работает и для незаконченного (идущего) ответа:
 * всё, начиная с «```actions», в текст не попадает.
 */
export function parseActions(full: string): { text: string; actions: AssistantAction[] } {
  const m = FENCE.exec(full);
  if (!m) {
    // поток мог оборваться на полуслове «```act…» — не показываем хвост
    const tail = full.match(/`{1,3}(a(c(t(i(o(n(s)?)?)?)?)?)?)?\s*$/);
    const text = tail && /```/.test(tail[0]) ? full.slice(0, tail.index) : full;
    return { text: text.trimEnd(), actions: [] };
  }
  const text = (full.slice(0, m.index) + full.slice(m.index + m[0].length)).trim();
  let actions: AssistantAction[] = [];
  try {
    const json = m[1].trim();
    const parsed: unknown = JSON.parse(json);
    const arr = Array.isArray(parsed) ? parsed : isObj(parsed) && Array.isArray(parsed.actions) ? parsed.actions : [parsed];
    actions = arr.map(validateAction).filter((a): a is AssistantAction => !!a).slice(0, 20);
  } catch {
    actions = [];
  }
  return { text, actions };
}

export const toItems = (actions: AssistantAction[]): ActionItem[] => actions.map((a) => ({ ...a, key: uid() }));

// ---------- Описание для карточки ----------

const PRIO_LABEL: Record<number, string> = { 1: t('высокий приоритет'), 2: t('средний приоритет'), 3: t('низкий приоритет') };

function dateLabel(d: string): string {
  const today = todayYmd();
  if (d === today) return t('сегодня');
  if (d === addDaysYmd(today, 1)) return t('завтра');
  const [y, m, day] = d.split('-').map(Number);
  const months = [t('янв'), t('фев'), t('мар'), t('апр'), t('мая'), t('июн'), t('июл'), t('авг'), t('сен'), t('окт'), t('ноя'), t('дек')];
  const dm = isEn ? `${months[m - 1]} ${day}` : `${day} ${months[m - 1]}`;
  return `${dm}${y !== new Date().getFullYear() ? (isEn ? ', ' : ' ') + y : ''}`;
}

export function taskTitle(id: string, fallback?: string): string {
  return getTask(id)?.title ?? fallback ?? t('задача');
}

export interface ActionView {
  kind: 'task' | 'done' | 'move' | 'note' | 'money' | 'goal';
  label: string;
  title: string;
  meta?: string;
}

export function describeAction(a: AssistantAction): ActionView {
  switch (a.type) {
    case 'add_task':
      return {
        kind: 'task',
        label: t('Новая задача'),
        title: a.title,
        meta: [a.date && dateLabel(a.date), a.time, a.priority ? PRIO_LABEL[a.priority] : '', a.list].filter(Boolean).join(' · ') || t('без срока'),
      };
    case 'complete_task':
      return { kind: 'done', label: t('Отметить выполненной'), title: taskTitle(a.id, a.title) };
    case 'reschedule_task':
      return { kind: 'move', label: t('Перенести'), title: taskTitle(a.id, a.title), meta: a.time ? t('на {date}, {time}', { date: dateLabel(a.date), time: a.time }) : t('на {date}', { date: dateLabel(a.date) }) };
    case 'add_note':
      return {
        kind: 'note',
        label: t('Новая заметка'),
        title: a.title,
        meta:
          a.text
            .split('\n')
            .map((l) => l.replace(/^\s*([-*+•]|\d+[.)]|#+|>)?\s*(\[[ xX]\]\s*)?/, '').replace(/[*_`]/g, '').trim())
            .filter(Boolean)
            .join(' · ')
            .slice(0, 90) || undefined,
      };
    case 'add_journal':
      return { kind: 'note', label: a.section === 'results' ? t('Итоги дня') : t('В дневник'), title: a.text.slice(0, 120), meta: a.date ? dateLabel(a.date) : t('сегодня') };
    case 'add_transaction':
      return {
        kind: 'money',
        label: a.kind === 'income' ? t('Доход') : t('Расход'),
        title: `${a.kind === 'income' ? '+' : '−'}${a.amount.toLocaleString(LOCALE)}${a.category ? ' · ' + a.category : ''}`,
        meta: [a.note, a.date && dateLabel(a.date)].filter(Boolean).join(' · ') || undefined,
      };
    case 'add_goal':
      return { kind: 'goal', label: t('Новая цель'), title: `${a.emoji ? a.emoji + ' ' : ''}${a.title}`, meta: a.deadline ? t('до {date}', { date: dateLabel(a.deadline) }) : undefined };
    case 'add_goal_stage': {
      const g = getGoal(a.goalId);
      return {
        kind: 'goal',
        label: g ? t('Этап цели «{title}»', { title: g.title }) : t('Этап цели'),
        title: a.title,
        meta: a.steps.length ? a.steps.slice(0, 4).join(' · ') + (a.steps.length > 4 ? ' · ' + t('ещё {n}', { n: a.steps.length - 4 }) : '') : undefined,
      };
    }
  }
}

// ---------- Выполнение ----------

function pickByName<T extends { id: string; name: string }>(items: T[], q: string | undefined): T | undefined {
  if (!q) return undefined;
  const s = q.toLowerCase().trim();
  return items.find((x) => x.id === q) ?? items.find((x) => x.name.toLowerCase() === s) ?? items.find((x) => x.name.toLowerCase().startsWith(s) || s.startsWith(x.name.toLowerCase()));
}

function txTarget(d: FinanceData, a: Extract<AssistantAction, { type: 'add_transaction' }>) {
  const accs = sortedAccounts(d);
  const account = pickByName(accs, a.account) ?? accs.find((x) => x.id === d.prefs.lastAccountId) ?? accs[0];
  const cats = sortedCategories(d, a.kind);
  const category = pickByName(cats, a.category);
  return { account, category };
}

/** Выполнить действие. Возвращает короткий итог для карточки */
export async function executeAction(a: AssistantAction): Promise<{ ok: boolean; info: string }> {
  switch (a.type) {
    case 'add_task': {
      const d = await ensureTasks();
      const list = a.list ? pickByName(d.lists, a.list) : undefined;
      const task = addTask({
        title: a.title,
        ...(a.date ? { date: a.date } : {}),
        ...(a.date && a.time ? { time: a.time } : {}),
        ...(a.duration && a.time ? { duration: a.duration } : {}),
        ...(a.notes ? { notes: a.notes } : {}),
        ...(list ? { listId: list.id } : {}),
        priority: a.priority ?? 0,
      });
      return task ? { ok: true, info: t('Задача добавлена') } : { ok: false, info: t('Не удалось добавить задачу') };
    }
    case 'complete_task': {
      await ensureTasks();
      const task = getTask(a.id);
      if (!task || task.deleted) return { ok: false, info: t('Задача не найдена') };
      if (!isActive(task)) return { ok: true, info: t('Уже выполнена') };
      toggleDone(a.id);
      return { ok: true, info: t('Выполнено') };
    }
    case 'reschedule_task': {
      await ensureTasks();
      const task = getTask(a.id);
      if (!task || task.deleted) return { ok: false, info: t('Задача не найдена') };
      updateTask(a.id, { date: a.date, ...(a.time !== undefined ? { time: a.time ?? undefined } : {}) });
      return { ok: true, info: t('Перенесено на {date}', { date: dateLabel(a.date) }) };
    }
    case 'add_journal': {
      const { appendToDaily } = await import('../notes/daily');
      const r = await appendToDaily(a.text, a.section ?? 'thoughts', a.date ?? todayYmd());
      return r ? { ok: true, info: t('Записано в заметку дня') } : { ok: false, info: t('Не удалось записать') };
    }
    case 'add_note': {
      await ensureNotes();
      const blocks = a.text ? markdownToBlocks(a.text) : [];
      const n = createNote({ title: a.title, blocks });
      return n ? { ok: true, info: t('Заметка создана') } : { ok: false, info: t('Не удалось создать заметку') };
    }
    case 'add_transaction': {
      const d = await ensureFinance();
      const { account, category } = txTarget(d, a);
      if (!account) return { ok: false, info: t('Нет счёта — создайте его в Финансах') };
      const tx = addTransaction({
        type: a.kind,
        amount: a.amount,
        accountId: account.id,
        date: a.date ?? todayYmd(),
        ...(category ? { categoryId: category.id } : {}),
        ...(a.note ? { note: a.note } : {}),
      });
      return tx
        ? { ok: true, info: `${fmtMoney(a.amount, account.currency)} · ${category ? category.emoji + ' ' + category.name : t('без категории')} · ${account.name}` }
        : { ok: false, info: t('Не удалось записать операцию') };
    }
    case 'add_goal': {
      await ensureGoals();
      const g = addGoal({
        title: a.title,
        ...(a.deadline ? { deadline: a.deadline, period: 'custom' as const } : {}),
        ...(a.emoji ? { emoji: a.emoji } : {}),
        ...(a.why ? { why: a.why } : {}),
      });
      return g ? { ok: true, info: t('Цель создана') } : { ok: false, info: t('Не удалось создать цель') };
    }
    case 'add_goal_stage': {
      await ensureGoals();
      if (!getGoal(a.goalId)) return { ok: false, info: t('Цель не найдена') };
      addStages(a.goalId, [{ title: a.title, steps: a.steps, ...(a.deadline ? { deadline: a.deadline } : {}) }]);
      return { ok: true, info: a.steps.length ? t('Этап добавлен, шагов: {n}', { n: a.steps.length }) : t('Этап добавлен') };
    }
  }
}

/** Задача из действия ещё существует и активна (для подсказок в карточке) */
export function taskExists(id: string): boolean {
  return !!useTasks.getState().data?.tasks.some((t) => t.id === id && !t.deleted);
}
