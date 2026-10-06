import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { onBack } from '../../ui/dialogs';
import { ChevronLeft, ChevronRight, Download, FileUp, HandCoins, Repeat, Settings2, Tags, Wallet } from 'lucide-react';
import { todayYmd } from '../../utils/mapTasks';
import { downloadText } from '../../io/download';
import { toast } from '../../store/appStore';
import { curSymbol, debtTotals, fmtMoney, parseMoneyInput, type FinanceData } from '../model';
import { exportCsv } from '../csv';
import { setFinancePrefs, useFinance } from '../store';
import { AccountsSection, CategoriesSection } from './Accounts';
import { DebtsSection, SubscriptionsSection } from './Recurring';
import { ImportCsvSheet } from './ImportCsv';
import { AmountInput, CurrencySelect } from './common';
import { useFinUi } from './state';

const SECTIONS: Record<string, string> = {
  accounts: 'Счета',
  categories: 'Категории',
  subs: 'Подписки и регулярные платежи',
  debts: 'Долги',
  settings: 'Валюты и курсы',
};

export function More({ data }: { data: FinanceData }) {
  const section = useFinUi((s) => s.more);
  const [importing, setImporting] = useState(false);
  const open = (more: string) => useFinUi.setState({ more });

  // кнопка «Назад» Android / Escape возвращает из подраздела в меню
  useEffect(() => {
    if (!section) return;
    return onBack(() => {
      useFinUi.setState({ more: '' });
      return true;
    });
  }, [section]);

  if (section && SECTIONS[section]) {
    return (
      <div className="fn-stack">
        <div className="row fn-sub-head">
          <button className="icon-btn" onClick={() => open('')} aria-label="Назад">
            <ChevronLeft />
          </button>
          <h2 className="grow ellipsis">{SECTIONS[section]}</h2>
        </div>
        {section === 'accounts' && <AccountsSection data={data} />}
        {section === 'categories' && <CategoriesSection data={data} />}
        {section === 'subs' && <SubscriptionsSection data={data} />}
        {section === 'debts' && <DebtsSection data={data} />}
        {section === 'settings' && <SettingsSection data={data} />}
      </div>
    );
  }

  const activeSubs = data.subscriptions.filter((s) => s.active).length;
  const dt = debtTotals(data);
  const openDebts = data.debts.filter((d) => !d.closed).length;

  const exportAll = () => {
    if (!data.transactions.length) return toast('Операций пока нет');
    void downloadText(exportCsv(data), `Финансы ${todayYmd()}.csv`, 'text/csv').catch(() => toast('Не удалось сохранить файл'));
  };

  return (
    <div className="fn-stack">
      <div className="card fn-list">
        <MenuRow icon={<Wallet />} title="Счета" sub={`${data.accounts.filter((a) => !a.archived).length} активных`} onClick={() => open('accounts')} />
        <MenuRow icon={<Tags />} title="Категории" sub={`${data.categories.length} категорий`} onClick={() => open('categories')} />
        <MenuRow icon={<Repeat />} title="Подписки и регулярные платежи" sub={activeSubs ? `${activeSubs} активных` : 'Netflix, аренда, кредит…'} onClick={() => open('subs')} />
        <MenuRow
          icon={<HandCoins />}
          title="Долги"
          sub={openDebts ? `${openDebts} открытых` + (Object.keys(dt.owe).length ? ' · я должен ' + Object.entries(dt.owe).map(([c, v]) => fmtMoney(v, c, { compact: true })).join(', ') : '') : '«Я должен» и «Мне должны»'}
          onClick={() => open('debts')}
        />
      </div>
      <div className="card fn-list">
        <MenuRow icon={<FileUp />} title="Импорт из CSV" sub="Выписка из банка" onClick={() => setImporting(true)} />
        <MenuRow icon={<Download />} title="Экспорт в CSV" sub="Все операции — для Excel и Google Таблиц" onClick={exportAll} />
        <MenuRow icon={<Settings2 />} title="Валюты и курсы" sub={`Основная: ${data.prefs.mainCurrency}`} onClick={() => open('settings')} />
      </div>
      <p className="tiny faint fn-pad">Данные финансов хранятся на устройстве и синхронизируются с вашим аккаунтом SuperMind, если он подключён.</p>
      {importing && <ImportCsvSheet data={data} onClose={() => setImporting(false)} />}
    </div>
  );
}

function MenuRow({ icon, title, sub, onClick }: { icon: ReactNode; title: string; sub?: string; onClick: () => void }) {
  return (
    <button className="fn-menu-row" onClick={onClick}>
      <span className="fn-menu-ic">{icon}</span>
      <span className="grow fn-tx-main">
        <span className="fn-tx-title ellipsis">{title}</span>
        {sub && <span className="fn-tx-sub ellipsis">{sub}</span>}
      </span>
      <ChevronRight size={18} className="faint" />
    </button>
  );
}

function SettingsSection({ data }: { data: FinanceData }) {
  const main = data.prefs.mainCurrency;
  // валюты, которые встречаются в счетах и долгах
  const used = useMemo(() => {
    const s = new Set<string>();
    for (const a of data.accounts) s.add(a.currency);
    for (const d of data.debts) s.add(d.currency);
    for (const c of Object.keys(data.prefs.rates)) s.add(c);
    s.delete(main);
    return [...s].sort();
  }, [data.accounts, data.debts, data.prefs.rates, main]);

  // курсы пересчитываются относительно новой основной валюты (если её курс известен)
  const changeMain = (v: string) => {
    const old = data.prefs.rates;
    const k = old[v];
    const rates: Record<string, number> = {};
    if (k > 0) {
      for (const [c, r] of Object.entries(old)) if (c !== v) rates[c] = Math.round((r / k) * 1e6) / 1e6;
      rates[main] = Math.round((1 / k) * 1e6) / 1e6;
    }
    setFinancePrefs({ mainCurrency: v, rates });
  };

  return (
    <div className="fn-stack">
      <div className="card fn-panel">
        <label className="label fn-m0">Основная валюта</label>
        <CurrencySelect value={main} onChange={changeMain} />
        <p className="tiny faint fn-m0">В ней считаются бюджеты, аналитика и общий итог. Валюта каждого счёта задаётся в его настройках.</p>
      </div>
      <div className="card fn-panel">
        <h3 className="fn-h3">Курсы валют</h3>
        <p className="tiny faint fn-m0">Укажите вручную, сколько стоит 1 единица валюты в {curSymbol(main)}. Без курса суммы в другой валюте в итоги не пересчитываются.</p>
        {used.length === 0 && <p className="small muted fn-m0">Все счета в основной валюте — курсы не нужны.</p>}
        {used.map((c) => (
          <RateRow key={c + main} code={c} main={main} value={data.prefs.rates[c]} />
        ))}
      </div>
    </div>
  );
}

function RateRow({ code, main, value }: { code: string; main: string; value?: number }) {
  const [v, setV] = useState(value ? String(value).replace('.', ',') : '');
  const commit = () => {
    const n = v.trim() ? parseMoneyInput(v) : 0;
    if (v.trim() && !(n > 0)) return toast('Проверьте курс');
    if ((n || undefined) === value) return;
    const rates = { ...(useFinance.getState().data?.prefs.rates ?? {}) };
    if (n > 0) rates[code] = n;
    else delete rates[code];
    setFinancePrefs({ rates });
    toast(n > 0 ? `Курс ${code} сохранён` : `Курс ${code} удалён`);
  };
  return (
    <div className="row fn-rate">
      <span className="fn-rate-label">1 {curSymbol(code)} =</span>
      <AmountInput value={v} onChange={setV} onEnter={commit} onBlur={commit} placeholder="курс" />
      <span className="fn-rate-label">{curSymbol(main)}</span>
    </div>
  );
}
