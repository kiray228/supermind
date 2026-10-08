/**
 * Финансы: типы данных, значения по умолчанию и расчёты (балансы, бюджеты, подписки, долги).
 * Все суммы — числа в основных единицах (тенге, рубли…) с точностью до копеек.
 */
import { addDaysYmd, fromYmd, toYmd } from '../utils/mapTasks';

export type TxType = 'expense' | 'income' | 'transfer';
export type CatKind = 'expense' | 'income';

export interface Account {
  id: string;
  name: string;
  emoji: string;
  color: string;
  currency: string;
  /** начальный остаток */
  initial: number;
  archived?: boolean;
  order: number;
  updatedAt: number;
}

export interface Transaction {
  id: string;
  type: TxType;
  /** положительная сумма в валюте счёта accountId */
  amount: number;
  accountId: string;
  /** перевод: счёт зачисления и сумма в его валюте */
  toAccountId?: string;
  toAmount?: number;
  categoryId?: string;
  date: string;
  time?: string;
  note?: string;
  tags: string[];
  subscriptionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
  color: string;
  kind: CatKind;
  order: number;
  updatedAt: number;
}

/** Месячный лимит в основной валюте. Без categoryId — общий бюджет */
export interface Budget {
  id: string;
  categoryId?: string;
  limit: number;
  updatedAt: number;
}

export type SubPeriod = 'week' | 'month' | 'year';

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  accountId: string;
  categoryId?: string;
  period: SubPeriod;
  /** каждые N недель/месяцев/лет */
  every: number;
  nextDate: string;
  /** день месяца, от которого считаются ежемесячные платежи (31 → 28/30/31) */
  anchorDay?: number;
  active: boolean;
  /** напомнить за N дней (меньше 0 — не напоминать) */
  remindDays: number;
  note?: string;
  updatedAt: number;
}

export interface DebtPayment {
  id: string;
  date: string;
  amount: number;
}

export interface Debt {
  id: string;
  /** owe — «Я должен», lent — «Мне должны» */
  kind: 'owe' | 'lent';
  person: string;
  amount: number;
  currency: string;
  date: string;
  dueDate?: string;
  note?: string;
  payments: DebtPayment[];
  closed: boolean;
  /** напомнить в 09:00 в день «вернуть до» */
  remind?: boolean;
  updatedAt: number;
}

export interface FinancePrefs {
  mainCurrency: string;
  /** курс: 1 единица валюты = rates[код] единиц основной валюты */
  rates: Record<string, number>;
  lastAccountId?: string;
  updatedAt: number;
}

export interface FinanceData {
  version: 1;
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  subscriptions: Subscription[];
  debts: Debt[];
  prefs: FinancePrefs;
  /** удалённые сущности: id → когда удалены (чтобы синхронизация их не вернула) */
  gone?: Record<string, number>;
}

export type EntityKey = 'accounts' | 'transactions' | 'categories' | 'budgets' | 'subscriptions' | 'debts';
export const ENTITY_KEYS: EntityKey[] = ['accounts', 'transactions', 'categories', 'budgets', 'subscriptions', 'debts'];

// ---------- Валюты и деньги ----------

export const CURRENCIES: { code: string; symbol: string; name: string }[] = [
  { code: 'KZT', symbol: '₸', name: 'Тенге' },
  { code: 'RUB', symbol: '₽', name: 'Рубль' },
  { code: 'USD', symbol: '$', name: 'Доллар США' },
  { code: 'EUR', symbol: '€', name: 'Евро' },
  { code: 'UZS', symbol: 'сўм', name: 'Узбекский сум' },
  { code: 'KGS', symbol: 'сом', name: 'Киргизский сом' },
  { code: 'UAH', symbol: '₴', name: 'Гривна' },
  { code: 'BYN', symbol: 'Br', name: 'Белорусский рубль' },
  { code: 'GEL', symbol: '₾', name: 'Лари' },
  { code: 'AMD', symbol: '֏', name: 'Драм' },
  { code: 'AZN', symbol: '₼', name: 'Манат' },
  { code: 'TRY', symbol: '₺', name: 'Турецкая лира' },
  { code: 'CNY', symbol: '¥', name: 'Юань' },
  { code: 'GBP', symbol: '£', name: 'Фунт стерлингов' },
  { code: 'AED', symbol: 'AED', name: 'Дирхам ОАЭ' },
  { code: 'THB', symbol: '฿', name: 'Бат' },
];

export function curSymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

export const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(frac: boolean): Intl.NumberFormat {
  const k = frac ? 'f' : 'i';
  let f = nfCache.get(k);
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: frac ? 2 : 0 });
    nfCache.set(k, f);
  }
  return f;
}

const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** Число без валюты: «12 500» / «12 500,50» */
export function fmtNum(x: number): string {
  const v = r2(x);
  return nf(!Number.isInteger(v)).format(Math.abs(v) < 0.005 ? 0 : v);
}

/** Сумма с валютой. sign — показывать «+» у положительных */
export function fmtMoney(x: number, cur: string, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const v = r2(x);
  let body: string;
  if (opts.compact && Math.abs(v) >= 10000) {
    const a = Math.abs(v);
    body = a >= 1e6 ? `${nf1.format(a / 1e6)} млн` : `${nf(false).format(Math.round(a / 1000))} тыс.`;
    body = (v < 0 ? '−' : '') + body;
  } else {
    body = fmtNum(Math.abs(v));
    if (v < 0) body = '−' + body;
  }
  const plus = opts.sign && v > 0 ? '+' : '';
  return `${plus}${body} ${curSymbol(cur)}`;
}

/** Разбор суммы из поля ввода: «1 200,5» → 1200.5 */
export function parseMoneyInput(s: string): number {
  let t = s.replace(/[\s ]/g, '').replace(/[−–]/g, '-');
  // «1.200,50» / «1,200.50»: дробный разделитель — тот, что правее, другой разделяет тысячи
  if (t.includes(',') && t.includes('.') && !/\d[+-]/.test(t)) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '') : t.replace(/,/g, '');
  // запятая — дробная часть в каждом слагаемом («1200,5+300,5»)
  t = t.replace(/,/g, '.').replace(/[^\d.+-]/g, '');
  // простая арифметика «1200+350» — удобно на телефоне
  if (/^[\d.]+([+-][\d.]+)+$/.test(t)) {
    const parts = t.match(/[+-]?[\d.]+/g) ?? [];
    return r2(parts.reduce((a, p) => a + (Number(p) || 0), 0));
  }
  const n = Number(t);
  return Number.isFinite(n) ? r2(n) : NaN;
}

// ---------- Категории по умолчанию ----------

export const COLORS = ['#22c55e', '#f97316', '#3b82f6', '#8b5cf6', '#06b6d4', '#ef4444', '#ec4899', '#a855f7', '#6366f1', '#0ea5e9', '#f43f5e', '#14b8a6', '#d946ef', '#f59e0b', '#84cc16', '#64748b'];

export const EMOJIS = [
  '🛒', '🍽️', '☕', '🚕', '🚌', '⛽', '🏠', '💡', '📱', '🌐', '💊', '🏥', '👕', '👟', '🎮', '🎬', '🔁', '📚', '🎁', '✈️', '🏖️', '💅', '🧸', '🐾', '📦',
  '💼', '🛠️', '💳', '🏦', '🏷️', '💰', '💵', '💸', '🪙', '📈', '🚗', '🏋️', '🎵', '🍔', '🍺', '🧾', '🔧', '🎓', '👶', '❤️', '⭐',
];

/** Постоянные id: на всех устройствах одинаковые, синхронизация не создаёт дубликатов */
const DEFAULT_CATS: [string, string, string, string, CatKind][] = [
  ['c-food', 'Продукты', '🛒', '#22c55e', 'expense'],
  ['c-cafe', 'Кафе и рестораны', '🍽️', '#f97316', 'expense'],
  ['c-transport', 'Транспорт', '🚕', '#3b82f6', 'expense'],
  ['c-home', 'Дом и ЖКХ', '🏠', '#8b5cf6', 'expense'],
  ['c-mobile', 'Связь и интернет', '📱', '#06b6d4', 'expense'],
  ['c-health', 'Здоровье', '💊', '#ef4444', 'expense'],
  ['c-clothes', 'Одежда', '👕', '#ec4899', 'expense'],
  ['c-fun', 'Развлечения', '🎮', '#a855f7', 'expense'],
  ['c-subs', 'Подписки', '🔁', '#6366f1', 'expense'],
  ['c-edu', 'Образование', '📚', '#0ea5e9', 'expense'],
  ['c-gifts', 'Подарки', '🎁', '#f43f5e', 'expense'],
  ['c-travel', 'Путешествия', '✈️', '#14b8a6', 'expense'],
  ['c-beauty', 'Красота', '💅', '#d946ef', 'expense'],
  ['c-kids', 'Дети', '🧸', '#f59e0b', 'expense'],
  ['c-pets', 'Животные', '🐾', '#84cc16', 'expense'],
  ['c-other', 'Другое', '📦', '#64748b', 'expense'],
  ['i-salary', 'Зарплата', '💼', '#16a34a', 'income'],
  ['i-side', 'Подработка', '🛠️', '#0ea5e9', 'income'],
  ['i-gifts', 'Подарки', '🎁', '#f43f5e', 'income'],
  ['i-cashback', 'Кэшбэк', '💳', '#f59e0b', 'income'],
  ['i-interest', 'Проценты', '🏦', '#6366f1', 'income'],
  ['i-sale', 'Продажа', '🏷️', '#14b8a6', 'income'],
  ['i-other', 'Другое', '💰', '#64748b', 'income'],
];

// updatedAt = 1: любая правка пользователя на другом устройстве новее значений по умолчанию
export function defaultCategories(): Category[] {
  return DEFAULT_CATS.map(([id, name, emoji, color, kind], i) => ({ id, name, emoji, color, kind, order: i, updatedAt: 1 }));
}

export function defaultAccounts(cur = 'KZT'): Account[] {
  return [
    { id: 'a-cash', name: 'Наличные', emoji: '💵', color: '#22c55e', currency: cur, initial: 0, order: 0, updatedAt: 1 },
    { id: 'a-card', name: 'Карта', emoji: '💳', color: '#3b82f6', currency: cur, initial: 0, order: 1, updatedAt: 1 },
  ];
}

export const DEFAULT_PREFS: FinancePrefs = { mainCurrency: 'KZT', rates: {}, updatedAt: 1 };

export function emptyFinance(): FinanceData {
  return {
    version: 1,
    accounts: defaultAccounts(),
    transactions: [],
    categories: defaultCategories(),
    budgets: [],
    subscriptions: [],
    debts: [],
    prefs: { ...DEFAULT_PREFS, rates: {} },
    gone: {},
  };
}

/** Привести сохранённые данные к текущему формату */
export function normalizeFinance(raw: Partial<FinanceData> | undefined | null): FinanceData {
  if (!raw || typeof raw !== 'object') return emptyFinance();
  const gone: Record<string, number> = { ...(raw.gone ?? {}) };
  const alive = <T extends { id: string; updatedAt: number }>(arr: T[] | undefined): T[] =>
    (Array.isArray(arr) ? arr : []).filter((x) => x && x.id && !(gone[x.id] && gone[x.id] >= (x.updatedAt ?? 0)));
  return {
    version: 1,
    accounts: alive(raw.accounts).map((a) => ({ ...a, initial: Number(a.initial) || 0, order: a.order ?? 0, currency: a.currency || 'KZT' })),
    transactions: alive(raw.transactions).map((t) => ({ ...t, tags: t.tags ?? [], amount: Number(t.amount) || 0 })),
    categories: alive(raw.categories),
    budgets: alive(raw.budgets),
    subscriptions: alive(raw.subscriptions).map((s) => ({ ...s, every: Math.max(1, s.every || 1), remindDays: s.remindDays ?? 1 })),
    debts: alive(raw.debts).map((d) => ({ ...d, payments: d.payments ?? [] })),
    prefs: { ...DEFAULT_PREFS, ...(raw.prefs ?? {}), rates: { ...(raw.prefs?.rates ?? {}) } },
    gone,
  };
}

// ---------- Даты и периоды ----------

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export const monthKey = (ymd: string) => ymd.slice(0, 7);
export const monthStart = (ymd: string) => ymd.slice(0, 7) + '-01';
export function daysInMonth(ymd: string): number {
  const d = fromYmd(ymd);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
export const monthEnd = (ymd: string) => ymd.slice(0, 8) + String(daysInMonth(ymd)).padStart(2, '0');

/** Сдвиг на n месяцев; day — желаемый день месяца (по умолчанию текущий), с поправкой на длину месяца */
export function addMonthsYmd(ymd: string, n: number, day?: number): string {
  const d = fromYmd(ymd);
  const want = day ?? d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(want, dim));
  return toYmd(t);
}

export function monthTitle(ymd: string): string {
  const d = fromYmd(ymd);
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return MONTHS[d.getMonth()] + y;
}

/** «5 октября» / «5 октября 2025» */
export function dateLong(ymd: string): string {
  const d = fromYmd(ymd);
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${y}`;
}
export function dateShort(ymd: string): string {
  const d = fromYmd(ymd);
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${String(d.getFullYear()).slice(2)}` : '';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${y}`;
}

export type PeriodKind = 'week' | 'month' | 'year' | 'custom';
export interface Range {
  from: string;
  to: string;
}

export function periodRange(kind: Exclude<PeriodKind, 'custom'>, anchor: string): Range {
  if (kind === 'month') return { from: monthStart(anchor), to: monthEnd(anchor) };
  if (kind === 'year') return { from: anchor.slice(0, 4) + '-01-01', to: anchor.slice(0, 4) + '-12-31' };
  const wd = (fromYmd(anchor).getDay() + 6) % 7; // понедельник — 0
  const from = addDaysYmd(anchor, -wd);
  return { from, to: addDaysYmd(from, 6) };
}

export function shiftAnchor(kind: Exclude<PeriodKind, 'custom'>, anchor: string, dir: number): string {
  if (kind === 'week') return addDaysYmd(anchor, 7 * dir);
  if (kind === 'month') return addMonthsYmd(monthStart(anchor), dir);
  return addMonthsYmd(anchor.slice(0, 4) + '-01-01', 12 * dir);
}

export function rangeLabel(kind: PeriodKind, r: Range): string {
  if (kind === 'month') return monthTitle(r.from);
  if (kind === 'year') return r.from.slice(0, 4);
  return `${dateShort(r.from)} — ${dateShort(r.to)}`;
}

export function daysBetweenYmd(a: string, b: string): number {
  return Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / 86400000);
}

// ---------- Балансы и курсы ----------

export function balances(d: FinanceData): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of d.accounts) m.set(a.id, a.initial);
  const add = (id: string | undefined, v: number) => {
    if (id && m.has(id)) m.set(id, m.get(id)! + v);
  };
  for (const t of d.transactions) {
    if (t.type === 'expense') add(t.accountId, -t.amount);
    else if (t.type === 'income') add(t.accountId, t.amount);
    else {
      add(t.accountId, -t.amount);
      add(t.toAccountId, t.toAmount ?? t.amount);
    }
  }
  for (const [k, v] of m) m.set(k, r2(v));
  return m;
}

/** Итоги по валютам (без архивных счетов) */
export function totalsByCurrency(d: FinanceData, bal = balances(d)): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of d.accounts) {
    if (a.archived) continue;
    out[a.currency] = r2((out[a.currency] ?? 0) + (bal.get(a.id) ?? 0));
  }
  return out;
}

/** Пересчёт в основную валюту. null — курс не задан */
export function toMain(amount: number, cur: string, prefs: FinancePrefs): number | null {
  if (cur === prefs.mainCurrency) return amount;
  const r = prefs.rates[cur];
  return r && r > 0 ? amount * r : null;
}

/** То же, но без курса сумма берётся как есть (для бюджетов и аналитики) */
export const toMainLoose = (amount: number, cur: string, prefs: FinancePrefs) => toMain(amount, cur, prefs) ?? amount;

export function convertedTotal(totals: Record<string, number>, prefs: FinancePrefs): { total: number; missing: string[] } {
  let total = 0;
  const missing: string[] = [];
  for (const [cur, v] of Object.entries(totals)) {
    const m = toMain(v, cur, prefs);
    if (m === null) missing.push(cur);
    else total += m;
  }
  return { total: r2(total), missing };
}

export function accountMap(d: FinanceData): Map<string, Account> {
  return new Map(d.accounts.map((a) => [a.id, a]));
}
export function categoryMap(d: FinanceData): Map<string, Category> {
  return new Map(d.categories.map((c) => [c.id, c]));
}
export function sortedCategories(d: FinanceData, kind: CatKind): Category[] {
  return d.categories.filter((c) => c.kind === kind).sort((a, b) => a.order - b.order);
}
export function sortedAccounts(d: FinanceData, withArchived = false): Account[] {
  return d.accounts.filter((a) => withArchived || !a.archived).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));
}

export function txCurrency(d: FinanceData, t: Transaction, accs = accountMap(d)): string {
  return accs.get(t.accountId)?.currency ?? d.prefs.mainCurrency;
}

/** Сумма операции в основной валюте */
export function txMain(d: FinanceData, t: Transaction, accs = accountMap(d)): number {
  return toMainLoose(t.amount, txCurrency(d, t, accs), d.prefs);
}

export function sortTx(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ta = a.time ?? '', tb = b.time ?? '';
  if (ta !== tb) return ta < tb ? 1 : -1;
  return b.createdAt - a.createdAt;
}

// ---------- Сводки за период ----------

export interface PeriodSummary {
  income: number;
  expense: number;
  /** расходы/доходы по категориям (ключ '' — без категории) */
  byCat: Map<string, number>;
  incByCat: Map<string, number>;
  /** расходы по дням */
  byDay: Map<string, number>;
}

export function summarize(d: FinanceData, r: Range): PeriodSummary {
  const accs = accountMap(d);
  const s: PeriodSummary = { income: 0, expense: 0, byCat: new Map(), incByCat: new Map(), byDay: new Map() };
  for (const t of d.transactions) {
    if (t.date < r.from || t.date > r.to || t.type === 'transfer') continue;
    const v = txMain(d, t, accs);
    const k = t.categoryId ?? '';
    if (t.type === 'expense') {
      s.expense += v;
      s.byCat.set(k, (s.byCat.get(k) ?? 0) + v);
      s.byDay.set(t.date, (s.byDay.get(t.date) ?? 0) + v);
    } else {
      s.income += v;
      s.incByCat.set(k, (s.incByCat.get(k) ?? 0) + v);
    }
  }
  s.income = r2(s.income);
  s.expense = r2(s.expense);
  return s;
}

// ---------- Бюджеты ----------

export type BudgetLevel = 'ok' | 'warn' | 'over';
export function budgetLevel(spent: number, limit: number): BudgetLevel {
  if (limit <= 0) return spent > 0 ? 'over' : 'ok';
  const p = spent / limit;
  return p > 1 ? 'over' : p >= 0.8 ? 'warn' : 'ok';
}

export const totalBudget = (d: FinanceData) => d.budgets.find((b) => !b.categoryId);
export const categoryBudget = (d: FinanceData, catId: string) => d.budgets.find((b) => b.categoryId === catId);

/** Сколько можно тратить в день до конца месяца (включая сегодня) */
export function perDayLeft(limit: number, spent: number, today: string, month: string): number | null {
  if (monthKey(today) !== monthKey(month)) return null;
  const left = daysInMonth(today) - fromYmd(today).getDate() + 1;
  return r2(Math.max(0, limit - spent) / Math.max(1, left));
}

// ---------- Подписки ----------

export function advanceSub(s: Pick<Subscription, 'period' | 'every' | 'anchorDay'>, ymd: string): string {
  const n = Math.max(1, s.every || 1);
  if (s.period === 'week') return addDaysYmd(ymd, 7 * n);
  if (s.period === 'year') return addMonthsYmd(ymd, 12 * n, s.anchorDay);
  return addMonthsYmd(ymd, n, s.anchorDay);
}

export function periodText(s: Pick<Subscription, 'period' | 'every'>): string {
  const n = Math.max(1, s.every || 1);
  if (s.period === 'week') return n === 1 ? 'каждую неделю' : `каждые ${n} нед.`;
  if (s.period === 'year') return n === 1 ? 'каждый год' : `каждые ${n} г.`;
  return n === 1 ? 'каждый месяц' : `каждые ${n} мес.`;
}

/** Стоимость подписки в месяц (в её валюте) */
export function subMonthly(s: Subscription): number {
  const n = Math.max(1, s.every || 1);
  if (s.period === 'week') return (s.amount * 52) / 12 / n;
  if (s.period === 'year') return s.amount / 12 / n;
  return s.amount / n;
}

export interface UpcomingPayment {
  /** уникален для каждого платежа: `${subscriptionId}@${date}` */
  id: string;
  subscriptionId: string;
  title: string;
  date: string;
  amount: number;
  currency: string;
  /** напомнить за N дней (меньше 0 — не напоминать) */
  remindDays: number;
}

/** Предстоящие платежи активных подписок в диапазоне дат (включительно) */
export function upcomingPayments(data: FinanceData, fromYmd: string, toYmdArg: string): UpcomingPayment[] {
  const accs = accountMap(data);
  const out: UpcomingPayment[] = [];
  for (const s of data.subscriptions) {
    if (!s.active || !s.nextDate) continue;
    const currency = accs.get(s.accountId)?.currency ?? data.prefs.mainCurrency;
    let date = s.nextDate;
    for (let i = 0; i < 500 && date <= toYmdArg; i++) {
      if (date >= fromYmd) out.push({ id: `${s.id}@${date}`, subscriptionId: s.id, title: s.name, date, amount: s.amount, currency, remindDays: s.remindDays });
      date = advanceSub(s, date);
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title, 'ru')));
}

// ---------- Долги ----------

export const debtPaid = (x: Debt) => r2(x.payments.reduce((a, p) => a + p.amount, 0));
export const debtLeft = (x: Debt) => r2(Math.max(0, x.amount - debtPaid(x)));

/** Итоги открытых долгов по валютам */
export function debtTotals(d: FinanceData): { owe: Record<string, number>; lent: Record<string, number> } {
  const owe: Record<string, number> = {};
  const lent: Record<string, number> = {};
  for (const x of d.debts) {
    if (x.closed) continue;
    const t = x.kind === 'owe' ? owe : lent;
    t[x.currency] = r2((t[x.currency] ?? 0) + debtLeft(x));
  }
  return { owe, lent };
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
