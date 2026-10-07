import { create } from 'zustand';
import type { Transaction, TxType } from '../model';
import type { TxDraft } from '../store';

export type FinTab = 'overview' | 'ops' | 'budget' | 'debts' | 'analytics' | 'more';
export type OpsPeriod = 'all' | 'month' | 'prev' | 'year' | 'custom';

export interface OpsFilter {
  q: string;
  type: 'all' | TxType;
  accountId: string;
  categoryId: string;
  period: OpsPeriod;
  from: string;
  to: string;
}

export const DEFAULT_FILTER: OpsFilter = { q: '', type: 'all', accountId: '', categoryId: '', period: 'all', from: '', to: '' };

interface FinUi {
  tab: FinTab;
  /** окно операции: tx — правка, preset — новая с заполненными полями */
  sheet: { tx?: Transaction; preset?: Partial<TxDraft> } | null;
  filter: OpsFilter;
  /** раздел внутри «Ещё» */
  more: string;
  /** окно долга: id — открыть карточку, kind — новый долг */
  debt: { id?: string; kind?: 'owe' | 'lent'; edit?: boolean } | null;
}

const TAB_KEY = 'sm-fin-tab';
const TABS: FinTab[] = ['overview', 'ops', 'budget', 'debts', 'analytics', 'more'];

function readTab(): FinTab {
  try {
    const t = localStorage.getItem(TAB_KEY) as FinTab | null;
    return t && TABS.includes(t) ? t : 'overview';
  } catch {
    return 'overview';
  }
}

export const useFinUi = create<FinUi>(() => ({ tab: readTab(), sheet: null, filter: DEFAULT_FILTER, more: '', debt: null }));

export function setFinTab(tab: FinTab) {
  useFinUi.setState({ tab, ...(tab === 'more' ? { more: '' } : {}) });
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* без сохранения */
  }
}

export function openTxSheet(opts: { tx?: Transaction; preset?: Partial<TxDraft> } = {}) {
  useFinUi.setState({ sheet: opts });
}
export function closeTxSheet() {
  useFinUi.setState({ sheet: null });
}

/** Перейти к операциям с фильтром */
export function showOps(patch: Partial<OpsFilter>) {
  useFinUi.setState({ filter: { ...DEFAULT_FILTER, ...patch } });
  setFinTab('ops');
}

export function setFilter(patch: Partial<OpsFilter>) {
  useFinUi.setState((s) => ({ filter: { ...s.filter, ...patch } }));
}

export function openMore(section: string) {
  setFinTab('more');
  useFinUi.setState({ more: section });
}

/** Долги: новый (kind) или карточка существующего (id) */
export function openDebt(opts: { id?: string; kind?: 'owe' | 'lent'; edit?: boolean }) {
  useFinUi.setState({ debt: opts });
}
export function closeDebt() {
  useFinUi.setState({ debt: null });
}
