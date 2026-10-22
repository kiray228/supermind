/** Кольцо трат по категориям за неделю, месяц или год. Нажатие на часть или строку — выделить категорию и её траты */
import { useMemo, useState, type ReactNode } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { categoryMap, fmtMoney, periodRange, summarize, type FinanceData } from '../model';
import { showOps } from './state';
import { useToday } from './common';

type Period = 'week' | 'month' | 'year';
const PERIODS: { id: Period; label: string; sub: string }[] = [
  { id: 'week', label: 'Неделя', sub: 'за неделю' },
  { id: 'month', label: 'Месяц', sub: 'за месяц' },
  { id: 'year', label: 'Год', sub: 'за год' },
];
const PERIOD_KEY = 'sm-fin-ring-period';
/** сколько категорий показывать отдельно; остальные — «Остальное» */
const TOP = 6;
const REST_COLOR = '#8e8e93';

interface Slice {
  id: string;
  name: string;
  emoji: string;
  color: string;
  value: number;
  /** id категорий (у «Остального» — несколько) */
  ids: string[];
}

function readPeriod(): Period {
  try {
    const p = localStorage.getItem(PERIOD_KEY);
    return p === 'week' || p === 'year' ? p : 'month';
  } catch {
    return 'month';
  }
}

export function SpendRing({ data }: { data: FinanceData }) {
  const today = useToday();
  const [period, setPeriodState] = useState<Period>(readPeriod);
  const [sel, setSel] = useState<string | null>(null);
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    setSel(null);
    try {
      localStorage.setItem(PERIOD_KEY, p);
    } catch {
      /* без памяти */
    }
  };
  const main = data.prefs.mainCurrency;
  const range = useMemo(() => periodRange(period, today), [period, today]);
  const slices = useMemo<Slice[]>(() => {
    const sum = summarize(data, range);
    const cats = categoryMap(data);
    const all = [...sum.byCat.entries()]
      .filter(([, v]) => v > 0)
      .map(([id, v]) => {
        const c = cats.get(id);
        return { id, name: c?.name ?? 'Без категории', emoji: c?.emoji ?? '•', color: c?.color ?? REST_COLOR, value: v, ids: [id] };
      })
      .sort((a, b) => b.value - a.value);
    if (all.length <= TOP + 1) return all;
    const rest = all.slice(TOP);
    return [...all.slice(0, TOP), { id: '__rest', name: 'Остальное', emoji: '⋯', color: REST_COLOR, value: rest.reduce((a, s) => a + s.value, 0), ids: rest.map((s) => s.id) }];
  }, [data, range]);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const picked = slices.find((s) => s.id === sel) ?? null;
  const label = PERIODS.find((p) => p.id === period)!;

  const openOps = (s: Slice | null) =>
    showOps({ type: 'expense', period: 'custom', from: range.from, to: range.to, ...(s && s.ids.length === 1 ? { categoryId: s.ids[0] } : {}) });

  return (
    <section className="card fn-panel fn-ring-panel">
      <div className="segmented fn-ring-periods" role="tablist" aria-label="Период">
        {PERIODS.map((p) => (
          <button key={p.id} role="tab" aria-selected={period === p.id} className={period === p.id ? 'active' : ''} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {total > 0 ? (
        <>
          <Ring slices={slices} total={total} sel={sel} onPick={(id) => setSel(sel === id ? null : id)}>
            {picked ? (
              <>
                <small>
                  {picked.emoji} {picked.name}
                </small>
                <b>{fmtMoney(picked.value, main, { compact: picked.value >= 1e6 })}</b>
                <em>{Math.round((picked.value / total) * 100)}% расходов</em>
              </>
            ) : (
              <>
                <small>Расходы</small>
                <b>{fmtMoney(total, main, { compact: total >= 1e6 })}</b>
                <em>{label.sub}</em>
              </>
            )}
          </Ring>
          <div className="fn-ring-list" role="list">
            {slices.map((s) => (
              <button key={s.id} role="listitem" className={`fn-ring-row${sel === s.id ? ' is-sel' : ''}${sel && sel !== s.id ? ' is-dim' : ''}`} onClick={() => setSel(sel === s.id ? null : s.id)}>
                <i style={{ background: s.color }} />
                <span className="fn-ring-name">
                  {s.emoji} {s.name}
                </span>
                <span className="fn-ring-pct">{Math.round((s.value / total) * 100)}%</span>
                <b>{fmtMoney(s.value, main, { compact: s.value >= 1e6 })}</b>
              </button>
            ))}
          </div>
          <button className="fn-link small fn-ring-ops" onClick={() => openOps(picked)}>
            {picked ? `Траты: ${picked.name}` : 'Все траты ' + label.sub} <CaretRight size={13} weight="bold" />
          </button>
        </>
      ) : (
        <p className="small muted fn-m0 fn-ring-empty">Трат {label.sub} пока нет — кольцо покажет, на что уходят деньги.</p>
      )}
    </section>
  );
}

function Ring({ slices, total, sel, onPick, children }: { slices: Slice[]; total: number; sel: string | null; onPick: (id: string) => void; children: ReactNode }) {
  const size = 188;
  const width = 24;
  const r = (size - width) / 2 - 6;
  const C = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 2.5 : 0;
  let off = 0;
  return (
    <div className="fn-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {slices.map((s) => {
          const len = (s.value / total) * C;
          const w = sel === s.id ? width + 8 : width;
          const el = (
            <circle
              key={s.id}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={w}
              strokeDasharray={`${Math.max(len - gap, 0.6)} ${C}`}
              strokeDashoffset={-off}
              opacity={sel && sel !== s.id ? 0.3 : 1}
              className="fn-ring-seg"
              onClick={() => onPick(s.id)}
            />
          );
          off += len;
          return el;
        })}
      </svg>
      <div className="fn-ring-ctr">{children}</div>
    </div>
  );
}
