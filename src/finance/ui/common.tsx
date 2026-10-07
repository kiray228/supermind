import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowsLeftRight, CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import { addDaysYmd, fromYmd, todayYmd } from '../../utils/mapTasks';
import {
  budgetLevel,
  COLORS,
  CURRENCIES,
  dateLong,
  EMOJIS,
  fmtMoney,
  WD_SHORT,
  type Account,
  type Category,
  type Transaction,
} from '../model';

/** Окно (на телефоне — шторка снизу). Закрывается по затемнению, Escape и кнопке «Назад» Android */
export function Sheet(props: { title: ReactNode; onClose: () => void; children: ReactNode; className?: string; actions?: ReactNode; head?: ReactNode }) {
  const { title, onClose, children, className, actions, head } = props;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal fn-modal ' + (className ?? '')} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row fn-modal-head">
          <h2 className="grow ellipsis">{title}</h2>
          {head}
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X />
          </button>
        </div>
        {children}
        {actions && <div className="modal-actions fn-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function CatIcon({ emoji, color, size = 36 }: { emoji: string; color: string; size?: number }) {
  return (
    <span className="fn-cat-ic" style={{ '--c': color, width: size, height: size, fontSize: Math.round(size * 0.5) } as CSSProperties}>
      {emoji}
    </span>
  );
}

export function Money({ v, cur, sign, className, compact }: { v: number; cur: string; sign?: boolean; className?: string; compact?: boolean }) {
  return <span className={'fn-money ' + (className ?? '')}>{fmtMoney(v, cur, { sign, compact })}</span>;
}

/** Полоса бюджета: зелёная → оранжевая (≥80%) → красная (>100%) */
export function Progress({ spent, limit, thin }: { spent: number; limit: number; thin?: boolean }) {
  const lvl = budgetLevel(spent, limit);
  const p = limit > 0 ? Math.min(100, (spent / limit) * 100) : spent > 0 ? 100 : 0;
  return (
    <div className={`fn-progress is-${lvl}` + (thin ? ' is-thin' : '')} role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${p}%` }} />
    </div>
  );
}

export function dayTitle(ymd: string): string {
  const t = todayYmd();
  if (ymd === t) return 'Сегодня';
  if (ymd === addDaysYmd(t, -1)) return 'Вчера';
  return `${dateLong(ymd)}, ${WD_SHORT[fromYmd(ymd).getDay()]}`;
}

export function TxRow(props: { tx: Transaction; accs: Map<string, Account>; cats: Map<string, Category>; onClick?: () => void; showDate?: boolean }) {
  const { tx, accs, cats, onClick, showDate } = props;
  const acc = accs.get(tx.accountId);
  const cur = acc?.currency ?? '';
  const cat = tx.categoryId ? cats.get(tx.categoryId) : undefined;
  if (tx.type === 'transfer') {
    const to = tx.toAccountId ? accs.get(tx.toAccountId) : undefined;
    const diff = to && to.currency !== cur;
    return (
      <button className="fn-tx" onClick={onClick}>
        <span className="fn-cat-ic fn-transfer-ic">
          <ArrowsLeftRight size={17} />
        </span>
        <span className="fn-tx-main">
          <span className="fn-tx-title ellipsis">{tx.note || 'Перевод'}</span>
          <span className="fn-tx-sub ellipsis">
            {acc?.name ?? '—'} → {to?.name ?? '—'}
            {showDate ? ' · ' + dayTitle(tx.date) : ''}
          </span>
        </span>
        <span className="fn-tx-amt">
          <span className="fn-money">{fmtMoney(tx.amount, cur)}</span>
          {diff && <span className="tiny faint">{fmtMoney(tx.toAmount ?? tx.amount, to.currency)}</span>}
        </span>
      </button>
    );
  }
  const sub = [cat && tx.note ? cat.name : '', acc?.name, showDate ? dayTitle(tx.date) : '', tx.time, ...tx.tags.map((g) => '#' + g)].filter(Boolean).join(' · ');
  return (
    <button className="fn-tx" onClick={onClick}>
      <CatIcon emoji={cat?.emoji ?? (tx.type === 'income' ? '💰' : '📦')} color={cat?.color ?? '#64748b'} />
      <span className="fn-tx-main">
        <span className="fn-tx-title ellipsis">{tx.note || cat?.name || 'Без категории'}</span>
        <span className="fn-tx-sub ellipsis">{sub}</span>
      </span>
      <span className={'fn-tx-amt' + (tx.type === 'income' ? ' is-income' : '')}>
        <span className="fn-money">{fmtMoney(tx.type === 'income' ? tx.amount : -tx.amount, cur, { sign: true })}</span>
      </span>
    </button>
  );
}

export function CurrencySelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const known = CURRENCIES.some((c) => c.code === value);
  return (
    <select className={'select ' + (className ?? '')} value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value={value}>{value}</option>}
      {CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.symbol} {c.code} — {c.name}
        </option>
      ))}
    </select>
  );
}

export function EmojiPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="fn-emoji-pick">
      <input className="input fn-emoji-input" value={value} onChange={(e) => onChange([...e.target.value].slice(-2).join(''))} aria-label="Эмодзи" />
      <div className="fn-emoji-grid">
        {EMOJIS.map((e) => (
          <button type="button" key={e} className={'fn-emoji' + (e === value ? ' active' : '')} onClick={() => onChange(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorDots({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="fn-colors">
      {COLORS.map((c) => (
        <button type="button" key={c} className={'fn-color' + (c === value ? ' active' : '')} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
    </div>
  );
}

/** Поле суммы: десятичная клавиатура на телефоне */
export function AmountInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; className?: string; onEnter?: () => void; onBlur?: () => void }) {
  return (
    <input
      className={'input fn-amount-input ' + (props.className ?? '')}
      inputMode="decimal"
      enterKeyHint="done"
      placeholder={props.placeholder ?? '0'}
      value={props.value}
      autoFocus={props.autoFocus}
      onChange={(e) => props.onChange(e.target.value.replace(/[^\d.,+\-\s]/g, ''))}
      onKeyDown={(e) => e.key === 'Enter' && props.onEnter?.()}
      onBlur={props.onBlur}
    />
  );
}

/** Переключатель «‹ Октябрь ›» */
export function Stepper({ label, onPrev, onNext, onLabel }: { label: ReactNode; onPrev: () => void; onNext: () => void; onLabel?: () => void }) {
  return (
    <div className="fn-stepper">
      <button className="icon-btn" onClick={onPrev} aria-label="Назад">
        <CaretLeft />
      </button>
      <button className="fn-stepper-label" onClick={onLabel} disabled={!onLabel}>
        {label}
      </button>
      <button className="icon-btn" onClick={onNext} aria-label="Вперёд">
        <CaretRight />
      </button>
    </div>
  );
}

/** Итоги по валютам в одну строку: «120 000 ₸ · 300 $» */
export function CurTotals({ totals, sign, className }: { totals: Record<string, number>; sign?: boolean; className?: string }) {
  const e = Object.entries(totals);
  if (!e.length) return <span className={className}>0</span>;
  return (
    <span className={'fn-cur-totals ' + (className ?? '')}>
      {e.map(([c, v]) => (
        <span key={c} className="fn-money">
          {fmtMoney(v, c, { sign })}
        </span>
      ))}
    </span>
  );
}

/** Текущее время каждые N секунд (для «сегодня» после полуночи) */
export function useToday(): string {
  const [t, setT] = useState(todayYmd);
  useEffect(() => {
    const id = setInterval(() => setT(todayYmd()), 60_000);
    return () => clearInterval(id);
  }, []);
  return t;
}
