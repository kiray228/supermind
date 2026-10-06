import { create } from 'zustand';
import { get, set } from '../store/kv';
import { uid } from '../utils/tree';
import { todayYmd } from '../utils/mapTasks';
import { toast } from '../store/appStore';
import {
  accountMap,
  advanceSub,
  budgetLevel,
  categoryMap,
  fmtMoney,
  monthEnd,
  monthStart,
  normalizeFinance,
  r2,
  summarize,
  type Account,
  type Budget,
  type Category,
  type Debt,
  type DebtPayment,
  type EntityKey,
  type FinanceData,
  type FinancePrefs,
  type Subscription,
  type Transaction,
} from './model';

const KEY = 'finance';

interface FinanceState {
  data: FinanceData | null;
}

export const useFinance = create<FinanceState>(() => ({ data: null }));

let loading: Promise<FinanceData> | null = null;

/** Загрузить финансы (один раз). При первом запуске — категории и счета по умолчанию */
export function ensureFinance(): Promise<FinanceData> {
  const cur = useFinance.getState().data;
  if (cur) return Promise.resolve(cur);
  if (!loading) {
    loading = (async () => {
      const d = normalizeFinance(await get<FinanceData>(KEY));
      // данные могли появиться, пока шло чтение (reloadFinance)
      const now = useFinance.getState().data;
      if (now) return now;
      useFinance.setState({ data: d });
      return d;
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

/** Перечитать из базы без отметки «изменено» (после получения данных с сервера или восстановления копии) */
export async function reloadFinance(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const d = normalizeFinance(await get<FinanceData>(KEY));
  loading = Promise.resolve(d);
  useFinance.setState({ data: d });
}

// ---------- Сохранение ----------

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Сохранить отложенные изменения (только если они есть) */
export function flushFinance(): Promise<void> {
  if (!saveTimer) return Promise.resolve();
  clearTimeout(saveTimer);
  saveTimer = null;
  const d = useFinance.getState().data;
  return d ? set(KEY, d).catch(() => toast('Не удалось сохранить финансы')) : Promise.resolve();
}

/** Изменить данные: fn получает копию, сохранение — автоматически через 250 мс */
export function mutateFinance(fn: (d: FinanceData) => void) {
  const cur = useFinance.getState().data;
  if (!cur) return;
  const d = structuredClone(cur);
  fn(d);
  useFinance.setState({ data: d });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushFinance(), 250);
}

export const financeData = () => useFinance.getState().data;

// ---------- Общие операции с сущностями ----------

type Entity<K extends EntityKey> = FinanceData[K][number];

function upsertIn<K extends EntityKey>(d: FinanceData, key: K, item: Entity<K>) {
  const arr = d[key] as Entity<K>[];
  const x = { ...item, updatedAt: Date.now() } as Entity<K>;
  const i = arr.findIndex((y) => y.id === item.id);
  if (i >= 0) arr[i] = x;
  else arr.push(x);
  if (d.gone?.[item.id]) delete d.gone[item.id];
}

function removeIn(d: FinanceData, key: EntityKey, id: string) {
  const arr = d[key] as { id: string }[];
  const i = arr.findIndex((y) => y.id === id);
  if (i >= 0) arr.splice(i, 1);
  d.gone = { ...(d.gone ?? {}), [id]: Date.now() };
}

/** Удалить все подходящие сущности одним проходом */
function removeWhere<K extends EntityKey>(d: FinanceData, key: K, pred: (x: Entity<K>) => boolean) {
  const now = Date.now();
  const gone = (d.gone = { ...(d.gone ?? {}) });
  const keep: Entity<K>[] = [];
  for (const x of d[key] as Entity<K>[]) {
    if (pred(x)) gone[x.id] = now;
    else keep.push(x);
  }
  (d as unknown as Record<EntityKey, Entity<K>[]>)[key] = keep;
}

function clean<T extends object>(x: T): T {
  for (const k of Object.keys(x) as (keyof T)[]) if (x[k] === undefined) delete x[k];
  return x;
}

// ---------- Операции ----------

export type TxDraft = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'tags'> & { tags?: string[] };

function normalizeTx(t: Transaction): Transaction {
  t.amount = r2(Math.abs(t.amount));
  if (t.type === 'transfer') {
    delete t.categoryId;
    if (t.toAmount !== undefined) t.toAmount = r2(Math.abs(t.toAmount));
  } else {
    delete t.toAccountId;
    delete t.toAmount;
  }
  if (!t.time) delete t.time;
  if (!t.note?.trim()) delete t.note;
  else t.note = t.note.trim();
  return clean(t);
}

export function addTransaction(p: TxDraft, opts: { silent?: boolean } = {}): Transaction | null {
  const d = useFinance.getState().data;
  if (!d) return null;
  const now = Date.now();
  const t = normalizeTx({ ...p, tags: p.tags ?? [], id: uid(), createdAt: now, updatedAt: now });
  const alert = !opts.silent && t.type === 'expense' ? budgetAlert(d, t) : null;
  mutateFinance((x) => {
    x.transactions.push(t);
    if (x.prefs.lastAccountId !== t.accountId) x.prefs = { ...x.prefs, lastAccountId: t.accountId, updatedAt: now };
  });
  if (alert) toast(alert);
  return t;
}

/** Массовое добавление (импорт). Возвращает число добавленных */
export function addTransactions(list: TxDraft[]): number {
  const now = Date.now();
  const items = list.map((p, i) => normalizeTx({ ...p, tags: p.tags ?? [], id: uid(), createdAt: now + i, updatedAt: now }));
  if (items.length) mutateFinance((x) => void x.transactions.push(...items));
  return items.length;
}

export function updateTransaction(id: string, patch: Partial<Transaction>) {
  mutateFinance((d) => {
    const i = d.transactions.findIndex((t) => t.id === id);
    if (i < 0) return;
    d.transactions[i] = normalizeTx({ ...d.transactions[i], ...patch, id, updatedAt: Date.now() });
  });
}

export function deleteTransaction(id: string, undo = true) {
  const t = useFinance.getState().data?.transactions.find((x) => x.id === id);
  if (!t) return;
  mutateFinance((d) => removeIn(d, 'transactions', id));
  if (undo) toast('Операция удалена', { label: 'Отменить', run: () => mutateFinance((d) => upsertIn(d, 'transactions', t)) });
}

/** Сообщение о превышении бюджета, если новая трата выводит категорию или общий бюджет за лимит */
function budgetAlert(d: FinanceData, t: Transaction): string | null {
  if (!d.budgets.length) return null;
  const r = { from: monthStart(t.date), to: monthEnd(t.date) };
  const before = summarize(d, r);
  const after = summarize({ ...d, transactions: [...d.transactions, t] }, r);
  const main = d.prefs.mainCurrency;
  const msgs: string[] = [];
  const cats = categoryMap(d);
  for (const b of d.budgets) {
    const was = b.categoryId ? (before.byCat.get(b.categoryId) ?? 0) : before.expense;
    const now = b.categoryId ? (after.byCat.get(b.categoryId) ?? 0) : after.expense;
    if (now <= was || budgetLevel(now, b.limit) !== 'over') continue;
    const name = b.categoryId ? `«${cats.get(b.categoryId)?.name ?? 'Категория'}»` : 'на месяц';
    msgs.push(`бюджет ${name} превышен на ${fmtMoney(now - b.limit, main)}`);
  }
  if (!msgs.length) return null;
  const s = msgs.join('; ');
  return 'Внимание: ' + s;
}

// ---------- Счета ----------

export function saveAccount(a: Omit<Account, 'updatedAt' | 'order'> & { order?: number }) {
  mutateFinance((d) => {
    const old = d.accounts.find((x) => x.id === a.id);
    const order = a.order ?? old?.order ?? d.accounts.reduce((m, x) => Math.max(m, x.order + 1), 0);
    upsertIn(d, 'accounts', clean({ ...a, initial: r2(a.initial), order, updatedAt: 0 }));
  });
}

/** Удалить счёт вместе с его операциями */
export function deleteAccount(id: string) {
  mutateFinance((d) => {
    removeIn(d, 'accounts', id);
    removeWhere(d, 'transactions', (t) => t.accountId === id || t.toAccountId === id);
    removeWhere(d, 'subscriptions', (s) => s.accountId === id);
  });
}

export function moveAccount(id: string, dir: -1 | 1) {
  mutateFinance((d) => {
    const list = [...d.accounts].sort((a, b) => a.order - b.order);
    const i = list.findIndex((a) => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const now = Date.now();
    list.forEach((a, k) => {
      if (a.order !== k) {
        a.order = k;
        a.updatedAt = now;
      }
    });
  });
}

// ---------- Категории ----------

export function saveCategory(c: Omit<Category, 'updatedAt' | 'order'> & { order?: number }) {
  mutateFinance((d) => {
    const old = d.categories.find((x) => x.id === c.id);
    const order = c.order ?? old?.order ?? d.categories.filter((x) => x.kind === c.kind).reduce((m, x) => Math.max(m, x.order + 1), 0);
    upsertIn(d, 'categories', { ...c, order, updatedAt: 0 });
  });
}

/** Удалить категорию: операции остаются «без категории», лимит удаляется */
export function deleteCategory(id: string) {
  mutateFinance((d) => {
    removeIn(d, 'categories', id);
    const now = Date.now();
    for (const t of d.transactions)
      if (t.categoryId === id) {
        delete t.categoryId;
        t.updatedAt = now;
      }
    for (const s of d.subscriptions)
      if (s.categoryId === id) {
        delete s.categoryId;
        s.updatedAt = now;
      }
    removeWhere(d, 'budgets', (b) => b.categoryId === id);
  });
}

export function moveCategory(id: string, dir: -1 | 1) {
  mutateFinance((d) => {
    const c = d.categories.find((x) => x.id === id);
    if (!c) return;
    const list = d.categories.filter((x) => x.kind === c.kind).sort((a, b) => a.order - b.order);
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const now = Date.now();
    list.forEach((x, k) => {
      if (x.order !== k) {
        x.order = k;
        x.updatedAt = now;
      }
    });
  });
}

// ---------- Бюджеты ----------

/** Задать месячный лимит (categoryId не указан — общий бюджет). limit ≤ 0 — удалить */
export function setBudget(categoryId: string | undefined, limit: number) {
  mutateFinance((d) => {
    const old = d.budgets.find((b) => (b.categoryId ?? '') === (categoryId ?? ''));
    if (!(limit > 0)) {
      if (old) removeIn(d, 'budgets', old.id);
      return;
    }
    const b: Budget = clean({ id: old?.id ?? uid(), categoryId, limit: r2(limit), updatedAt: 0 });
    upsertIn(d, 'budgets', b);
  });
}

// ---------- Подписки ----------

export function saveSubscription(s: Omit<Subscription, 'updatedAt'>) {
  mutateFinance((d) => upsertIn(d, 'subscriptions', clean({ ...s, amount: r2(s.amount), every: Math.max(1, Math.round(s.every || 1)), updatedAt: 0 })));
}

export function deleteSubscription(id: string) {
  mutateFinance((d) => removeIn(d, 'subscriptions', id));
}

/** «Оплачено»: записать расход и перенести дату следующего платежа */
export function paySubscription(id: string, date = todayYmd()): Transaction | null {
  const d = useFinance.getState().data;
  const s = d?.subscriptions.find((x) => x.id === id);
  if (!d || !s) return null;
  if (!accountMap(d).has(s.accountId)) {
    toast('Выберите счёт для этого платежа');
    return null;
  }
  const prevNext = s.nextDate;
  const t = addTransaction({ type: 'expense', amount: s.amount, accountId: s.accountId, categoryId: s.categoryId, date, note: s.name, subscriptionId: s.id });
  mutateFinance((x) => {
    const y = x.subscriptions.find((z) => z.id === id);
    if (!y) return;
    y.nextDate = advanceSub(y, y.nextDate);
    y.updatedAt = Date.now();
  });
  if (t)
    toast(`Оплачено: ${s.name}`, {
      label: 'Отменить',
      run: () =>
        mutateFinance((x) => {
          removeIn(x, 'transactions', t.id);
          const y = x.subscriptions.find((z) => z.id === id);
          if (y) {
            y.nextDate = prevNext;
            y.updatedAt = Date.now();
          }
        }),
    });
  return t;
}

/** Пропустить платёж (перенести дату без операции) */
export function skipSubscription(id: string) {
  mutateFinance((d) => {
    const y = d.subscriptions.find((z) => z.id === id);
    if (!y) return;
    y.nextDate = advanceSub(y, y.nextDate);
    y.updatedAt = Date.now();
  });
}

// ---------- Долги ----------

export function saveDebt(x: Omit<Debt, 'updatedAt'>) {
  mutateFinance((d) => upsertIn(d, 'debts', clean({ ...x, amount: r2(x.amount), updatedAt: 0 })));
}

export function deleteDebt(id: string) {
  mutateFinance((d) => removeIn(d, 'debts', id));
}

/** Частичное погашение; при полном — долг закрывается */
export function addDebtPayment(id: string, amount: number, date = todayYmd()) {
  mutateFinance((d) => {
    const x = d.debts.find((y) => y.id === id);
    if (!x || !(amount > 0)) return;
    const p: DebtPayment = { id: uid(), date, amount: r2(amount) };
    x.payments = [...x.payments, p];
    const paid = x.payments.reduce((a, q) => a + q.amount, 0);
    if (paid >= x.amount - 0.005) x.closed = true;
    x.updatedAt = Date.now();
  });
}

export function removeDebtPayment(id: string, paymentId: string) {
  mutateFinance((d) => {
    const x = d.debts.find((y) => y.id === id);
    if (!x) return;
    x.payments = x.payments.filter((p) => p.id !== paymentId);
    x.updatedAt = Date.now();
  });
}

// ---------- Настройки ----------

export function setFinancePrefs(patch: Partial<Omit<FinancePrefs, 'updatedAt'>>) {
  mutateFinance((d) => void (d.prefs = clean({ ...d.prefs, ...patch, updatedAt: Date.now() })));
}

export { upcomingPayments } from './model';
