import { useEffect } from 'react';
import { Plus } from 'lucide-react';
import { ensureFinance, useFinance } from '../finance/store';
import { Overview } from '../finance/ui/Overview';
import { Operations } from '../finance/ui/Operations';
import { BudgetTab } from '../finance/ui/BudgetTab';
import { Analytics } from '../finance/ui/Analytics';
import { More } from '../finance/ui/More';
import { TxSheet } from '../finance/ui/TxSheet';
import { openTxSheet, setFinTab, useFinUi, type FinTab } from '../finance/ui/state';
import { toast } from '../store/appStore';
import './finance.css';

const TABS: [FinTab, string][] = [
  ['overview', 'Обзор'],
  ['ops', 'Операции'],
  ['budget', 'Бюджет'],
  ['analytics', 'Аналитика'],
  ['more', 'Ещё'],
];

/** Раздел «Финансы»: счета, операции, бюджеты, подписки, долги, аналитика */
export default function Finance() {
  const data = useFinance((s) => s.data);
  const tab = useFinUi((s) => s.tab);

  useEffect(() => {
    ensureFinance().catch(() => toast('Не удалось загрузить финансы'));
  }, []);

  return (
    <div className="page fn-page">
      <div className="page-header fn-header">
        <h1>Финансы</h1>
        <div className="grow" />
        <div className="segmented fn-tabs" role="tablist">
          {TABS.map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setFinTab(t)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="page-body fn-body">
        {!data ? (
          <div className="empty">Загрузка…</div>
        ) : (
          <div className="fn-wrap-page" key={tab}>
            {tab === 'overview' && <Overview data={data} />}
            {tab === 'ops' && <Operations data={data} />}
            {tab === 'budget' && <BudgetTab data={data} />}
            {tab === 'analytics' && <Analytics data={data} />}
            {tab === 'more' && <More data={data} />}
          </div>
        )}
      </div>
      {data && (
        <button className="fn-fab" onClick={() => openTxSheet()} aria-label="Новая операция" title="Новая операция">
          <Plus size={26} />
        </button>
      )}
      {data && <TxSheet data={data} />}
    </div>
  );
}
