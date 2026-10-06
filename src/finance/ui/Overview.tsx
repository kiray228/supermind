import { useMemo, type CSSProperties } from 'react';
import { CalendarClock, ChevronRight, Plus, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { addDaysYmd } from '../../utils/mapTasks';
import {
  accountMap,
  balances,
  categoryMap,
  convertedTotal,
  curSymbol,
  fmtMoney,
  monthEnd,
  monthStart,
  monthTitle,
  perDayLeft,
  sortedAccounts,
  sortTx,
  summarize,
  totalBudget,
  totalsByCurrency,
  upcomingPayments,
  type FinanceData,
} from '../model';
import { paySubscription } from '../store';
import { CurTotals, dayTitle, Money, Progress, TxRow, useToday } from './common';
import { openMore, openTxSheet, setFinTab, showOps } from './state';

export function Overview({ data }: { data: FinanceData }) {
  const today = useToday();
  const main = data.prefs.mainCurrency;
  const bal = useMemo(() => balances(data), [data]);
  const totals = useMemo(() => totalsByCurrency(data, bal), [data, bal]);
  const conv = convertedTotal(totals, data.prefs);
  const multi = Object.keys(totals).length > 1;
  const month = useMemo(() => summarize(data, { from: monthStart(today), to: monthEnd(today) }), [data, today]);
  const accs = useMemo(() => accountMap(data), [data]);
  const cats = useMemo(() => categoryMap(data), [data]);
  const recent = useMemo(() => [...data.transactions].sort(sortTx).slice(0, 8), [data.transactions]);
  const upcoming = useMemo(() => upcomingPayments(data, '0000-01-01', addDaysYmd(today, 14)).slice(0, 8), [data, today]);
  const tb = totalBudget(data);
  const catBudgets = data.budgets.filter((b) => b.categoryId && cats.has(b.categoryId));
  const accounts = sortedAccounts(data);

  return (
    <div className="fn-stack">
      <section className="card fn-hero">
        <div className="fn-hero-label">
          <Wallet size={16} /> Всего на счетах
        </div>
        <div className="fn-hero-total">
          {multi && conv.missing.length === 0 ? <Money v={conv.total} cur={main} /> : <CurTotals totals={totals} />}
        </div>
        {multi && conv.missing.length === 0 && <CurTotals totals={totals} className="fn-hero-sub" />}
        {multi && conv.missing.length > 0 && (
          <button className="fn-link tiny" onClick={() => openMore('settings')}>
            Укажите курсы валют, чтобы видеть общий итог в {curSymbol(main)}
          </button>
        )}
        <div className="fn-acc-scroll">
          {accounts.map((a) => (
            <button key={a.id} className="fn-acc-card" style={{ '--c': a.color } as CSSProperties} onClick={() => showOps({ accountId: a.id })}>
              <span className="fn-acc-card-top">
                <span>{a.emoji}</span>
                <span className="ellipsis">{a.name}</span>
              </span>
              <Money v={bal.get(a.id) ?? 0} cur={a.currency} className={(bal.get(a.id) ?? 0) < 0 ? 'is-neg' : ''} />
            </button>
          ))}
          <button className="fn-acc-card fn-acc-add" onClick={() => openMore('accounts')}>
            <Plus size={18} />
            <span className="tiny">Счёт</span>
          </button>
        </div>
      </section>

      <section className="card fn-panel">
        <div className="fn-panel-head">
          <h3>{monthTitle(today)}</h3>
          <button className="fn-link small" onClick={() => setFinTab('analytics')}>
            Аналитика <ChevronRight size={14} />
          </button>
        </div>
        <div className="fn-month3">
          <div className="fn-kpi is-income">
            <span className="fn-kpi-label">
              <TrendingUp size={14} /> Доходы
            </span>
            <Money v={month.income} cur={main} compact />
          </div>
          <div className="fn-kpi is-expense">
            <span className="fn-kpi-label">
              <TrendingDown size={14} /> Расходы
            </span>
            <Money v={month.expense} cur={main} compact />
          </div>
          <div className="fn-kpi">
            <span className="fn-kpi-label">Итого</span>
            <Money v={month.income - month.expense} cur={main} sign compact className={month.income - month.expense < 0 ? 'is-neg' : 'is-pos'} />
          </div>
        </div>
      </section>

      <section className="card fn-panel">
        <div className="fn-panel-head">
          <h3>Бюджет</h3>
          <button className="fn-link small" onClick={() => setFinTab('budget')}>
            {tb || catBudgets.length ? 'Подробнее' : 'Настроить'} <ChevronRight size={14} />
          </button>
        </div>
        {tb ? (
          <div className="fn-budget-main">
            <div className="row fn-budget-line">
              <span className="grow">
                <Money v={month.expense} cur={main} /> <span className="faint">из {fmtMoney(tb.limit, main)}</span>
              </span>
              <span className={'small ' + (tb.limit - month.expense < 0 ? 'fn-neg' : 'muted')}>
                {tb.limit - month.expense < 0 ? 'Перерасход ' + fmtMoney(month.expense - tb.limit, main) : 'Осталось ' + fmtMoney(tb.limit - month.expense, main)}
              </span>
            </div>
            <Progress spent={month.expense} limit={tb.limit} />
            {tb.limit > month.expense && <div className="small muted">Можно тратить {fmtMoney(perDayLeft(tb.limit, month.expense, today, today) ?? 0, main)} в день</div>}
          </div>
        ) : (
          !catBudgets.length && <p className="small muted fn-m0">Задайте лимит на месяц — приложение подскажет, сколько можно тратить в день.</p>
        )}
        {catBudgets.slice(0, 4).map((b) => {
          const c = cats.get(b.categoryId!)!;
          const spent = month.byCat.get(c.id) ?? 0;
          return (
            <div key={b.id} className="fn-mini-budget">
              <div className="row small">
                <span>{c.emoji}</span>
                <span className="grow ellipsis">{c.name}</span>
                <span className="muted">
                  {fmtMoney(spent, main, { compact: true })} / {fmtMoney(b.limit, main, { compact: true })}
                </span>
              </div>
              <Progress spent={spent} limit={b.limit} thin />
            </div>
          );
        })}
      </section>

      {upcoming.length > 0 && (
        <section className="card fn-panel">
          <div className="fn-panel-head">
            <h3>Ближайшие платежи</h3>
            <button className="fn-link small" onClick={() => openMore('subs')}>
              Все <ChevronRight size={14} />
            </button>
          </div>
          <div className="fn-list">
            {upcoming.map((p) => (
              <div key={p.id} className="fn-upcoming">
                <CalendarClock size={18} className={p.date < today ? 'fn-neg' : 'fn-accent'} />
                <span className="grow fn-tx-main">
                  <span className="ellipsis fn-tx-title">{p.title}</span>
                  <span className={'tiny ' + (p.date < today ? 'fn-neg' : 'faint')}>{p.date < today ? 'просрочен · ' + dayTitle(p.date) : dayTitle(p.date)}</span>
                </span>
                <Money v={p.amount} cur={p.currency} className="small" />
                <button className="btn btn-sm" onClick={() => paySubscription(p.subscriptionId)}>
                  Оплачено
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card fn-panel">
        <div className="fn-panel-head">
          <h3>Последние операции</h3>
          {recent.length > 0 && (
            <button className="fn-link small" onClick={() => showOps({})}>
              Все <ChevronRight size={14} />
            </button>
          )}
        </div>
        {recent.length ? (
          <div className="fn-list">
            {recent.map((t) => (
              <TxRow key={t.id} tx={t} accs={accs} cats={cats} showDate onClick={() => openTxSheet({ tx: t })} />
            ))}
          </div>
        ) : (
          <div className="fn-empty-inline">
            <p className="muted small fn-m0">Операций пока нет. Нажмите «+», чтобы добавить первый расход или доход.</p>
            <button className="btn btn-primary btn-sm" onClick={() => openTxSheet()}>
              <Plus size={15} /> Добавить
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
