/**
 * Долги: «Мне должны» и «Я должен» — люди, суммы, сроки, частичные возвраты.
 * Всё через функции хранилища финансов (saveDebt / addDebtPayment / deleteDebt) — синхронизация и слияние работают как обычно.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { ArrowCounterClockwise, CheckCircle, HandCoins, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react';
import { uid } from '../../utils/tree';
import { todayYmd } from '../../utils/mapTasks';
import { toast } from '../../store/appStore';
import { confirmDialog } from '../../ui/dialogs';
import { ListRow, ListSection, SwitchRow } from '../../ui/list';
import { IconTile } from '../../ui/icons';
import { curSymbol, dateLong, dateShort, debtLeft, debtPaid, debtTotals, fmtMoney, parseMoneyInput, sortedAccounts, type Debt, type FinanceData } from '../model';
import { addDebtPayment, addTransaction, deleteDebt, deleteTransaction, financeData, removeDebtPayment, saveDebt } from '../store';
import { AmountInput, CurrencySelect, CurTotals, Sheet, useToday } from './common';
import { closeDebt, openDebt, useFinUi } from './state';

type Kind = Debt['kind'];

const AVATAR = ['#ff9500', '#34c759', '#007aff', '#af52de', '#ff2d55', '#5ac8fa', '#5856d6', '#ff3b30', '#30b0c7', '#a2845e'];

function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return ((w[0][0] ?? '') + (w.length > 1 ? (w[1][0] ?? '') : '')).toUpperCase();
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const c = avatarColor(name);
  return (
    <span className="fn-avatar" style={{ '--c': c, width: size, height: size, fontSize: Math.round(size * 0.4) } as CSSProperties} aria-hidden>
      {initials(name)}
    </span>
  );
}

const hasTotals = (t: Record<string, number>) => Object.values(t).some((v) => v > 0);

/** Итоги «Мне должны · Я должен» — для обзора и вкладки */
export function DebtSummary({ data, onClick }: { data: FinanceData; onClick?: () => void }) {
  const t = debtTotals(data);
  const body = (
    <>
      <span className="fn-dsum-col">
        <span className="fn-dsum-label">Мне должны</span>
        {hasTotals(t.lent) ? <CurTotals totals={t.lent} className="fn-dsum-val fn-pos" /> : <span className="fn-dsum-val fn-dsum-zero">0</span>}
      </span>
      <span className="fn-dsum-col">
        <span className="fn-dsum-label">Я должен</span>
        {hasTotals(t.owe) ? <CurTotals totals={t.owe} className="fn-dsum-val fn-neg" /> : <span className="fn-dsum-val fn-dsum-zero">0</span>}
      </span>
    </>
  );
  return onClick ? (
    <button className="fn-dsum is-tap" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="fn-dsum">{body}</div>
  );
}

function sortOpen(a: Debt, b: Debt): number {
  return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.updatedAt - a.updatedAt;
}

/** Вкладка «Долги» */
export function DebtsTab({ data }: { data: FinanceData }) {
  const [showClosed, setShowClosed] = useState(false);
  const open = data.debts.filter((d) => !d.closed);
  const lent = open.filter((d) => d.kind === 'lent').sort(sortOpen);
  const owe = open.filter((d) => d.kind === 'owe').sort(sortOpen);
  const closed = data.debts.filter((d) => d.closed).sort((a, b) => b.updatedAt - a.updatedAt);
  const t = debtTotals(data);

  if (!data.debts.length)
    return (
      <div className="empty fn-debt-empty">
        <IconTile icon={HandCoins} tone="teal" size="lg" />
        <div className="bold">Долги</div>
        <div>Запишите, кто должен вам и кому должны вы, — с суммой, сроком и напоминанием.</div>
        <div className="row fn-debt-empty-actions">
          <button className="btn btn-tinted" onClick={() => openDebt({ kind: 'lent' })}>
            <Plus size={16} weight="bold" /> Мне должны
          </button>
          <button className="btn btn-tinted" onClick={() => openDebt({ kind: 'owe' })}>
            <Plus size={16} weight="bold" /> Я должен
          </button>
        </div>
      </div>
    );

  return (
    <div className="fn-stack fn-debts">
      <DebtGroup title="Мне должны" kind="lent" list={lent} totals={t.lent} />
      <DebtGroup title="Я должен" kind="owe" list={owe} totals={t.owe} />
      {closed.length > 0 && (
        <section className="fn-dgroup">
          <button className="fn-dgroup-head fn-dgroup-toggle" onClick={() => setShowClosed(!showClosed)}>
            <h3 className="grow">Погашенные</h3>
            <span className="fn-dgroup-total muted">{showClosed ? 'Скрыть' : `Показать (${closed.length})`}</span>
          </button>
          {showClosed && (
            <div className="fn-dlist">
              {closed.map((d) => (
                <DebtRow key={d.id} d={d} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function DebtGroup({ title, kind, list, totals }: { title: string; kind: Kind; list: Debt[]; totals: Record<string, number> }) {
  return (
    <section className="fn-dgroup">
      <div className="fn-dgroup-head">
        <h3 className="grow">{title}</h3>
        {hasTotals(totals) && <CurTotals totals={totals} className={'fn-dgroup-total ' + (kind === 'lent' ? 'fn-pos' : 'fn-neg')} />}
      </div>
      <div className="fn-dlist">
        {list.map((d) => (
          <DebtRow key={d.id} d={d} />
        ))}
        <button className="fn-dadd" onClick={() => openDebt({ kind })}>
          <Plus size={18} weight="bold" />
          {kind === 'lent' ? 'Кто-то должен мне' : 'Я должен кому-то'}
        </button>
      </div>
    </section>
  );
}

function DebtRow({ d }: { d: Debt }) {
  const today = useToday();
  const left = debtLeft(d);
  const paid = debtPaid(d);
  const overdue = !d.closed && !!d.dueDate && d.dueDate < today;
  const sub: string[] = [];
  if (d.closed) sub.push('погашен');
  else if (d.dueDate) sub.push(overdue ? `просрочено · до ${dateShort(d.dueDate)}` : d.dueDate === today ? 'вернуть сегодня' : `до ${dateShort(d.dueDate)}`);
  if (d.note) sub.push(d.note);
  return (
    <button className={'fn-drow' + (d.closed ? ' is-closed' : '')} onClick={() => openDebt({ id: d.id })}>
      <Avatar name={d.person} />
      <span className="fn-drow-main">
        <span className="fn-drow-name ellipsis">{d.person}</span>
        {sub.length > 0 && <span className={'fn-drow-sub ellipsis' + (overdue ? ' fn-neg' : '')}>{sub.join(' · ')}</span>}
      </span>
      <span className="fn-drow-amt">
        <span className={'fn-money ' + (d.closed ? '' : d.kind === 'lent' ? 'fn-pos' : 'fn-neg')}>{fmtMoney(d.closed ? d.amount : left, d.currency)}</span>
        {!d.closed && paid > 0 && <span className="fn-drow-of">из {fmtMoney(d.amount, d.currency, { compact: true })}</span>}
      </span>
    </button>
  );
}

/** Окна долгов: новый / правка / карточка. Монтируется один раз в разделе «Финансы» */
export function DebtSheets({ data }: { data: FinanceData }) {
  const st = useFinUi((s) => s.debt);
  if (!st) return null;
  const debt = st.id ? data.debts.find((d) => d.id === st.id) : undefined;
  if (st.id && !debt) return null;
  if (!debt || st.edit) return <DebtEditSheet key={st.id ?? 'new-' + (st.kind ?? '')} data={data} debt={debt} kind={st.kind ?? debt?.kind ?? 'lent'} />;
  return <DebtCard key={debt.id} data={data} debt={debt} />;
}

function DebtEditSheet({ data, debt, kind: kind0 }: { data: FinanceData; debt?: Debt; kind: Kind }) {
  const [kind, setKind] = useState<Kind>(debt?.kind ?? kind0);
  const [person, setPerson] = useState(debt?.person ?? '');
  const [amount, setAmount] = useState(debt ? String(debt.amount).replace('.', ',') : '');
  const [currency, setCurrency] = useState(debt?.currency ?? data.prefs.mainCurrency);
  const [date, setDate] = useState(debt?.date ?? todayYmd());
  const [dueDate, setDueDate] = useState(debt?.dueDate ?? '');
  const [note, setNote] = useState(debt?.note ?? '');
  const [remind, setRemind] = useState(debt?.remind ?? true);
  const people = useMemo(() => [...new Set(data.debts.map((d) => d.person))].sort((a, b) => a.localeCompare(b, 'ru')), [data.debts]);
  const close = () => (debt ? openDebt({ id: debt.id }) : closeDebt());

  const save = () => {
    const v = parseMoneyInput(amount);
    if (!person.trim()) return toast(kind === 'owe' ? 'Кому вы должны? Укажите имя' : 'Кто вам должен? Укажите имя');
    if (!(v > 0)) return toast('Введите сумму');
    const paid = debt ? debtPaid(debt) : 0;
    const id = debt?.id ?? uid();
    saveDebt({
      id,
      kind,
      person: person.trim(),
      amount: v,
      currency,
      date,
      dueDate: dueDate || undefined,
      note: note.trim() || undefined,
      remind: dueDate ? remind : undefined,
      payments: debt?.payments ?? [],
      // при возвратах статус следует из суммы: увеличили долг — он снова открыт
      closed: debt ? (paid > 0 ? paid >= v - 0.005 : debt.closed) : false,
    });
    if (debt) openDebt({ id });
    else {
      closeDebt();
      toast(kind === 'owe' ? `Записано: вы должны ${person.trim()}` : `Записано: ${person.trim()} должен вам`);
    }
  };

  return (
    <Sheet
      title={debt ? 'Изменить долг' : 'Новый долг'}
      onClose={close}
      className="fn-debt-sheet"
      actions={
        <>
          <button className="btn" onClick={close}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={save}>
            {debt ? 'Сохранить' : 'Добавить'}
          </button>
        </>
      }
    >
      <div className="segmented fn-seg-wide fn-debt-seg">
        <button className={kind === 'lent' ? 'active' : ''} onClick={() => setKind('lent')}>
          Мне должны
        </button>
        <button className={kind === 'owe' ? 'active' : ''} onClick={() => setKind('owe')}>
          Я должен
        </button>
      </div>

      <div className="ls-group fn-form">
        <label className="ls-field">
          <span className="fn-form-label">{kind === 'owe' ? 'Кому' : 'Кто'}</span>
          <input className="ls-input fn-form-person" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Имя" autoFocus={!debt} list="fn-debt-people" enterKeyHint="next" />
          <datalist id="fn-debt-people">
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="ls-field">
          <span className="fn-form-label">Сумма</span>
          <AmountInput className="ls-input fn-form-amount" value={amount} onChange={setAmount} onEnter={save} />
          <span className="fn-form-cur">
            {curSymbol(currency)}
            <CurrencySelect value={currency} onChange={setCurrency} className="fn-form-cur-select" />
          </span>
        </label>
      </div>

      <div className="ls-group fn-form">
        <label className="ls-field">
          <span className="fn-form-label">Вернуть до</span>
          <input type="date" className={'ls-input fn-form-date' + (dueDate ? '' : ' is-empty')} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          {dueDate && (
            <button type="button" className="icon-btn fn-form-clear" onClick={() => setDueDate('')} aria-label="Без срока">
              <X size={14} weight="bold" />
            </button>
          )}
        </label>
        {dueDate && <SwitchRow title="Напомнить" subtitle="В 9:00 в этот день" checked={remind} onChange={setRemind} />}
        {debt && (
          <label className="ls-field">
            <span className="fn-form-label">Дата долга</span>
            <input type="date" className="ls-input fn-form-date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
        )}
        <label className="ls-field">
          <input className="ls-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка — за что, где" />
        </label>
      </div>
    </Sheet>
  );
}

function DebtCard({ data, debt }: { data: FinanceData; debt: Debt }) {
  const today = useToday();
  const [pay, setPay] = useState<string | null>(null);
  const accounts = sortedAccounts(data).filter((a) => a.currency === debt.currency);
  const [accId, setAccId] = useState('');
  const left = debtLeft(debt);
  const paid = debtPaid(debt);
  const pct = debt.amount > 0 ? Math.min(100, (paid / debt.amount) * 100) : 0;
  const overdue = !debt.closed && !!debt.dueDate && debt.dueDate < today;
  const lent = debt.kind === 'lent';

  /** Операция на счёт: вернули мне — доход, вернул я — расход */
  const record = (v: number) => {
    if (!accId) return null;
    return addTransaction({ type: lent ? 'income' : 'expense', amount: v, accountId: accId, date: todayYmd(), note: `Долг: ${debt.person}` }, { silent: true });
  };

  const payPart = () => {
    const v = parseMoneyInput(pay ?? '');
    if (!(v > 0)) return toast('Введите сумму');
    const amt = Math.min(v, left || v);
    addDebtPayment(debt.id, amt);
    record(amt);
    setPay(null);
    toast(amt >= left - 0.005 ? 'Долг погашен полностью' : `Возврат ${fmtMoney(amt, debt.currency)} записан`);
  };

  const payAll = () => {
    if (!(left > 0)) return;
    const before = new Set(debt.payments.map((p) => p.id));
    addDebtPayment(debt.id, left);
    const tx = record(left);
    closeDebt();
    toast('Долг погашен', {
      label: 'Отменить',
      run: () => {
        const y = financeData()?.debts.find((d) => d.id === debt.id);
        if (y) saveDebt({ ...y, payments: y.payments.filter((q) => before.has(q.id)), closed: false });
        if (tx) deleteTransaction(tx.id, false);
      },
    });
  };

  const reopen = () => saveDebt({ ...debt, closed: false });

  const remove = async () => {
    if (!(await confirmDialog(`Удалить долг «${debt.person}»?`, 'Возвраты по нему тоже удалятся. Операции на счетах останутся.', { okText: 'Удалить', danger: true }))) return;
    const copy: Debt = structuredClone(debt);
    deleteDebt(debt.id);
    closeDebt();
    toast('Долг удалён', { label: 'Отменить', run: () => saveDebt(copy) });
  };

  return (
    <Sheet title="" onClose={closeDebt} className="fn-debt-sheet fn-debt-card">
      <div className="fn-dcard-hero">
        <Avatar name={debt.person} size={64} />
        <div className="fn-dcard-name">{debt.person}</div>
        <div className="fn-dcard-kind">{lent ? 'должен вам' : 'вы должны'}</div>
        <div className={'fn-dcard-amt ' + (debt.closed ? '' : lent ? 'fn-pos' : 'fn-neg')}>{fmtMoney(debt.closed ? debt.amount : left, debt.currency)}</div>
        {debt.closed ? (
          <div className="fn-dcard-meta">Погашен полностью</div>
        ) : (
          <>
            {paid > 0 && (
              <div className="fn-dcard-progress">
                <span className="fn-progress is-thin is-ok">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className="fn-dcard-meta">
                  Вернули {fmtMoney(paid, debt.currency)} из {fmtMoney(debt.amount, debt.currency)}
                </span>
              </div>
            )}
            {debt.dueDate && (
              <div className={'fn-dcard-meta' + (overdue ? ' fn-neg' : '')}>
                {overdue ? 'Срок прошёл — ' : 'Вернуть до '}
                {dateLong(debt.dueDate)}
                {debt.remind ? ' · напомню в 9:00' : ''}
              </div>
            )}
          </>
        )}
        {debt.note && <div className="fn-dcard-note">{debt.note}</div>}
      </div>

      {!debt.closed && pay !== null && (
        <div className="ls-group fn-form fn-pay-form">
          <label className="ls-field">
            <span className="fn-form-label">Вернули</span>
            <AmountInput className="ls-input fn-form-amount" value={pay} onChange={setPay} onEnter={payPart} autoFocus placeholder={fmtMoney(left, debt.currency).replace(/[^\d\s,]/g, '').trim()} />
            <span className="fn-form-cur">{curSymbol(debt.currency)}</span>
          </label>
          {accounts.length > 0 && (
            <label className="ls-row ls-select-row fn-acc-pick">
              <span className="ls-body">
                <span className="ls-title">Записать на счёт</span>
              </span>
              <span className="ls-value">{accounts.find((a) => a.id === accId)?.name ?? 'Не записывать'}</span>
              <select className="ls-select" value={accId} onChange={(e) => setAccId(e.target.value)}>
                <option value="">Не записывать</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.emoji} {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="fn-pay-form-actions">
            <button className="btn" onClick={() => setPay(null)}>
              Отмена
            </button>
            <button className="btn btn-primary" onClick={payPart}>
              Записать возврат
            </button>
          </div>
        </div>
      )}

      {!debt.closed && pay === null && (
        <div className="fn-dcard-actions">
          <button className="fn-dact" onClick={() => setPay('')}>
            <span className="fn-dact-ic">
              <ArrowCounterClockwise size={22} weight="bold" />
            </span>
            Вернули часть
          </button>
          <button className="fn-dact" onClick={payAll}>
            <span className="fn-dact-ic is-ok">
              <CheckCircle size={24} weight="fill" />
            </span>
            Погашен
          </button>
          <button className="fn-dact" onClick={() => openDebt({ id: debt.id, edit: true })}>
            <span className="fn-dact-ic">
              <PencilSimple size={22} weight="bold" />
            </span>
            Изменить
          </button>
        </div>
      )}

      {debt.payments.length > 0 && (
        <ListSection header="Возвраты">
          {[...debt.payments]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((p) => (
              <ListRow
                key={p.id}
                title={fmtMoney(p.amount, debt.currency)}
                value={dateLong(p.date)}
                trailing={
                  <button className="icon-btn fn-icon-sm" onClick={() => removeDebtPayment(debt.id, p.id)} aria-label="Удалить возврат">
                    <Trash size={17} />
                  </button>
                }
              />
            ))}
        </ListSection>
      )}

      <ListSection>
        {debt.closed && <ListRow title="Открыть долг снова" tone="accent" onClick={reopen} />}
        {debt.closed && <ListRow title="Изменить" tone="accent" onClick={() => openDebt({ id: debt.id, edit: true })} />}
        <ListRow title="Удалить долг" tone="danger" onClick={() => void remove()} />
      </ListSection>
      <p className="fn-dcard-foot">Записан {dateLong(debt.date)}</p>
    </Sheet>
  );
}
