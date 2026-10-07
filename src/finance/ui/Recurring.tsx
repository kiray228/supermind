import { useMemo, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { uid } from '../../utils/tree';
import { fromYmd, todayYmd } from '../../utils/mapTasks';
import { toast } from '../../store/appStore';
import { confirmDialog } from '../../ui/dialogs';
import {
  accountMap,
  categoryMap,
  curSymbol,
  dateShort,
  fmtMoney,
  parseMoneyInput,
  periodText,
  r2,
  sortedAccounts,
  sortedCategories,
  subMonthly,
  toMain,
  type FinanceData,
  type SubPeriod,
  type Subscription,
} from '../model';
import { deleteSubscription, paySubscription, saveSubscription, skipSubscription } from '../store';
import { AmountInput, CatIcon, CurTotals, Money, Sheet, useToday } from './common';

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
