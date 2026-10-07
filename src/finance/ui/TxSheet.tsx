import { useMemo, useState, type CSSProperties } from 'react';
import { Trash } from '@phosphor-icons/react';
import { addDaysYmd, todayYmd } from '../../utils/mapTasks';
import { toast } from '../../store/appStore';
import { confirmDialog } from '../../ui/dialogs';
import { curSymbol, dateShort, parseMoneyInput, sortedAccounts, sortedCategories, type CatKind, type FinanceData, type TxType } from '../model';
import { addTransaction, deleteTransaction, updateTransaction } from '../store';
import { AmountInput, Sheet } from './common';
import { closeTxSheet, openMore, useFinUi } from './state';

const numStr = (x: number | undefined) => (x === undefined ? '' : String(x).replace('.', ','));

/** Быстрое добавление / правка операции */
export function TxSheet({ data }: { data: FinanceData }) {
  const sheet = useFinUi((s) => s.sheet);
  if (!sheet) return null;
  return <TxForm key={sheet.tx?.id ?? 'new'} data={data} />;
}

function TxForm({ data }: { data: FinanceData }) {
  const sheet = useFinUi((s) => s.sheet)!;
  const edit = sheet.tx;
  const init = { ...(sheet.preset ?? {}), ...(edit ?? {}) };
  const accounts = sortedAccounts(data, true).filter((a) => !a.archived || a.id === init.accountId || a.id === init.toAccountId);
  const lastAcc = data.prefs.lastAccountId && accounts.some((a) => a.id === data.prefs.lastAccountId) ? data.prefs.lastAccountId : accounts[0]?.id;

  const [type, setType] = useState<TxType>(init.type ?? 'expense');
  const [amount, setAmount] = useState(numStr(init.amount));
  const [toAmount, setToAmount] = useState(numStr(init.toAmount));
  const [accountId, setAccountId] = useState(init.accountId ?? lastAcc ?? '');
  const [toAccountId, setToAccountId] = useState(init.toAccountId ?? accounts.find((a) => a.id !== (init.accountId ?? lastAcc))?.id ?? '');
  const [catByKind, setCatByKind] = useState<Record<CatKind, string>>({
    expense: init.type !== 'income' ? (init.categoryId ?? '') : '',
    income: init.type === 'income' ? (init.categoryId ?? '') : '',
  });
  const [date, setDate] = useState(init.date ?? todayYmd());
  const [time, setTime] = useState(init.time ?? '');
  const [note, setNote] = useState(init.note ?? '');
  const [tags, setTags] = useState((init.tags ?? []).join(', '));

  const kind: CatKind = type === 'income' ? 'income' : 'expense';
  const cats = useMemo(() => sortedCategories(data, kind), [data, kind]);
  const acc = accounts.find((a) => a.id === accountId);
  const toAcc = accounts.find((a) => a.id === toAccountId);
  const crossCur = type === 'transfer' && !!acc && !!toAcc && acc.currency !== toAcc.currency;
  const today = todayYmd();
  const yesterday = addDaysYmd(today, -1);

  if (!accounts.length) {
    return (
      <Sheet title="Нет счетов" onClose={closeTxSheet}>
        <p className="muted">Сначала добавьте счёт — наличные, карту или вклад.</p>
        <div className="modal-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              closeTxSheet();
              openMore('accounts');
            }}
          >
            Добавить счёт
          </button>
        </div>
      </Sheet>
    );
  }

  const save = () => {
    const v = parseMoneyInput(amount);
    if (!(v > 0)) return toast('Введите сумму');
    if (!acc) return toast('Выберите счёт');
    const tagList = [...new Set(tags.split(/[,#]/).map((g) => g.trim()).filter(Boolean))];
    const base = { type, amount: v, accountId, date, time: time || undefined, note: note.trim() || undefined, tags: tagList };
    let patch;
    if (type === 'transfer') {
      if (!toAcc || toAccountId === accountId) return toast('Выберите другой счёт зачисления');
      const tv = crossCur ? parseMoneyInput(toAmount) : v;
      if (!(tv > 0)) return toast('Введите сумму зачисления');
      patch = { ...base, toAccountId, toAmount: crossCur ? tv : undefined, categoryId: undefined };
    } else {
      patch = { ...base, categoryId: catByKind[kind] || undefined, toAccountId: undefined, toAmount: undefined };
    }
    if (edit) updateTransaction(edit.id, patch);
    else addTransaction({ ...patch, subscriptionId: sheet.preset?.subscriptionId });
    closeTxSheet();
  };

  const remove = async () => {
    if (!edit) return;
    if (!(await confirmDialog('Удалить операцию?', undefined, { okText: 'Удалить', danger: true }))) return;
    deleteTransaction(edit.id);
    closeTxSheet();
  };

  const accChips = (value: string, set: (id: string) => void, exclude?: string) => (
    <div className="fn-acc-chips">
      {accounts
        .filter((a) => a.id !== exclude)
        .map((a) => (
          <button type="button" key={a.id} className={'chip fn-chip' + (a.id === value ? ' active' : '')} onClick={() => set(a.id)}>
            <span>{a.emoji}</span> {a.name}
          </button>
        ))}
    </div>
  );

  return (
    <Sheet
      title={edit ? 'Операция' : 'Новая операция'}
      onClose={closeTxSheet}
      className="fn-tx-sheet"
      head={
        edit && (
          <button className="icon-btn fn-danger" onClick={() => void remove()} aria-label="Удалить" title="Удалить">
            <Trash />
          </button>
        )
      }
      actions={
        <>
          <button className="btn" onClick={closeTxSheet}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={save}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="segmented fn-type-seg">
        {(
          [
            ['expense', 'Расход'],
            ['income', 'Доход'],
            ['transfer', 'Перевод'],
          ] as const
        ).map(([t, l]) => (
          <button key={t} className={(type === t ? 'active ' : '') + `fn-type-${t}`} onClick={() => setType(t)}>
            {l}
          </button>
        ))}
      </div>

      <div className={`fn-amount-box is-${type}`}>
        <AmountInput value={amount} onChange={setAmount} autoFocus={!edit} onEnter={save} className="fn-amount-big" />
        <span className="fn-amount-cur">{acc ? curSymbol(acc.currency) : ''}</span>
      </div>

      {type !== 'transfer' ? (
        <>
          <div className="fn-cat-grid">
            {cats.map((c) => (
              <button
                type="button"
                key={c.id}
                className={'fn-cat-cell' + (catByKind[kind] === c.id ? ' active' : '')}
                style={{ '--c': c.color } as CSSProperties}
                onClick={() => setCatByKind({ ...catByKind, [kind]: catByKind[kind] === c.id ? '' : c.id })}
              >
                <span className="fn-cat-cell-ic">{c.emoji}</span>
                <span className="fn-cat-cell-name">{c.name}</span>
              </button>
            ))}
          </div>
          <label className="label">Счёт</label>
          {accChips(accountId, setAccountId)}
        </>
      ) : (
        <>
          <label className="label">Со счёта</label>
          {accChips(accountId, (id) => {
            setAccountId(id);
            if (id === toAccountId) setToAccountId(accounts.find((a) => a.id !== id)?.id ?? '');
          })}
          <label className="label">На счёт</label>
          {accChips(toAccountId, setToAccountId, accountId)}
          {crossCur && (
            <>
              <label className="label">Зачислено, {curSymbol(toAcc!.currency)}</label>
              <AmountInput value={toAmount} onChange={setToAmount} onEnter={save} />
            </>
          )}
        </>
      )}

      <label className="label">Дата</label>
      <div className="fn-date-row">
        <button type="button" className={'chip fn-chip' + (date === today ? ' active' : '')} onClick={() => setDate(today)}>
          Сегодня
        </button>
        <button type="button" className={'chip fn-chip' + (date === yesterday ? ' active' : '')} onClick={() => setDate(yesterday)}>
          Вчера
        </button>
        <label className={'chip fn-chip fn-date-chip' + (date !== today && date !== yesterday ? ' active' : '')}>
          {date !== today && date !== yesterday ? dateShort(date) : 'Дата…'}
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className={'chip fn-chip fn-date-chip' + (time ? ' active' : '')}>
          {time || 'Время'}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Время" />
        </label>
        {time && (
          <button type="button" className="chip fn-chip" onClick={() => setTime('')} aria-label="Без времени">
            ✕
          </button>
        )}
      </div>

      <label className="label">Комментарий</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: обед с коллегами" onKeyDown={(e) => e.key === 'Enter' && save()} />
      <label className="label">Теги</label>
      <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="через запятую" />
    </Sheet>
  );
}
