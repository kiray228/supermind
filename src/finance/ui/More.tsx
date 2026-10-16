import { useEffect, useMemo, useState } from 'react';
import { onBack } from '../../ui/dialogs';
import { CaretLeft, DownloadSimple, FileArrowUp, HandCoins, Repeat, SlidersHorizontal, Tag, Wallet, type Icon } from '@phosphor-icons/react';
import { IconTile, type Tone } from '../../ui/icons';
import { todayYmd } from '../../utils/mapTasks';
import { downloadText } from '../../io/download';
import { toast } from '../../store/appStore';
import { curSymbol, debtTotals, fmtMoney, parseMoneyInput, type FinanceData } from '../model';
import { exportCsv } from '../csv';
import { refreshRates, setFinancePrefs, useFinance } from '../store';
import { autoRatesOn, RATES_SOURCE, usedCurrencies } from '../rates';
import { ListRow, ListSection, SwitchRow } from '../../ui/list';
import { AccountsSection, CategoriesSection } from './Accounts';
import { SubscriptionsSection } from './Recurring';
import { ImportCsvSheet } from './ImportCsv';
import { AmountInput, CurrencySelect } from './common';
import { setFinTab, useFinUi } from './state';

const SECTIONS: Record<string, string> = {
  accounts: 'Счета',
  categories: 'Категории',
  subs: 'Подписки и регулярные платежи',
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
            <CaretLeft weight="bold" />
          </button>
          <h2 className="grow ellipsis">{SECTIONS[section]}</h2>
        </div>
        {section === 'accounts' && <AccountsSection data={data} />}
        {section === 'categories' && <CategoriesSection data={data} />}
        {section === 'subs' && <SubscriptionsSection data={data} />}
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
      <div className="ls-group">
        <MenuRow icon={Wallet} tone="teal" title="Счета" sub={`${data.accounts.filter((a) => !a.archived).length} активных`} onClick={() => open('accounts')} />
        <MenuRow icon={Tag} tone="orange" title="Категории" sub={`${data.categories.length} категорий`} onClick={() => open('categories')} />
        <MenuRow icon={Repeat} tone="indigo" title="Подписки и регулярные платежи" sub={activeSubs ? `${activeSubs} активных` : 'Netflix, аренда, кредит…'} onClick={() => open('subs')} />
        <MenuRow
          icon={HandCoins} tone="green"
          title="Долги"
          sub={openDebts ? `${openDebts} открытых` + (Object.keys(dt.owe).length ? ' · я должен ' + Object.entries(dt.owe).map(([c, v]) => fmtMoney(v, c, { compact: true })).join(', ') : '') : '«Я должен» и «Мне должны»'}
          onClick={() => setFinTab('debts')}
        />
      </div>
      <div className="ls-group">
        <MenuRow icon={FileArrowUp} tone="blue" title="Импорт из CSV" sub="Выписка из банка" onClick={() => setImporting(true)} />
        <MenuRow icon={DownloadSimple} tone="cyan" title="Экспорт в CSV" sub="Все операции — для Excel и Google Таблиц" onClick={exportAll} />
        <MenuRow icon={SlidersHorizontal} tone="gray" title="Валюты и курсы" sub={`Основная: ${data.prefs.mainCurrency}`} onClick={() => open('settings')} />
      </div>
      <p className="tiny faint fn-pad">Данные финансов хранятся на устройстве и синхронизируются с вашим аккаунтом SuperMind, если он подключён.</p>
      {importing && <ImportCsvSheet data={data} onClose={() => setImporting(false)} />}
    </div>
  );
}

function MenuRow({ icon, tone, title, sub, onClick }: { icon: Icon; tone: Tone; title: string; sub?: string; onClick: () => void }) {
  return <ListRow icon={<IconTile icon={icon} tone={tone} size="list" />} title={title} subtitle={sub} chevron onClick={onClick} />;
}

function SettingsSection({ data }: { data: FinanceData }) {
  const main = data.prefs.mainCurrency;
  // валюты, которые встречаются в счетах и долгах
  const used = useMemo(() => usedCurrencies(data), [data]);
  const auto = autoRatesOn(data.prefs);
  const [busy, setBusy] = useState(false);
  const update = async () => {
    setBusy(true);
    const ok = await refreshRates(true);
    setBusy(false);
    toast(ok ? 'Курсы обновлены' : navigator.onLine === false ? 'Нет интернета — остались прежние курсы' : 'Не удалось получить курсы');
  };
  const setAuto = (v: boolean) => {
    setFinancePrefs({ autoRates: v });
    if (v) void update();
  };

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
    if (auto) void refreshRates(true);
  };

  return (
    <div className="fn-stack">
      <div className="card fn-panel">
        <label className="label fn-m0">Основная валюта</label>
        <CurrencySelect value={main} onChange={changeMain} />
        <p className="tiny faint fn-m0">В ней считаются бюджеты, аналитика и общий итог. Валюта каждого счёта задаётся в его настройках.</p>
      </div>
      <ListSection
        footer={
          auto ? (
            <>
              Раз в день, когда открываете финансы. {data.prefs.ratesAt ? `Обновлено ${ratesTime(data.prefs.ratesAt)}. ` : ''}
              Источник —{' '}
              <a href={RATES_SOURCE} target="_blank" rel="noreferrer">
                ExchangeRate-API
              </a>
              .
            </>
          ) : (
            'Курсы вводятся вручную ниже.'
          )
        }
      >
        <SwitchRow title="Курсы автоматически" subtitle="Из интернета, по курсу на сегодня" checked={auto} onChange={setAuto} />
        {auto && <ListRow title={busy ? 'Обновляю…' : 'Обновить сейчас'} tone="accent" onClick={() => void update()} disabled={busy} />}
      </ListSection>
      <div className="card fn-panel">
        <h3 className="fn-h3">Курсы валют</h3>
        <p className="tiny faint fn-m0">
          {auto ? `Сколько стоит 1 единица валюты в ${curSymbol(main)}.` : `Укажите вручную, сколько стоит 1 единица валюты в ${curSymbol(main)}.`} Без курса суммы в другой валюте в итоги не пересчитываются.
        </p>
        {used.length === 0 && <p className="small muted fn-m0">Все счета в основной валюте — курсы не нужны.</p>}
        {used.map((c) =>
          auto ? (
            <div key={c + main} className="row fn-rate">
              <span className="fn-rate-label">1 {curSymbol(c)} =</span>
              <span className="fn-rate-auto">{data.prefs.rates[c] ? String(data.prefs.rates[c]).replace('.', ',') : '—'}</span>
              <span className="fn-rate-label">{curSymbol(main)}</span>
            </div>
          ) : (
            <RateRow key={c + main} code={c} main={main} value={data.prefs.rates[c]} />
          ),
        )}
      </div>
    </div>
  );
}

/** «сегодня в 12:25», «вчера в 09:10», «12.10 в 09:10» */
function ratesTime(at: number): string {
  const d = new Date(at);
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const day = new Date(d).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  if (day === today) return `сегодня в ${hm}`;
  if (today - day === 86400000) return `вчера в ${hm}`;
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} в ${hm}`;
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
