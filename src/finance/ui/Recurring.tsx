import { useMemo, useState } from 'react';
import { HandCoins, Plus, Repeat, Trash2 } from 'lucide-react';
import { uid } from '../../utils/tree';
import { fromYmd, todayYmd } from '../../utils/mapTasks';
import { toast } from '../../store/appStore';
import { confirmDialog } from '../../ui/dialogs';
import {
  accountMap,
  categoryMap,
  curSymbol,
  dateLong,
  dateShort,
  debtLeft,
  debtPaid,
  debtTotals,
  fmtMoney,
  parseMoneyInput,
  periodText,
  r2,
  sortedAccounts,
  sortedCategories,
  subMonthly,
  toMain,
  type Debt,
  type FinanceData,
  type SubPeriod,
  type Subscription,
} from '../model';
import { addDebtPayment, deleteDebt, deleteSubscription, paySubscription, removeDebtPayment, saveDebt, saveSubscription, skipSubscription } from '../store';
import { AmountInput, CatIcon, CurrencySelect, CurTotals, Money, Progress, Sheet, useToday } from './common';

// ================= Подписки и регулярные платежи =================

export function SubscriptionsSection({ data }: { data: FinanceData }) {
  const today = useToday();
  const [edit, setEdit] = useState<Subscription | 'new' | null>(null);
  const accs = useMemo(() => accountMap(data), [data]);
  const cats = useMemo(() => categoryMap(data), [data]);
  const list = [...data.subscriptions].sort((a, b) => Number(b.active) - Number(a.active) || (a.nextDate < b.nextDate ? -1 : 1));
  const main = data.prefs.mainCurrency;

  // стоимость в месяц: по валютам и общий итог
  const monthly: Record<string, number> = {};
  for (const s of data.subscriptions) {
    if (!s.active) continue;
    const c = accs.get(s.accountId)?.currency ?? main;
    monthly[c] = r2((monthly[c] ?? 0) + subMonthly(s));
  }
  let total = 0;
  let missing = false;
  for (const [c, v] of Object.entries(monthly)) {
    const m = toMain(v, c, data.prefs);
    if (m === null) missing = true;
    else total += m;
  }

  return (
    <div className="fn-stack">
      <div className="card fn-panel">
        <span className="tiny faint">Регулярные платежи в месяц</span>
        <div className="fn-budget-big">{Object.keys(monthly).length > 1 && !missing ? <Money v={total} cur={main} /> : <CurTotals totals={monthly} />}</div>
        {Object.keys(monthly).length > 1 && !missing && <CurTotals totals={monthly} className="small muted" />}
        <span className="tiny faint">≈ {fmtMoney(total * 12, main, { compact: true })} в год</span>
      </div>
      <div className="card fn-list">
        {list.map((s) => {
          const a = accs.get(s.accountId);
          const c = s.categoryId ? cats.get(s.categoryId) : undefined;
          const overdue = s.active && s.nextDate < today;
          return (
            <div key={s.id} className={'fn-item' + (s.active ? '' : ' is-archived')}>
              <button className="fn-item-main" onClick={() => setEdit(s)}>
                <CatIcon emoji={c?.emoji ?? '🔁'} color={c?.color ?? '#6366f1'} />
                <span className="grow fn-tx-main">
                  <span className="fn-tx-title ellipsis">{s.name}</span>
                  <span className={'fn-tx-sub ellipsis' + (overdue ? ' fn-neg' : '')}>
                    {s.active ? `${overdue ? 'просрочен: ' : 'след. '}${dateShort(s.nextDate)}` : 'приостановлен'} · {periodText(s)}
                  </span>
                </span>
                <Money v={s.amount} cur={a?.currency ?? main} className="small" />
              </button>
              {s.active && (
                <button className="btn btn-sm fn-pay-btn" onClick={() => paySubscription(s.id)}>
                  Оплачено
                </button>
              )}
            </div>
          );
        })}
        {!list.length && <p className="muted small fn-pad">Добавьте подписки, аренду, кредит, связь — приложение напомнит о платеже и посчитает, сколько уходит в месяц.</p>}
      </div>
      <button className="btn btn-primary fn-self-start" onClick={() => setEdit('new')}>
        <Plus size={16} /> Новый платёж
      </button>
      {edit && <SubSheet data={data} sub={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

type PeriodOpt = 'week' | 'month' | 'months' | 'year';

function SubSheet({ data, sub, onClose }: { data: FinanceData; sub: Subscription | null; onClose: () => void }) {
  const accounts = sortedAccounts(data, true);
  const [name, setName] = useState(sub?.name ?? '');
  const [amount, setAmount] = useState(sub ? String(sub.amount).replace('.', ',') : '');
  const [accountId, setAccountId] = useState(sub?.accountId ?? data.prefs.lastAccountId ?? accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(sub?.categoryId ?? (data.categories.some((c) => c.id === 'c-subs') ? 'c-subs' : ''));
  const [period, setPeriod] = useState<PeriodOpt>(sub ? (sub.period === 'month' && sub.every > 1 ? 'months' : sub.period) : 'month');
  const [every, setEvery] = useState(String(sub?.every ?? 3));
  const [nextDate, setNextDate] = useState(sub?.nextDate ?? todayYmd());
  const [remindDays, setRemindDays] = useState(sub?.remindDays ?? 1);
  const [active, setActive] = useState(sub?.active ?? true);
  const [note, setNote] = useState(sub?.note ?? '');
  const cur = accounts.find((a) => a.id === accountId)?.currency ?? data.prefs.mainCurrency;

  const save = () => {
    const v = parseMoneyInput(amount);
    if (!name.trim()) return toast('Введите название');
    if (!(v > 0)) return toast('Введите сумму');
    if (!accountId) return toast('Выберите счёт');
    if (!nextDate) return toast('Укажите дату платежа');
    const p: SubPeriod = period === 'months' ? 'month' : period;
    const n = period === 'months' ? Math.max(1, Math.round(Number(every) || 1)) : 1;
    // день месяца сохраняем, чтобы 31-е не «сползало» после коротких месяцев
    const anchorDay = p === 'week' ? undefined : fromYmd(nextDate).getDate();
    saveSubscription({
      id: sub?.id ?? uid(),
      name: name.trim(),
      amount: v,
      accountId,
      categoryId: categoryId || undefined,
      period: p,
      every: n,
      nextDate,
      anchorDay,
      active,
      remindDays,
      note: note.trim() || undefined,
    });
    onClose();
  };

  const remove = async () => {
    if (!sub) return;
    if (!(await confirmDialog(`Удалить «${sub.name}»?`, 'Уже записанные платежи останутся в операциях.', { okText: 'Удалить', danger: true }))) return;
    deleteSubscription(sub.id);
    onClose();
  };

  return (
    <Sheet
      title={sub ? 'Регулярный платёж' : 'Новый регулярный платёж'}
      onClose={onClose}
      actions={
        <>
          {sub && (
            <button className="btn btn-ghost btn-danger" onClick={() => void remove()}>
              Удалить
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={save}>
            Сохранить
          </button>
        </>
      }
    >
      <label className="label">Название</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Netflix, аренда, кредит…" autoFocus={!sub} />
      <div className="fn-grid2">
        <div>
          <label className="label">Сумма, {curSymbol(cur)}</label>
          <AmountInput value={amount} onChange={setAmount} onEnter={save} />
        </div>
        <div>
          <label className="label">Следующий платёж</label>
          <input type="date" className="input" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Периодичность</label>
          <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as PeriodOpt)}>
            <option value="week">Каждую неделю</option>
            <option value="month">Каждый месяц</option>
            <option value="months">Раз в N месяцев</option>
            <option value="year">Каждый год</option>
          </select>
        </div>
        {period === 'months' ? (
          <div>
            <label className="label">Каждые N месяцев</label>
            <input className="input" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, ''))} />
          </div>
        ) : (
          <div>
            <label className="label">Напомнить</label>
            <RemindSelect value={remindDays} onChange={setRemindDays} />
          </div>
        )}
        <div>
          <label className="label">Счёт</label>
          <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.emoji} {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Категория</label>
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Без категории</option>
            {sortedCategories(data, 'expense').map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </div>
        {period === 'months' && (
          <div>
            <label className="label">Напомнить</label>
            <RemindSelect value={remindDays} onChange={setRemindDays} />
          </div>
        )}
      </div>
      <label className="label">Заметка</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="row fn-check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Активен</span>
      </label>
      {sub?.active && (
        <button
          className="fn-link small"
          onClick={() => {
            skipSubscription(sub.id);
            toast('Платёж пропущен');
            onClose();
          }}
        >
          Пропустить ближайший платёж ({dateShort(sub.nextDate)})
        </button>
      )}
    </Sheet>
  );
}

function RemindSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={-1}>Не напоминать</option>
      <option value={0}>В день платежа</option>
      <option value={1}>За 1 день</option>
      <option value={2}>За 2 дня</option>
      <option value={3}>За 3 дня</option>
      <option value={7}>За неделю</option>
    </select>
  );
}

// ================= Долги =================

export function DebtsSection({ data }: { data: FinanceData }) {
  const today = useToday();
  const [closed, setClosed] = useState(false);
  const [edit, setEdit] = useState<Debt | 'owe' | 'lent' | null>(null);
  const totals = debtTotals(data);
  const list = data.debts
    .filter((d) => d.closed === closed)
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.updatedAt - a.updatedAt);
  const current = typeof edit === 'object' && edit ? data.debts.find((d) => d.id === edit.id) ?? null : null;

  return (
    <div className="fn-stack">
      <div className="fn-debt-totals">
        <div className="card fn-panel">
          <span className="tiny faint">Я должен</span>
          <CurTotals totals={totals.owe} className="fn-neg fn-debt-sum" />
        </div>
        <div className="card fn-panel">
          <span className="tiny faint">Мне должны</span>
          <CurTotals totals={totals.lent} className="fn-pos fn-debt-sum" />
        </div>
      </div>
      <div className="row">
        <div className="segmented">
          <button className={!closed ? 'active' : ''} onClick={() => setClosed(false)}>
            Открытые
          </button>
          <button className={closed ? 'active' : ''} onClick={() => setClosed(true)}>
            Закрытые
          </button>
        </div>
      </div>
      <div className="card fn-list">
        {list.map((d) => {
          const left = debtLeft(d);
          const overdue = !d.closed && d.dueDate && d.dueDate < today;
          return (
            <button key={d.id} className="fn-debt" onClick={() => setEdit(d)}>
              <span className={'fn-debt-ic ' + (d.kind === 'owe' ? 'is-owe' : 'is-lent')}>
                <HandCoins size={18} />
              </span>
              <span className="grow fn-tx-main">
                <span className="row">
                  <span className="grow fn-tx-title ellipsis">{d.person}</span>
                  <Money v={d.closed ? d.amount : left} cur={d.currency} className={'small ' + (d.kind === 'owe' ? 'fn-neg' : 'fn-pos')} />
                </span>
                <span className={'fn-tx-sub ellipsis' + (overdue ? ' fn-neg' : '')}>
                  {d.kind === 'owe' ? 'Я должен' : 'Мне должны'}
                  {d.dueDate ? ` · до ${dateShort(d.dueDate)}` : ''}
                  {debtPaid(d) > 0 && !d.closed ? ` · из ${fmtMoney(d.amount, d.currency)}` : ''}
                  {d.note ? ` · ${d.note}` : ''}
                </span>
                {!d.closed && debtPaid(d) > 0 && <Progress spent={debtPaid(d)} limit={d.amount} thin />}
              </span>
            </button>
          );
        })}
        {!list.length && <p className="muted small fn-pad">{closed ? 'Закрытых долгов нет.' : 'Записывайте, кому вы должны и кто должен вам, — с частичными возвратами и сроками.'}</p>}
      </div>
      <div className="row fn-wrap">
        <button className="btn btn-primary" onClick={() => setEdit('owe')}>
          <Plus size={16} /> Я должен
        </button>
        <button className="btn btn-primary" onClick={() => setEdit('lent')}>
          <Plus size={16} /> Мне должны
        </button>
      </div>
      {edit && <DebtSheet key={typeof edit === 'string' ? edit : edit.id} data={data} debt={current} kind={typeof edit === 'string' ? edit : edit.kind} onClose={() => setEdit(null)} />}
    </div>
  );
}

function DebtSheet({ data, debt, kind: kind0, onClose }: { data: FinanceData; debt: Debt | null; kind: 'owe' | 'lent'; onClose: () => void }) {
  const [kind, setKind] = useState(debt?.kind ?? kind0);
  const [person, setPerson] = useState(debt?.person ?? '');
  const [amount, setAmount] = useState(debt ? String(debt.amount).replace('.', ',') : '');
  const [currency, setCurrency] = useState(debt?.currency ?? data.prefs.mainCurrency);
  const [date, setDate] = useState(debt?.date ?? todayYmd());
  const [dueDate, setDueDate] = useState(debt?.dueDate ?? '');
  const [note, setNote] = useState(debt?.note ?? '');
  const [pay, setPay] = useState('');
  const [payDate, setPayDate] = useState(todayYmd());

  const save = () => {
    const v = parseMoneyInput(amount);
    if (!person.trim()) return toast('Кто? Укажите имя');
    if (!(v > 0)) return toast('Введите сумму');
    const paid = debt ? debtPaid(debt) : 0;
    saveDebt({
      id: debt?.id ?? uid(),
      kind,
      person: person.trim(),
      amount: v,
      currency,
      date,
      dueDate: dueDate || undefined,
      note: note.trim() || undefined,
      payments: debt?.payments ?? [],
      closed: (debt?.closed ?? false) || (paid > 0 && paid >= v - 0.005),
    });
    onClose();
  };

  const addPay = () => {
    if (!debt) return;
    const v = parseMoneyInput(pay);
    if (!(v > 0)) return toast('Введите сумму возврата');
    addDebtPayment(debt.id, Math.min(v, debtLeft(debt) || v), payDate);
    setPay('');
    if (v >= debtLeft(debt) - 0.005) toast('Долг погашен полностью');
  };

  const remove = async () => {
    if (!debt) return;
    if (!(await confirmDialog(`Удалить долг «${debt.person}»?`, undefined, { okText: 'Удалить', danger: true }))) return;
    deleteDebt(debt.id);
    onClose();
  };

  const toggleClosed = () => {
    if (!debt) return;
    saveDebt({ ...debt, closed: !debt.closed });
    onClose();
  };

  return (
    <Sheet
      title={debt ? 'Долг' : kind === 'owe' ? 'Я должен' : 'Мне должны'}
      onClose={onClose}
      actions={
        <>
          {debt && (
            <button className="btn btn-ghost btn-danger" onClick={() => void remove()}>
              Удалить
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={save}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="segmented fn-seg-wide">
        <button className={kind === 'owe' ? 'active' : ''} onClick={() => setKind('owe')}>
          Я должен
        </button>
        <button className={kind === 'lent' ? 'active' : ''} onClick={() => setKind('lent')}>
          Мне должны
        </button>
      </div>
      <label className="label">{kind === 'owe' ? 'Кому' : 'Кто'}</label>
      <input className="input" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Имя" autoFocus={!debt} />
      <div className="fn-grid2">
        <div>
          <label className="label">Сумма</label>
          <AmountInput value={amount} onChange={setAmount} onEnter={save} />
        </div>
        <div>
          <label className="label">Валюта</label>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <div>
          <label className="label">Дата</label>
          <input type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Вернуть до</label>
          <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <label className="label">Заметка</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />

      {debt && (
        <>
          <label className="label">Возвраты</label>
          <div className="fn-payments">
            {debt.payments.map((p) => (
              <div key={p.id} className="row small">
                <Repeat size={14} className="faint" />
                <span className="grow">{dateLong(p.date)}</span>
                <Money v={p.amount} cur={debt.currency} />
                <button className="icon-btn fn-icon-sm" onClick={() => removeDebtPayment(debt.id, p.id)} aria-label="Удалить возврат">
                  <Trash2 />
                </button>
              </div>
            ))}
            <div className="row small muted">
              <span className="grow">Возвращено {fmtMoney(debtPaid(debt), debt.currency)}</span>
              <span>Осталось {fmtMoney(debtLeft(debt), debt.currency)}</span>
            </div>
            {!debt.closed && (
              <div className="fn-pay-row">
                <AmountInput value={pay} onChange={setPay} placeholder={`Сумма, ${curSymbol(debt.currency)}`} onEnter={addPay} />
                <input type="date" className="input" value={payDate} onChange={(e) => e.target.value && setPayDate(e.target.value)} />
                <button className="btn" onClick={addPay}>
                  Добавить
                </button>
              </div>
            )}
          </div>
          <button className="fn-link small" onClick={toggleClosed}>
            {debt.closed ? 'Открыть долг снова' : 'Закрыть долг (полностью погашен)'}
          </button>
        </>
      )}
    </Sheet>
  );
}
