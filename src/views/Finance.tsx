import { useEffect } from 'react';
import { ChartLineUp, DotsThree, Plus } from '@phosphor-icons/react';
import { ensureFinance, useFinance } from '../finance/store';
import { Overview } from '../finance/ui/Overview';
import { Operations } from '../finance/ui/Operations';
import { BudgetTab } from '../finance/ui/BudgetTab';
import { Analytics } from '../finance/ui/Analytics';
import { More } from '../finance/ui/More';
import { TxSheet } from '../finance/ui/TxSheet';
import { DebtSheets, DebtsTab } from '../finance/ui/Debts';
import { openDebt, openTxSheet, setFinTab, useFinUi, type FinTab } from '../finance/ui/state';
import { toast } from '../store/appStore';
import './finance.css';
import { IconTile } from '../ui/icons';

/** Сегменты в шапке; «Аналитика» и «Ещё» — круглые кнопки справа, как в приложениях Apple */
const TABS: [FinTab, string][] = [
  ['overview', 'Обзор'],
  ['ops', 'Операции'],
  ['budget', 'Бюджет'],
  ['debts', 'Долги'],
];

/** Раздел «Финансы»: счета, операции, бюджеты, долги, подписки, аналитика */
export default function Finance() {
  const data = useFinance((s) => s.data);
  const tab = useFinUi((s) => s.tab);
  const moreSection = useFinUi((s) => s.more);

  useEffect(() => {
    ensureFinance().catch(() => toast('Не удалось загрузить финансы'));
  }, []);

  const add = () => (tab === 'debts' ? openDebt({ kind: 'lent' }) : openTxSheet());

  return (
    <div className="page fn-page">
      <div className="page-header fn-header">
        <IconTile section="finance" size="sm" className="ph-tile" />
        <h1>Финансы</h1>
        <div className="grow" />
        <div className="segmented fn-tabs" role="tablist">
          {TABS.map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setFinTab(t)}>
              {l}
            </button>
          ))}
        </div>
        <button className={'icon-btn' + (tab === 'analytics' ? ' active' : '')} onClick={() => setFinTab('analytics')} aria-label="Аналитика" title="Аналитика">
          <ChartLineUp weight="bold" />
        </button>
        <button className={'icon-btn' + (tab === 'more' ? ' active' : '')} onClick={() => setFinTab('more')} aria-label="Ещё: счета, категории, подписки" title="Счета, категории, подписки">
          <DotsThree weight="bold" />
        </button>
      </div>
      <div className="page-body fn-body">
        {!data ? (
          <div className="empty">Загрузка…</div>
        ) : (
          <div className="fn-wrap-page" key={tab}>
            {(tab === 'analytics' || (tab === 'more' && !moreSection)) && <h2 className="fn-page-title">{tab === 'analytics' ? 'Аналитика' : 'Счета и настройки'}</h2>}
            {tab === 'overview' && <Overview data={data} />}
            {tab === 'ops' && <Operations data={data} />}
            {tab === 'budget' && <BudgetTab data={data} />}
            {tab === 'debts' && <DebtsTab data={data} />}
            {tab === 'analytics' && <Analytics data={data} />}
            {tab === 'more' && <More data={data} />}
          </div>
        )}
      </div>
      {data && (
        <button className="fn-fab" onClick={add} aria-label={tab === 'debts' ? 'Новый долг' : 'Новая операция'} title={tab === 'debts' ? 'Новый долг' : 'Новая операция'}>
          <Plus size={26} weight="bold" />
        </button>
      )}
      {data && <TxSheet data={data} />}
      {data && <DebtSheets data={data} />}
    </div>
  );
}
