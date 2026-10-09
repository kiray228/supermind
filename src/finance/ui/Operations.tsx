import { useMemo, useState } from 'react';
import { DownloadSimple, FunnelSimple, MagnifyingGlass, X } from '@phosphor-icons/react';
import { todayYmd } from '../../utils/mapTasks';
import { downloadText } from '../../io/download';
import { toast } from '../../store/appStore';
import {
  accountMap,
  addMonthsYmd,
  categoryMap,
  fmtMoney,
  monthEnd,
  monthStart,
  r2,
  sortedAccounts,
  sortedCategories,
  sortTx,
  txMain,
  type FinanceData,
  type Range,
  type Transaction,
} from '../model';
import { exportCsv } from '../csv';
import { dayTitle, Sheet, TxRow } from './common';
import { DEFAULT_FILTER, openTxSheet, setFilter, useFinUi, type OpsFilter } from './state';

const PAGE = 150;

export function filterRange(f: OpsFilter, today = todayYmd()): Range | null {
  switch (f.period) {
    case 'month':
      return { from: monthStart(today), to: monthEnd(today) };
    case 'prev': {
      const p = addMonthsYmd(monthStart(today), -1);
      return { from: p, to: monthEnd(p) };
    }
    case 'year':
      return { from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31' };
    case 'custom':
      return { from: f.from || '0000-01-01', to: f.to || '9999-12-31' };
    default:
      return null;
  }
}

export function applyFilter(d: FinanceData, f: OpsFilter): Transaction[] {
  const r = filterRange(f);
  const q = f.q.trim().toLowerCase();
  const cats = categoryMap(d);
  const accs = accountMap(d);
  return d.transactions
    .filter((t) => {
      if (f.type !== 'all' && t.type !== f.type) return false;
      if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
      if (f.categoryId && (f.categoryId === '-' ? !!t.categoryId || t.type === 'transfer' : t.categoryId !== f.categoryId)) return false;
      if (r && (t.date < r.from || t.date > r.to)) return false;
      if (q) {
        const hay = [t.note, t.categoryId ? cats.get(t.categoryId)?.name : '', accs.get(t.accountId)?.name, t.tags.join(' '), String(t.amount)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort(sortTx);
}

export function Operations({ data }: { data: FinanceData }) {
  const f = useFinUi((s) => s.filter);
  const [limit, setLimit] = useState(PAGE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const accs = useMemo(() => accountMap(data), [data]);
  const cats = useMemo(() => categoryMap(data), [data]);
  const list = useMemo(() => applyFilter(data, f), [data, f]);
  const main = data.prefs.mainCurrency;

  const totals = useMemo(() => {
    let inc = 0, exp = 0;
    for (const t of list) {
      if (t.type === 'income') inc += txMain(data, t, accs);
      else if (t.type === 'expense') exp += txMain(data, t, accs);
    }
    return { inc: r2(inc), exp: r2(exp) };
  }, [list, data, accs]);

  const groups = useMemo(() => {
    const out: { date: string; items: Transaction[]; inc: number; exp: number }[] = [];
    for (const t of list.slice(0, limit)) {
      let g = out[out.length - 1];
      if (!g || g.date !== t.date) out.push((g = { date: t.date, items: [], inc: 0, exp: 0 }));
      g.items.push(t);
      if (t.type === 'income') g.inc += txMain(data, t, accs);
      else if (t.type === 'expense') g.exp += txMain(data, t, accs);
    }
    return out;
  }, [list, limit, data, accs]);

  const filtered = JSON.stringify({ ...f, q: '' }) !== JSON.stringify({ ...DEFAULT_FILTER, q: '' });
  // счёт, категория и период — в окне «Фильтры», на экране только их число
  const nFilters = (f.accountId ? 1 : 0) + (f.categoryId ? 1 : 0) + (f.period !== 'all' ? 1 : 0);

  const exportList = () => {
    if (!list.length) return toast('Нет операций для выгрузки');
    void downloadText(exportCsv(data, list), `Финансы ${todayYmd()}.csv`, 'text/csv').catch(() => toast('Не удалось сохранить файл'));
  };

  return (
    <div className="fn-stack fn-ops">
      <div className="fn-ops-bar">
        <div className="fn-search">
          <MagnifyingGlass size={16} />
          <input className="input" placeholder="Поиск по операциям" value={f.q} onChange={(e) => setFilter({ q: e.target.value })} />
          {f.q && (
            <button className="fn-search-x" onClick={() => setFilter({ q: '' })} aria-label="Очистить">
              <X size={15} />
            </button>
          )}
        </div>
        <button className="icon-btn" onClick={exportList} title="Выгрузить в CSV" aria-label="Выгрузить в CSV">
          <DownloadSimple />
        </button>
      </div>
      <div className="segmented fn-seg-wide">
        {(
          [
            ['all', 'Все'],
            ['expense', 'Расходы'],
            ['income', 'Доходы'],
            ['transfer', 'Переводы'],
          ] as const
        ).map(([v, l]) => (
          <button key={v} className={f.type === v ? 'active' : ''} onClick={() => setFilter({ type: v })}>
            {l}
          </button>
        ))}
      </div>
      <div className="fn-ops-sum small">
        <button className={'chip fn-filter-chip' + (nFilters ? ' active' : '')} onClick={() => setFiltersOpen(true)}>
          <FunnelSimple size={15} weight={nFilters ? 'fill' : 'bold'} />
          Фильтры{nFilters ? ` (${nFilters})` : ''}
        </button>
        <span className="muted">
          {list.length} опер.
        </span>
        {totals.inc > 0 && <span className="fn-pos">+{fmtMoney(totals.inc, main)}</span>}
        {totals.exp > 0 && <span className="fn-neg">−{fmtMoney(totals.exp, main)}</span>}
        <span className="grow" />
        {(filtered || f.q) && (
          <button className="fn-link small" onClick={() => useFinUi.setState({ filter: DEFAULT_FILTER })}>
            Сбросить
          </button>
        )}
      </div>
      {filtersOpen && <FiltersSheet data={data} f={f} onClose={() => setFiltersOpen(false)} />}

      {!list.length ? (
        <div className="empty">{data.transactions.length ? 'Ничего не найдено' : 'Операций пока нет. Нажмите «+», чтобы добавить.'}</div>
      ) : (
        groups.map((g) => (
          <section key={g.date} className="fn-day">
            <div className="fn-day-head">
              <span className="grow">{dayTitle(g.date)}</span>
              {g.inc > 0 && <span className="fn-pos">+{fmtMoney(g.inc, main)}</span>}
              {g.exp > 0 && <span className="muted">−{fmtMoney(g.exp, main)}</span>}
            </div>
            <div className="card fn-list fn-day-list">
              {g.items.map((t) => (
                <TxRow key={t.id} tx={t} accs={accs} cats={cats} onClick={() => openTxSheet({ tx: t })} />
              ))}
            </div>
          </section>
        ))
      )}
      {list.length > limit && (
        <button className="btn fn-more-btn" onClick={() => setLimit(limit + PAGE)}>
          Показать ещё
        </button>
      )}
    </div>
  );
}

/** Окно фильтров: счёт, категория, период — применяются сразу */
function FiltersSheet({ data, f, onClose }: { data: FinanceData; f: OpsFilter; onClose: () => void }) {
  const catOptions = [...sortedCategories(data, 'expense'), ...sortedCategories(data, 'income')];
  return (
    <Sheet
      title="Фильтры"
      onClose={onClose}
      className="fn-filter-sheet"
      actions={
        <>
          <button className="btn" onClick={() => setFilter({ accountId: '', categoryId: '', period: 'all', from: '', to: '' })}>
            Сбросить
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </>
      }
    >
      <label className="label">Счёт</label>
      <select className="select" value={f.accountId} onChange={(e) => setFilter({ accountId: e.target.value })}>
        <option value="">Все счета</option>
        {sortedAccounts(data, true).map((a) => (
          <option key={a.id} value={a.id}>
            {a.emoji} {a.name}
          </option>
        ))}
      </select>
      <label className="label">Категория</label>
      <select className="select" value={f.categoryId} onChange={(e) => setFilter({ categoryId: e.target.value })}>
        <option value="">Все категории</option>
        <option value="-">Без категории</option>
        {catOptions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.emoji} {c.name}
            {c.kind === 'income' ? ' (доход)' : ''}
          </option>
        ))}
      </select>
      <label className="label">Период</label>
      <select className="select" value={f.period} onChange={(e) => setFilter({ period: e.target.value as OpsFilter['period'] })}>
        <option value="all">За всё время</option>
        <option value="month">Этот месяц</option>
        <option value="prev">Прошлый месяц</option>
        <option value="year">Этот год</option>
        <option value="custom">Свой период…</option>
      </select>
      {f.period === 'custom' && (
        <div className="fn-filter-dates">
          <input type="date" className="input" value={f.from} onChange={(e) => setFilter({ from: e.target.value })} aria-label="С" />
          <span className="faint">—</span>
          <input type="date" className="input" value={f.to} onChange={(e) => setFilter({ to: e.target.value })} aria-label="По" />
        </div>
      )}
    </Sheet>
  );
}
