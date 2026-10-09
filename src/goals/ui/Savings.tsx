import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsLeftRight, Check, CheckCircle, Plus, Warning } from '@phosphor-icons/react';
import { toast } from '../../store/appStore';
import { todayYmd } from '../../utils/mapTasks';
import { CURRENCIES, curSymbol, dateShort, fmtMoney, fmtNum, parseMoneyInput, r2, sortedAccounts, sortTx, toMain } from '../../finance/model';
import { ensureFinance, useFinance } from '../../finance/store';
import {
  accountBalance,
  convertCur,
  defaultSavingsName,
  NEW_SAVINGS_ACCOUNT,
  savingsBase,
  savingsHint,
  savingsInfo,
  savingsLine,
  savingsPace30,
  type SavingsDraft,
  type SavingsInfo,
} from '../savings';
import type { Goal, GoalSavings } from '../model';
import { depositToSavings, setGoalStatus } from '../store';
import { Sheet } from './parts';

// ================= Карточка цели: блок копилки =================

export function SavingsBlock({ goal, onEdit }: { goal: Goal; onEdit: () => void }) {
  const fin = useFinance((s) => s.data);
  const [deposit, setDeposit] = useState(false);
  useEffect(() => void ensureFinance().catch(() => undefined), []);
  const today = todayYmd();
  const s = savingsInfo(goal, fin);
  const pace = goal.savings && !s.missing ? savingsPace30(fin, goal.savings.accountId, s.currency, today) : 0;
  const hint = savingsHint(s, goal.deadline, pace, today);
  const recent = useMemo(() => {
    const id = goal.savings?.accountId;
    if (!fin || !id) return [];
    return fin.transactions
      .filter((t) => t.accountId === id || t.toAccountId === id)
      .sort(sortTx)
      .slice(0, 5);
  }, [fin, goal.savings?.accountId]);

  if (s.loading) return <div className="small muted">Загрузка финансов…</div>;
  if (s.missing)
    return (
      <div className="gl-sv-missing">
        <Warning size={18} />
        <div className="grow">
          <b>{goal.savings ? 'Счёт удалён' : 'Счёт не выбран'}</b>
          <div className="tiny muted">
            {goal.savings ? `Накопить нужно ${fmtMoney(s.amount, s.currency)} — выберите другой счёт-копилку` : 'Выберите счёт, на котором копятся деньги'}
          </div>
        </div>
        <button className="btn btn-sm" onClick={onEdit}>
          Выбрать
        </button>
      </div>
    );

  const acc = s.account!;
  const base = goal.savings?.base ?? 0;
  return (
    <div className="gl-sv">
      <div className="gl-sv-val">
        <b>{fmtNum(s.saved)}</b>
        <span className="muted"> / {fmtMoney(s.amount, s.currency)}</span>
      </div>
      <div className="tiny faint gl-sv-acc">
        {acc.emoji} {acc.name} · на счёте {fmtMoney(s.balance, s.currency)}
        {base > 0 ? ` (${fmtMoney(base, s.currency)} лежали до цели и не считаются)` : ''}
        {acc.archived ? ' · счёт в архиве' : ''}
      </div>
      <SavingsHintBox hint={hint} />
      <div className="gl-sv-actions">
        {goal.status === 'active' && s.reached ? (
          <button className="btn btn-primary" onClick={() => setGoalStatus(goal.id, 'done')}>
            <CheckCircle size={17} /> Завершить цель
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => setDeposit(true)} disabled={goal.status !== 'active'}>
            <Plus size={16} weight="bold" /> Пополнить
          </button>
        )}
        {!s.reached && <span className="tiny faint">Осталось {fmtMoney(s.left, s.currency)}</span>}
      </div>
      {recent.length > 0 && (
        <div className="gl-sv-ops">
          {recent.map((t) => {
            const into = t.toAccountId === acc.id || (t.type === 'income' && t.accountId === acc.id);
            const v = t.toAccountId === acc.id ? (t.toAmount ?? t.amount) : t.amount;
            return (
              <div key={t.id} className="gl-sv-op">
                <span className="grow ellipsis small">{t.note || (t.type === 'transfer' ? 'Перевод' : t.type === 'income' ? 'Доход' : 'Расход')}</span>
                <span className="tiny faint">{dateShort(t.date)}</span>
                <span className={'gl-sv-op-v ' + (into ? 'is-up' : 'is-down')}>{(into ? '+' : '−') + fmtMoney(v, acc.currency)}</span>
              </div>
            );
          })}
        </div>
      )}
      {deposit && (
        <Portal>
          <DepositSheet goal={goal} onClose={() => setDeposit(false)} />
        </Portal>
      )}
    </div>
  );
}

/** Окно поверх всего: вне карточки и вне строки списка (клики не открывают цель) */
function Portal({ children }: { children: ReactNode }) {
  return createPortal(
    <div className="gl-sv-portal" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

function SavingsHintBox({ hint }: { hint: ReturnType<typeof savingsHint> }) {
  return (
    <div className={'gl-sv-hint is-' + hint.kind}>
      <div>{hint.text}</div>
      {hint.sub && <div className="tiny muted">{hint.sub}</div>}
    </div>
  );
}

// ================= Строка карточки в списке =================

/** «12 500 / 200 000 ₸» и кнопка «Пополнить» прямо в списке целей */
export function SavingsCardRow({ goal }: { goal: Goal }) {
  const fin = useFinance((s) => s.data);
  const [deposit, setDeposit] = useState(false);
  const s = savingsInfo(goal, fin);
  if (s.loading) return null;
  const text = s.missing ? (goal.savings ? 'Счёт-копилка удалён' : 'Выберите счёт-копилку') : s.reached ? `Собрано ${fmtMoney(s.saved, s.currency)} 🎉` : savingsLine(s);
  const canAdd = !s.missing && !s.reached && goal.status === 'active';
  return (
    <span className={'gl-card-next gl-card-sv' + (s.missing ? ' is-missing' : '')}>
      <span className="ellipsis">{text}</span>
      {canAdd && (
        <button
          type="button"
          className="gl-sv-quick"
          onClick={(e) => {
            e.stopPropagation();
            setDeposit(true);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Plus size={13} weight="bold" /> Пополнить
        </button>
      )}
      {deposit && (
        <Portal>
          <DepositSheet goal={goal} onClose={() => setDeposit(false)} />
        </Portal>
      )}
    </span>
  );
}

/** Окно «Пополнить» поверх всего (меню строки цели в списке) */
export function DepositPortal({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  return (
    <Portal>
      <DepositSheet goal={goal} onClose={onClose} />
    </Portal>
  );
}

// ================= Пополнение =================

function DepositSheet({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const fin = useFinance((s) => s.data);
  const s = savingsInfo(goal, fin);
  const target = s.account;
  const sources = fin && target ? sortedAccounts(fin).filter((a) => a.id !== target.id) : [];
  const last = fin?.prefs.lastAccountId;
  const [fromId, setFromId] = useState(sources.find((a) => a.id === last)?.id ?? sources[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  if (!fin || !target) return null;
  const from = sources.find((a) => a.id === fromId);
  const cross = !!from && from.currency !== target.currency;
  const v = parseMoneyInput(amount);
  // примерная сумма зачисления по курсам Финансов (если курсы заданы)
  const ratesKnown = cross && toMain(1, from.currency, fin.prefs) !== null && toMain(1, target.currency, fin.prefs) !== null;
  const est = ratesKnown && v > 0 ? r2(convertCur(v, from.currency, target.currency, fin.prefs)) : 0;
  const pace = savingsPace30(fin, target.id, s.currency, todayYmd());
  const hint = savingsHint(s, goal.deadline, pace);
  // быстрые суммы: «по плану» и «всё, что осталось»
  const quick = [...new Set([hint.suggest ?? 0, s.left].filter((x) => x > 0))];

  const save = () => {
    if (!(v > 0)) return toast('Введите сумму');
    if (!from) return toast('Выберите, откуда перевести');
    let tv: number | undefined;
    if (cross) {
      tv = toAmount.trim() ? parseMoneyInput(toAmount) : est;
      if (!(tv && tv > 0)) return toast(`Сколько зачислено в ${curSymbol(target.currency)}?`);
    }
    if (depositToSavings(goal.id, from.id, v, tv)) onClose();
  };

  return (
    <Sheet onClose={onClose} title="Пополнить копилку" className="gl-sv-sheet">
      <div className="gl-sv-to">
        <span className="gl-sv-to-emoji">{target.emoji}</span>
        <div className="grow">
          <div className="ellipsis">
            <b>{target.name}</b>
          </div>
          <div className="tiny muted">
            {goal.emoji} {goal.title} · {savingsLine(s)}
          </div>
        </div>
      </div>

      <label className="label">Сумма, {curSymbol(from?.currency ?? target.currency)}</label>
      <div className="gl-sv-amount">
        <input
          className="input"
          inputMode="decimal"
          enterKeyHint="done"
          placeholder="4 500 или 4,5к"
          value={amount}
          autoFocus
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button type="button" className="btn gl-sv-000" onClick={() => setAmount((a) => (a.trim() ? a.trim() + '000' : a))} aria-label="Добавить три нуля">
          000
        </button>
      </div>
      {quick.length > 0 && !cross && (
        <div className="gl-chips gl-sv-chips">
          {quick.map((x) => (
            <button key={x} type="button" className="chip" onClick={() => setAmount(fmtNum(x))}>
              {fmtMoney(x, target.currency)}
              {x === s.left ? ' · всё' : ' · по плану'}
            </button>
          ))}
        </div>
      )}

      <label className="label">Откуда</label>
      {sources.length === 0 ? (
        <div className="small muted">Нет других счетов — добавьте счёт в разделе «Финансы».</div>
      ) : (
        <div className="gl-sv-list">
          {sources.map((a) => (
            <button key={a.id} type="button" className={'gl-sv-row' + (a.id === fromId ? ' active' : '')} onClick={() => setFromId(a.id)}>
              <span className="gl-sv-row-emoji">{a.emoji}</span>
              <span className="grow ellipsis">{a.name}</span>
              <span className="tiny muted">{fmtMoney(accountBalance(fin, a.id), a.currency)}</span>
              {a.id === fromId && <Check size={16} weight="bold" className="gl-sv-check" />}
            </button>
          ))}
        </div>
      )}

      {cross && (
        <>
          <label className="label">Зачислено в копилку, {curSymbol(target.currency)}</label>
          <input className="input" inputMode="decimal" placeholder={est ? fmtNum(est) : '0'} value={toAmount} onChange={(e) => setToAmount(e.target.value)} />
        </>
      )}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!sources.length}>
          <ArrowsLeftRight size={16} /> {v > 0 && from ? `Перевести ${fmtMoney(v, from.currency)}` : 'Пополнить'}
        </button>
      </div>
    </Sheet>
  );
}

// ================= Редактор цели =================

/** Поля режима «Копилка»: счёт, сумма, учёт начального остатка и подсказка по сроку */
export function SavingsFields({ draft, onChange, prev, deadline, title }: { draft: SavingsDraft; onChange: (d: SavingsDraft) => void; prev?: GoalSavings; deadline: string; title: string }) {
  const fin = useFinance((s) => s.data);
  useEffect(() => void ensureFinance().catch(() => undefined), []);
  if (!fin) return <div className="small muted">Загрузка финансов…</div>;
  const set = (p: Partial<SavingsDraft>) => onChange({ ...draft, ...p });
  const accounts = sortedAccounts(fin, true).filter((a) => !a.archived || a.id === prev?.accountId);
  const acc = fin.accounts.find((a) => a.id === draft.accountId);
  const isNew = draft.accountId === NEW_SAVINGS_ACCOUNT;
  const cur = acc?.currency ?? (isNew ? draft.newCurrency || fin.prefs.mainCurrency : fin.prefs.mainCurrency);
  const bal = acc ? accountBalance(fin, acc.id) : 0;
  const amount = parseMoneyInput(draft.amount);
  // предпросмотр подсказки
  const base = acc ? savingsBase(draft, prev, bal) : 0;
  const saved = Math.max(0, bal - (base ?? 0));
  const preview: SavingsInfo | null =
    amount > 0 && (acc || isNew)
      ? { loading: false, missing: false, currency: cur, amount, balance: bal, saved, left: Math.max(0, amount - saved), pct: 0, reached: saved >= amount }
      : null;
  const pace = acc ? savingsPace30(fin, acc.id, cur) : 0;
  const hint = preview ? savingsHint(preview, deadline || undefined, pace) : null;

  return (
    <div className="gl-sv-fields">
      <label className="label">Счёт-копилка</label>
      <div className="gl-sv-list">
        {accounts.map((a) => (
          <button key={a.id} type="button" className={'gl-sv-row' + (a.id === draft.accountId ? ' active' : '')} onClick={() => set({ accountId: a.id })}>
            <span className="gl-sv-row-emoji">{a.emoji}</span>
            <span className="grow ellipsis">{a.name}</span>
            <span className="tiny muted">{fmtMoney(accountBalance(fin, a.id), a.currency)}</span>
            {a.id === draft.accountId && <Check size={16} weight="bold" className="gl-sv-check" />}
          </button>
        ))}
        <button type="button" className={'gl-sv-row' + (isNew ? ' active' : '')} onClick={() => set({ accountId: NEW_SAVINGS_ACCOUNT })}>
          <span className="gl-sv-row-emoji">🐷</span>
          <span className="grow ellipsis">Создать новый счёт-копилку</span>
          {isNew && <Check size={16} weight="bold" className="gl-sv-check" />}
        </button>
      </div>
      {isNew && (
        <div className="gl-grid2">
          <div>
            <label className="label">Название счёта</label>
            <input className="input" value={draft.newName} placeholder={defaultSavingsName(title)} maxLength={60} onChange={(e) => set({ newName: e.target.value })} />
          </div>
          <div>
            <label className="label">Валюта</label>
            <select className="select" value={draft.newCurrency || fin.prefs.mainCurrency} onChange={(e) => set({ newCurrency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} {c.code}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <label className="label">Сколько накопить, {curSymbol(cur)}</label>
      <input className="input" inputMode="decimal" placeholder="Например, 200 000 или 200к" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} />
      {acc && bal > 0 && (
        <label className="row gl-sv-check-row">
          <input type="checkbox" checked={draft.countExisting} onChange={(e) => set({ countExisting: e.target.checked })} />
          <span>
            Засчитать то, что уже лежит на счёте ({fmtMoney(bal, acc.currency)})
            {!draft.countExisting && <span className="tiny muted"> — прогресс начнётся с нуля, считаются только новые пополнения</span>}
          </span>
        </label>
      )}
      {hint && hint.kind !== 'idle' && <SavingsHintBox hint={hint} />}
      <div className="tiny faint">Откладывайте переводом на этот счёт в «Финансах» или кнопкой «Пополнить» — прогресс посчитается сам.</div>
    </div>
  );
}
