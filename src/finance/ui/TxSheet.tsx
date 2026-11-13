import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Plus, Trash, X } from '@phosphor-icons/react';
import { addDaysYmd, todayYmd } from '../../utils/mapTasks';
import { toast } from '../../store/appStore';
import { curSymbol, dateShort, fmtMoney, parseMoneyInput, r2, sortedAccounts, sortedCategories, type CatKind, type FinanceData, type TxType, fmtInputNum, convertAmount, CURRENCIES, rateText } from '../model';
import { addTransaction, deleteTransaction, mergeSplit, refreshRates, splitParts, splitTransaction, updateTransaction } from '../store';
import { autoRatesOn } from '../rates';
import { AmountInput, Sheet } from './common';
import { closeTxSheet, openMore, useFinUi } from './state';

const numStr = fmtInputNum;

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
  // введено в другой валюте — правим как вводили
  const [amount, setAmount] = useState(numStr(init.orig?.amount ?? init.amount));
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
  /** разделение по категориям: части сверх основной категории (её сумма — остаток) */
  const [parts, setParts] = useState<{ cat: string; amount: string }[]>([]);
  const group = edit?.splitId ? splitParts(data, edit.splitId) : [];

  const kind: CatKind = type === 'income' ? 'income' : 'expense';
  const cats = useMemo(() => sortedCategories(data, kind), [data, kind]);
  const acc = accounts.find((a) => a.id === accountId);
  /** валюта ввода суммы: по умолчанию — валюта счёта; другая — пересчёт по курсу в валюту счёта */
  const [cur, setCur] = useState(init.orig?.currency ?? acc?.currency ?? data.prefs.mainCurrency);
  const inCur = type === 'transfer' || !acc ? (acc?.currency ?? cur) : cur;
  const foreign = !!acc && inCur !== acc.currency;
  const typed = parseMoneyInput(amount) || 0;
  const conv = foreign ? convertAmount(typed, inCur, acc!.currency, data.prefs) : typed;
  const auto = autoRatesOn(data.prefs);
  // выбрали валюту без курса — подгрузить курс (если курсы автоматические)
  useEffect(() => {
    if (foreign && auto && convertAmount(1, inCur, acc!.currency, data.prefs) === null) void refreshRates(true, undefined, [inCur]);
  }, [foreign, inCur, acc, auto, data.prefs]);
  /** счёт сменили: валюта ввода шла за счётом — идёт и дальше */
  const pickAccount = (id: string) => {
    const next = accounts.find((a) => a.id === id);
    if (next && acc && cur === acc.currency) setCur(next.currency);
    setAccountId(id);
  };
  /** валюты для выбора: счёта, основная, счетов, с курсами, затем остальные */
  const curOptions = useMemo(() => {
    const first = [acc?.currency, data.prefs.mainCurrency, ...accounts.map((a) => a.currency), ...Object.keys(data.prefs.rates)].filter((c): c is string => !!c);
    return [...new Set([...first, ...CURRENCIES.map((c) => c.code)])];
  }, [acc, accounts, data.prefs]);
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

  const partSum = r2(parts.reduce((a, p) => a + (parseMoneyInput(p.amount) || 0), 0));
  const rest = r2((parseMoneyInput(amount) || 0) - partSum);

  const save = () => {
    const typedV = parseMoneyInput(amount);
    if (!(typedV > 0)) return toast('Введите сумму');
    if (!acc) return toast('Выберите счёт');
    if (foreign && conv === null) return toast(`Нет курса ${curSymbol(inCur)} — ${auto ? 'нужен интернет, чтобы его получить' : 'укажите курс в Финансы → Ещё → Курсы валют'}`);
    // сумма в валюте счёта (введено в другой — по курсу); части покупки — тем же курсом
    const k = foreign ? conv! / typedV : 1;
    const v = r2(typedV * k);
    const orig = foreign && type !== 'transfer' ? { amount: typedV, currency: inCur } : undefined;
    const split = type === 'transfer' ? [] : parts.map((p) => ({ categoryId: p.cat || undefined, amount: r2((parseMoneyInput(p.amount) || 0) * k) })).filter((p) => p.amount > 0);
    if (split.length && r2(typedV - partSum) <= 0) return toast('Части больше всей суммы — уменьшите их');
    const tagList = [...new Set(tags.split(/[,#]/).map((g) => g.trim()).filter(Boolean))];
    const base = { type, amount: v, accountId, date, time: time || undefined, note: note.trim() || undefined, tags: tagList };
    let patch;
    if (type === 'transfer') {
      if (!toAcc || toAccountId === accountId) return toast('Выберите другой счёт зачисления');
      const tv = crossCur ? parseMoneyInput(toAmount) : v;
      if (!(tv > 0)) return toast('Введите сумму зачисления');
      patch = { ...base, toAccountId, toAmount: crossCur ? tv : undefined, categoryId: undefined, orig: undefined };
    } else {
      patch = { ...base, categoryId: catByKind[kind] || undefined, toAccountId: undefined, toAmount: undefined, orig };
    }
    let id = edit?.id;
    if (edit) updateTransaction(edit.id, patch);
    else id = addTransaction({ ...patch, subscriptionId: sheet.preset?.subscriptionId })?.id;
    if (id && split.length && splitTransaction(id, split)) toast(`Покупка разделена на ${split.length + 1} части`);
    closeTxSheet();
  };

  // без подтверждения: после удаления есть «Отменить» во всплывашке
  const remove = () => {
    if (!edit) return;
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
          <button className="icon-btn fn-danger" onClick={remove} aria-label="Удалить" title="Удалить">
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
        {type === 'transfer' || !acc ? (
          <span className="fn-amount-cur">{acc ? curSymbol(acc.currency) : ''}</span>
        ) : (
          // валюта суммы: можно ввести в другой — спишется со счёта по курсу
          <label className={'fn-amount-cur fn-cur-pick' + (foreign ? ' is-foreign' : '')} title="Валюта суммы">
            {curSymbol(inCur)}
            <select value={inCur} onChange={(e) => setCur(e.target.value)} aria-label="Валюта суммы">
              {curOptions.map((c) => (
                <option key={c} value={c}>
                  {curSymbol(c)} {c}
                  {c === acc.currency ? ' — валюта счёта' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {foreign && (
        <div className="fn-conv">
          {conv === null ? (
            <span className="fn-danger">Нет курса {curSymbol(inCur)} → {curSymbol(acc!.currency)}{auto ? ' — получаю…' : ' — укажите его в Финансы → Ещё → Курсы валют'}</span>
          ) : (
            <>
              <b>
                {type === 'income' ? '+' : '−'}
                {fmtMoney(r2(conv), acc!.currency)}
              </b>{' '}
              {type === 'income' ? 'на счёт' : 'со счёта'} «{acc!.name}» · {rateText(inCur, acc!.currency, data.prefs)}
            </>
          )}
        </div>
      )}

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
          {group.length > 1 ? (
            <div className="fn-split-info">
              <span className="grow">
                Часть покупки: {group.length} {group.length < 5 ? 'части' : 'частей'} на {fmtMoney(r2(group.reduce((a, x) => a + x.amount, 0)), acc?.currency ?? '')}
              </span>
              <button
                type="button"
                className="fn-link"
                onClick={() => {
                  const n = mergeSplit(edit!.id);
                  closeTxSheet();
                  if (n) toast('Части собраны в одну операцию');
                }}
              >
                Собрать в одну
              </button>
            </div>
          ) : parts.length === 0 ? (
            <button type="button" className="fn-link fn-split-add" onClick={() => setParts([{ cat: '', amount: '' }])}>
              <Plus size={14} /> Разделить по категориям
            </button>
          ) : (
            <div className="fn-split">
              <div className="fn-split-h">Ещё категории в этой покупке</div>
              {parts.map((p, i) => (
                <div key={i} className="row fn-split-row">
                  <select className="select" value={p.cat} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, cat: e.target.value } : x)))} aria-label="Категория части">
                    <option value="">Без категории</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.name}
                      </option>
                    ))}
                  </select>
                  <AmountInput value={p.amount} onChange={(v) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: v } : x)))} placeholder="сумма" />
                  <button type="button" className="icon-btn" onClick={() => setParts(parts.filter((_, j) => j !== i))} aria-label="Убрать часть">
                    <X size={16} />
                  </button>
                </div>
              ))}
              <div className="row fn-split-foot">
                <button type="button" className="fn-link" onClick={() => setParts([...parts, { cat: '', amount: '' }])}>
                  <Plus size={14} /> Ещё часть
                </button>
                <span className={'grow tiny ' + (rest > 0 ? 'faint' : 'fn-danger')}>
                  {(catByKind[kind] && cats.find((c) => c.id === catByKind[kind])?.name) || 'Без категории'}: {fmtMoney(Math.max(0, rest), inCur)}
                </span>
              </div>
            </div>
          )}
          <label className="label">Счёт</label>
          {accChips(accountId, pickAccount)}
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
