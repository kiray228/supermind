/**
 * Копилки: цель-накопление, прогресс которой считается по остатку счёта в Финансах.
 * Отложить деньги = перевести их на счёт-копилку — цель продвигается сама.
 * Модуль без состояния: данные финансов подставляет хранилище целей (setSavingsSource).
 */
import { addDaysYmd, todayYmd } from '../utils/mapTasks';
import { balances, dateLong, daysBetweenYmd, fmtMoney, fmtNum, r2, toMain, type Account, type FinanceData, type FinancePrefs } from '../finance/model';
import type { Goal, GoalSavings } from './model';

// ---------- Источник данных финансов ----------

let source: () => FinanceData | null = () => null;

/** Откуда брать финансы (регистрирует хранилище целей) */
export function setSavingsSource(fn: () => FinanceData | null) {
  source = fn;
}

export const savingsFinance = () => source();

// остатки считаем один раз на версию данных
const balCache = new WeakMap<FinanceData, Map<string, number>>();
function balOf(fin: FinanceData): Map<string, number> {
  let m = balCache.get(fin);
  if (!m) {
    m = balances(fin);
    balCache.set(fin, m);
  }
  return m;
}

/** Пересчёт между валютами через курсы Финансов (без курса — как есть) */
export function convertCur(x: number, from: string, to: string, prefs: FinancePrefs): number {
  if (from === to) return x;
  const inMain = toMain(x, from, prefs);
  if (inMain === null) return x;
  if (to === prefs.mainCurrency) return inMain;
  const r = prefs.rates[to];
  return r && r > 0 ? inMain / r : x;
}

// ---------- Нормализация ----------

export function normalizeSavings(raw: unknown): GoalSavings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Partial<GoalSavings>;
  if (typeof s.accountId !== 'string' || !s.accountId) return undefined;
  const amount = Number(s.amount);
  const base = Number(s.base);
  return {
    accountId: s.accountId,
    amount: Number.isFinite(amount) && amount > 0 ? r2(amount) : 0,
    currency: typeof s.currency === 'string' && s.currency ? s.currency : 'KZT',
    ...(Number.isFinite(base) && base > 0 ? { base: r2(base) } : {}),
  };
}

// ---------- Состояние копилки ----------

export interface SavingsInfo {
  /** финансы ещё не загружены */
  loading: boolean;
  /** счёт не выбран или удалён */
  missing: boolean;
  account?: Account;
  /** валюта цели */
  currency: string;
  amount: number;
  /** остаток счёта (в валюте цели) */
  balance: number;
  /** накоплено с учётом «не считать начальный остаток» */
  saved: number;
  left: number;
  pct: number;
  reached: boolean;
}

export function savingsInfo(g: Pick<Goal, 'savings'>, fin: FinanceData | null = source()): SavingsInfo {
  const s = g.savings;
  const currency = s?.currency ?? fin?.prefs.mainCurrency ?? 'KZT';
  const amount = s?.amount ?? 0;
  const empty = { currency, amount, balance: 0, saved: 0, left: amount, pct: 0, reached: false };
  if (!s) return { ...empty, loading: false, missing: true };
  if (!fin) return { ...empty, loading: true, missing: false };
  const account = fin.accounts.find((a) => a.id === s.accountId);
  if (!account) return { ...empty, loading: false, missing: true };
  const balance = r2(convertCur(balOf(fin).get(account.id) ?? 0, account.currency, currency, fin.prefs));
  const saved = r2(Math.max(0, balance - (s.base ?? 0)));
  const left = r2(Math.max(0, amount - saved));
  const reached = amount > 0 && saved >= amount - 0.005;
  const pct = amount > 0 ? Math.min(100, Math.max(0, (saved / amount) * 100)) : 0;
  return { loading: false, missing: false, account, currency, amount, balance, saved, left, pct, reached };
}

/** Остаток счёта в его валюте (для «не считать уже лежащие деньги») */
export function accountBalance(fin: FinanceData | null, accountId: string): number {
  return fin ? (balOf(fin).get(accountId) ?? 0) : 0;
}

/** «12 500 / 200 000 ₸» */
export function savingsLine(s: SavingsInfo): string {
  return `${fmtNum(s.saved)} / ${fmtMoney(s.amount, s.currency)}`;
}

/** Строка для карточки цели и ассистента */
export function savingsNext(g: Pick<Goal, 'savings'>): string | null {
  if (!g.savings) return 'Выберите счёт-копилку';
  const s = savingsInfo(g);
  if (s.loading) return null;
  if (s.missing) return 'Счёт-копилка удалён';
  if (s.reached) return `Копилка собрана: ${fmtMoney(s.saved, s.currency)} 🎉`;
  return `${savingsLine(s)} · осталось ${fmtMoney(s.left, s.currency)}`;
}

// ---------- Темп и подсказки ----------

/** Чистый приток на счёт за последние 30 дней (в валюте цели) */
export function savingsPace30(fin: FinanceData | null, accountId: string, currency: string, today = todayYmd()): number {
  const acc = fin?.accounts.find((a) => a.id === accountId);
  if (!fin || !acc) return 0;
  const from = addDaysYmd(today, -29);
  let net = 0;
  for (const t of fin.transactions) {
    if (t.date < from || t.date > today) continue;
    if (t.type === 'income' && t.accountId === accountId) net += t.amount;
    else if (t.type === 'expense' && t.accountId === accountId) net -= t.amount;
    else if (t.type === 'transfer') {
      if (t.accountId === accountId) net -= t.amount;
      if (t.toAccountId === accountId) net += t.toAmount ?? t.amount;
    }
  }
  return r2(convertCur(net, acc.currency, currency, fin.prefs));
}

/** Округление рекомендаций вверх до «красивых» сумм */
export function niceUp(x: number): number {
  if (!(x > 0)) return 0;
  const step = x >= 10000 ? 100 : x >= 1000 ? 10 : 1;
  return Math.ceil(x / step - 1e-9) * step;
}

const DAYS_IN_MONTH = 30.44;

export interface SavingsHint {
  kind: 'done' | 'plan' | 'late' | 'pace' | 'idle' | 'none';
  text: string;
  sub?: string;
  /** сколько отложить сейчас, чтобы идти по плану (в месяц / неделю / день) — для быстрой суммы */
  suggest?: number;
}

/**
 * Подсказка: сколько откладывать до срока, или когда накопится при текущем темпе.
 * pace30 — чистый приток за последние 30 дней.
 */
export function savingsHint(s: Pick<SavingsInfo, 'left' | 'reached' | 'saved' | 'currency' | 'amount'>, deadline: string | undefined, pace30: number, today = todayYmd()): SavingsHint {
  const m = (x: number) => fmtMoney(niceUp(x), s.currency);
  if (s.amount <= 0) return { kind: 'none', text: 'Укажите, сколько нужно накопить' };
  if (s.reached) return { kind: 'done', text: 'Копилка собрана! 🎉', sub: `Накоплено ${fmtMoney(s.saved, s.currency)} — цель достигнута` };
  const paceText = pace30 > 0 ? `За последние 30 дней: +${fmtMoney(pace30, s.currency)}` : pace30 < 0 ? `За последние 30 дней: −${fmtMoney(-pace30, s.currency)}` : '';
  if (deadline && deadline >= today) {
    const days = daysBetweenYmd(today, deadline) + 1;
    const perMonth = s.left / (days / DAYS_IN_MONTH);
    const perWeek = s.left / (days / 7);
    // до срока меньше месяца — считаем по неделям, меньше недели — по дням
    const suggest = days >= 31 ? perMonth : days >= 7 ? perWeek : s.left / days;
    let text: string;
    if (days >= 31) text = `Чтобы успеть к ${dateLong(deadline)}, откладывайте ≈ ${m(perMonth)} в месяц (≈ ${m(perWeek)} в неделю)`;
    else if (days >= 7) text = `Чтобы успеть к ${dateLong(deadline)}, откладывайте ≈ ${m(perWeek)} в неделю`;
    else text = `Чтобы успеть к ${dateLong(deadline)}, откладывайте ≈ ${m(suggest)} в день`;
    const sub = pace30 > 0 ? (pace30 >= perMonth * 0.98 ? `${paceText} — в таком темпе успеваете ✓` : `${paceText} — нужно чуть быстрее`) : paceText || undefined;
    return { kind: 'plan', text, sub, suggest: Math.min(niceUp(suggest), s.left) };
  }
  const forecast = pace30 > 0 ? Math.ceil((s.left / pace30) * 30) : 0;
  const when = forecast > 3650 ? 'больше чем через 10 лет' : `к ${dateLong(addDaysYmd(today, forecast))}`;
  if (deadline) {
    return {
      kind: 'late',
      text: `Срок прошёл — осталось накопить ${fmtMoney(s.left, s.currency)}`,
      sub: pace30 > 0 ? `При текущем темпе — ${when}` : 'Перенесите срок или пополните копилку',
    };
  }
  if (pace30 > 0) return { kind: 'pace', text: `При текущем темпе (последние 30 дней) — ${when}`, sub: paceText };
  return {
    kind: 'idle',
    text: pace30 < 0 ? 'За 30 дней из копилки больше сняли, чем отложили' : 'За последние 30 дней копилка не пополнялась',
    sub: 'Задайте срок — подскажем, сколько откладывать',
  };
}

// ---------- Для Финансов ----------

/** Активные копилки по счетам: id счёта → процент первой привязанной цели */
export function savingsByAccount(goals: { goals: Goal[] } | null | undefined, fin: FinanceData | null): Map<string, { pct: number; title: string }> {
  const m = new Map<string, { pct: number; title: string }>();
  if (!goals || !fin) return m;
  for (const g of goals.goals) {
    if (g.mode !== 'savings' || g.status !== 'active' || !g.savings || m.has(g.savings.accountId)) continue;
    const s = savingsInfo(g, fin);
    if (!s.missing) m.set(g.savings.accountId, { pct: Math.floor(s.pct), title: g.title });
  }
  return m;
}

/** Значение «новый счёт» в выборе счёта-копилки */
export const NEW_SAVINGS_ACCOUNT = '__new__';

/** Черновик полей копилки в редакторе цели */
export interface SavingsDraft {
  /** id счёта, NEW_SAVINGS_ACCOUNT — создать новый, '' — не выбран */
  accountId: string;
  amount: string;
  newName: string;
  newCurrency: string;
  /** засчитать деньги, которые уже лежат на счёте */
  countExisting: boolean;
}

export const defaultSavingsName = (title: string) => (title.trim() ? `Копилка: ${title.trim()}`.slice(0, 40) : 'Копилка');

/**
 * Какой остаток счёта не засчитывать в прогресс.
 * Галочка «засчитать» — ничего; иначе прежний (если счёт тот же) или текущий остаток.
 */
export function savingsBase(draft: Pick<SavingsDraft, 'accountId' | 'countExisting'>, prev: GoalSavings | undefined, balance: number): number | undefined {
  if (draft.countExisting) return undefined;
  if (prev && prev.accountId === draft.accountId && (prev.base ?? 0) > 0) return prev.base;
  return balance > 0 ? r2(balance) : undefined;
}
