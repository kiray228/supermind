import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CalendarDots, PiggyBank, Sparkle, TrendDown, TrendUp } from '@phosphor-icons/react';
import { addDaysYmd, fromYmd } from '../../utils/mapTasks';
import { toast } from '../../store/appStore';
import { AIError } from '../../ai/claude';
import {
  accountMap,
  addMonthsYmd,
  categoryMap,
  daysBetweenYmd,
  daysInMonth,
  fmtMoney,
  monthEnd,
  monthStart,
  monthTitle,
  MONTHS_SHORT,
  periodRange,
  rangeLabel,
  shiftAnchor,
  sortTx,
  summarize,
  type CatKind,
  type FinanceData,
  type PeriodKind,
  type Range,
} from '../model';
import { runFinanceAi } from '../ai';
import { IconTile } from '../../ui/icons';
import { dayTitle, Money, Sheet, Stepper, TxRow, useToday } from './common';
import { openTxSheet, showOps } from './state';

export function Analytics({ data }: { data: FinanceData }) {
  const today = useToday();
  const [kind, setKind] = useState<PeriodKind>('month');
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState<Range>({ from: monthStart(today), to: today });
  const [donutKind, setDonutKind] = useState<CatKind>('expense');
  const [ai, setAi] = useState(false);
  const main = data.prefs.mainCurrency;
  const range = kind === 'custom' ? { from: custom.from <= custom.to ? custom.from : custom.to, to: custom.to >= custom.from ? custom.to : custom.from } : periodRange(kind, anchor);
  const s = useMemo(() => summarize(data, range), [data, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const cats = useMemo(() => categoryMap(data), [data]);

  // дней в периоде (для текущего периода — до сегодняшнего дня)
  const lastDay = range.to > today && range.from <= today ? today : range.to;
  const days = Math.max(1, daysBetweenYmd(range.from, lastDay) + 1);
  const savings = s.income > 0 ? Math.round(((s.income - s.expense) / s.income) * 100) : null;

  const byCat = donutKind === 'expense' ? s.byCat : s.incByCat;
  const total = donutKind === 'expense' ? s.expense : s.income;
  const slices = [...byCat]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => {
      const c = id ? cats.get(id) : undefined;
      return { id, v, name: c?.name ?? 'Без категории', emoji: c?.emoji ?? '❔', color: c?.color ?? '#94a3b8' };
    });

  const heatMonth = kind === 'month' ? monthStart(anchor) : monthStart(range.to < today ? range.to : today);

  return (
    <div className="fn-stack">
      <div className="fn-period">
        <div className="segmented fn-seg-wide">
          {(
            [
              ['week', 'Неделя'],
              ['month', 'Месяц'],
              ['year', 'Год'],
              ['custom', 'Свой'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
        {kind === 'custom' ? (
          <div className="fn-filter-dates">
            <input type="date" className="input" value={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label="С" />
            <span className="faint">—</span>
            <input type="date" className="input" value={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label="По" />
          </div>
        ) : (
          <Stepper
            label={rangeLabel(kind, range)}
            onPrev={() => setAnchor(shiftAnchor(kind, anchor, -1))}
            onNext={() => setAnchor(shiftAnchor(kind, anchor, 1))}
            onLabel={range.from <= today && today <= range.to ? undefined : () => setAnchor(today)}
          />
        )}
      </div>

      <div className="card fn-stats">
        <Stat icon={<TrendDown size={15} weight="bold" />} label="Расходы" tone="expense" value={fmtMoney(s.expense, main, { compact: true })} />
        <Stat icon={<TrendUp size={15} weight="bold" />} label="Доходы" tone="income" value={fmtMoney(s.income, main, { compact: true })} />
        <Stat icon={<CalendarDots size={15} weight="bold" />} label="В среднем в день" value={fmtMoney(s.expense / days, main, { compact: true })} />
        <Stat
          icon={<PiggyBank size={15} weight="bold" />}
          label="Норма сбережений"
          tone={savings !== null && savings < 0 ? 'expense' : undefined}
          value={savings === null ? '—' : `${savings}%`}
        />
      </div>

      <section className="card fn-panel">
        <div className="fn-panel-head">
          <h3>По категориям</h3>
          <div className="segmented fn-seg-sm">
            <button className={donutKind === 'expense' ? 'active' : ''} onClick={() => setDonutKind('expense')}>
              Расходы
            </button>
            <button className={donutKind === 'income' ? 'active' : ''} onClick={() => setDonutKind('income')}>
              Доходы
            </button>
          </div>
        </div>
        {slices.length === 0 ? (
          <p className="small muted fn-m0">За этот период {donutKind === 'expense' ? 'расходов' : 'доходов'} нет.</p>
        ) : (
          <div className="fn-donut-wrap">
            <Donut slices={slices} total={total} cur={main} />
            <div className="fn-top-cats">
              {slices.slice(0, 8).map((x) => (
                <button key={x.id || '-'} className="fn-top-cat" onClick={() => showOps({ type: donutKind, categoryId: x.id || '-', period: 'custom', from: range.from, to: range.to })}>
                  <span className="fn-dot" style={{ background: x.color }} />
                  <span>{x.emoji}</span>
                  <span className="grow ellipsis">{x.name}</span>
                  <span className="tiny faint">{Math.round((x.v / total) * 100)}%</span>
                  <Money v={x.v} cur={main} className="small" />
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <MonthBars data={data} endMonth={monthStart(range.to)} />

      <Heatmap data={data} initial={heatMonth} key={heatMonth} />

      <section className="card fn-panel fn-ai-card">
        <div className="row">
          <IconTile icon={Sparkle} section="assistant" size="sm" />
          <span className="grow fn-ai-card-text">
            <span className="fn-ai-card-title">ИИ-разбор месяца</span>
            <span className="fn-ai-card-sub">Claude разберёт траты за {monthTitle(heatMonth).toLowerCase()} и подскажет, где сэкономить.</span>
          </span>
          <button className="btn btn-sm btn-tinted" onClick={() => setAi(true)}>
            Разобрать
          </button>
        </div>
      </section>
      {ai && <AiSheet data={data} month={heatMonth} onClose={() => setAi(false)} />}
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: 'income' | 'expense' }) {
  return (
    <div className={'fn-stat' + (tone ? ` is-${tone}` : '')}>
      <span className="fn-stat-label">
        <span className="fn-stat-ic">{icon}</span>
        {label}
      </span>
      <span className="fn-stat-val">{value}</span>
    </div>
  );
}

// ---------- Кольцевая диаграмма ----------

function Donut({ slices, total, cur }: { slices: { id: string; v: number; color: string; name: string }[]; total: number; cur: string }) {
  const R = 70;
  const C = 2 * Math.PI * R;
  // мелкие категории — в «Остальное»
  const top = slices.slice(0, 9);
  const rest = slices.slice(9).reduce((a, x) => a + x.v, 0);
  const parts = rest > 0 ? [...top, { id: 'rest', v: rest, color: '#94a3b8', name: 'Остальное' }] : top;
  const gap = parts.length > 1 ? 2 : 0;
  let off = 0;
  return (
    <div className="fn-donut">
      <svg viewBox="0 0 180 180" role="img" aria-label="Расходы по категориям">
        <circle cx="90" cy="90" r={R} className="fn-donut-bg" />
        {parts.map((p) => {
          const len = (p.v / total) * C;
          const seg = (
            <circle
              key={p.id || '-'}
              cx="90"
              cy="90"
              r={R}
              className="fn-donut-seg"
              style={{ stroke: p.color }}
              strokeDasharray={`${Math.max(0.5, len - gap)} ${C}`}
              strokeDashoffset={-off}
              transform="rotate(-90 90 90)"
            >
              <title>{`${p.name}: ${fmtMoney(p.v, cur)}`}</title>
            </circle>
          );
          off += len;
          return seg;
        })}
      </svg>
      <div className="fn-donut-center">
        <span className="tiny faint">Всего</span>
        <b>{fmtMoney(total, cur, { compact: true })}</b>
      </div>
    </div>
  );
}

// ---------- Доходы и расходы по месяцам ----------

function MonthBars({ data, endMonth }: { data: FinanceData; endMonth: string }) {
  const [n, setN] = useState(6);
  const main = data.prefs.mainCurrency;
  const months = useMemo(() => {
    const out: { m: string; inc: number; exp: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const m = addMonthsYmd(endMonth, -i);
      const s = summarize(data, { from: m, to: monthEnd(m) });
      out.push({ m, inc: s.income, exp: s.expense });
    }
    return out;
  }, [data, endMonth, n]);
  const max = Math.max(1, ...months.flatMap((x) => [x.inc, x.exp]));
  const W = 600, H = 190, top = 10, bottom = 24;
  const colW = W / months.length;
  const bw = Math.min(22, colW / 3);
  const h = (v: number) => ((H - top - bottom) * v) / max;
  const avgExp = months.reduce((a, x) => a + x.exp, 0) / months.length;

  return (
    <section className="card fn-panel">
      <div className="fn-panel-head">
        <h3>Доходы и расходы</h3>
        <div className="segmented fn-seg-sm">
          <button className={n === 6 ? 'active' : ''} onClick={() => setN(6)}>
            6 мес
          </button>
          <button className={n === 12 ? 'active' : ''} onClick={() => setN(12)}>
            12 мес
          </button>
        </div>
      </div>
      <svg className="fn-bars" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Доходы и расходы по месяцам">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1="0" x2={W} y1={H - bottom - (H - top - bottom) * f} y2={H - bottom - (H - top - bottom) * f} className="fn-grid" />
        ))}
        <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} className="fn-axis" />
        {months.map((x, i) => {
          const cx = colW * i + colW / 2;
          return (
            <g key={x.m}>
              <rect x={cx - bw - 1} y={H - bottom - h(x.inc)} width={bw} height={h(x.inc)} rx="4" ry="4" className="fn-bar-inc">
                <title>{`${monthTitle(x.m)}: доходы ${fmtMoney(x.inc, main)}`}</title>
              </rect>
              <rect x={cx + 1} y={H - bottom - h(x.exp)} width={bw} height={h(x.exp)} rx="4" ry="4" className="fn-bar-exp">
                <title>{`${monthTitle(x.m)}: расходы ${fmtMoney(x.exp, main)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="fn-bars-labels" style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}>
        {months.map((x) => (
          <span key={x.m}>{MONTHS_SHORT[fromYmd(x.m).getMonth()]}</span>
        ))}
      </div>
      <div className="row tiny muted fn-legend">
        <span className="fn-dot fn-dot-inc" /> Доходы
        <span className="fn-dot fn-dot-exp" /> Расходы
        <span className="grow" />
        <span>В среднем расходы: {fmtMoney(avgExp, main, { compact: true })}/мес</span>
      </div>
    </section>
  );
}

// ---------- Календарь трат ----------

function Heatmap({ data, initial }: { data: FinanceData; initial: string }) {
  const today = useToday();
  const [month, setMonth] = useState(initial);
  const [day, setDay] = useState<string | null>(null);
  const main = data.prefs.mainCurrency;
  const s = useMemo(() => summarize(data, { from: month, to: monthEnd(month) }), [data, month]);
  const max = Math.max(1, ...s.byDay.values());
  const lead = (fromYmd(month).getDay() + 6) % 7;
  const dim = daysInMonth(month);
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: dim }, (_, i) => addDaysYmd(month, i))];

  return (
    <section className="card fn-panel">
      <div className="fn-panel-head">
        <h3>Календарь трат</h3>
        <Stepper label={monthTitle(month)} onPrev={() => setMonth(addMonthsYmd(month, -1))} onNext={() => setMonth(addMonthsYmd(month, 1))} />
      </div>
      <div className="fn-heat">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w) => (
          <span key={w} className="fn-heat-wd">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={'e' + i} />;
          const v = s.byDay.get(d) ?? 0;
          const pct = v > 0 ? Math.round(12 + (v / max) * 78) : 0;
          return (
            <button
              key={d}
              className={'fn-heat-cell' + (d === today ? ' is-today' : '') + (pct > 55 ? ' is-strong' : '') + (d > today ? ' is-future' : '')}
              style={{ '--p': `${pct}%` } as CSSProperties}
              onClick={() => setDay(d)}
              title={v ? fmtMoney(v, main) : 'Нет трат'}
            >
              <span className="fn-heat-n">{Number(d.slice(8))}</span>
              {v > 0 && <span className="fn-heat-v">{shortNum(v)}</span>}
            </button>
          );
        })}
      </div>
      <div className="tiny faint">Всего за месяц: {fmtMoney(s.expense, main)} · нажмите на день, чтобы увидеть операции</div>
      {day && <DaySheet data={data} day={day} onClose={() => setDay(null)} />}
    </section>
  );
}

/** Коротко для ячейки календаря: 850 / 12к / 1,2м */
function shortNum(v: number): string {
  if (v >= 1e6) return (Math.round(v / 1e5) / 10).toString().replace('.', ',') + 'м';
  if (v >= 1000) return (v >= 1e4 ? Math.round(v / 1000) : Math.round(v / 100) / 10).toString().replace('.', ',') + 'к';
  return String(Math.round(v));
}

function DaySheet({ data, day, onClose }: { data: FinanceData; day: string; onClose: () => void }) {
  const accs = useMemo(() => accountMap(data), [data]);
  const cats = useMemo(() => categoryMap(data), [data]);
  const list = data.transactions.filter((t) => t.date === day).sort(sortTx);
  const s = summarize(data, { from: day, to: day });
  const main = data.prefs.mainCurrency;
  return (
    <Sheet title={dayTitle(day)} onClose={onClose}>
      <div className="row small fn-day-sum">
        {s.expense > 0 && <span className="fn-neg">Расходы: {fmtMoney(s.expense, main)}</span>}
        {s.income > 0 && <span className="fn-pos">Доходы: {fmtMoney(s.income, main)}</span>}
      </div>
      {list.length ? (
        <div className="fn-list">
          {list.map((t) => (
            <TxRow key={t.id} tx={t} accs={accs} cats={cats} onClick={() => openTxSheet({ tx: t })} />
          ))}
        </div>
      ) : (
        <p className="muted">В этот день операций нет.</p>
      )}
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={() => openTxSheet({ preset: { date: day } })}>
          Добавить операцию
        </button>
      </div>
    </Sheet>
  );
}

// ---------- ИИ-разбор ----------

function AiSheet({ data, month, onClose }: { data: FinanceData; month: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(true);
  const ctl = useRef<AbortController | null>(null);
  const dataRef = useRef(data);

  useEffect(() => {
    const c = new AbortController();
    ctl.current = c;
    runFinanceAi(dataRef.current, month, setText, c.signal)
      .then(() => setBusy(false))
      .catch((e) => {
        setBusy(false);
        if (c.signal.aborted) return;
        toast(e instanceof AIError ? e.message : 'Не удалось получить ответ ИИ');
        onClose();
      });
    return () => c.abort();
  }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet
      title={`ИИ-разбор: ${monthTitle(month)}`}
      onClose={onClose}
      className="fn-ai-sheet"
      actions={
        busy ? (
          <button className="btn" onClick={() => ctl.current?.abort()}>
            Остановить
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        )
      }
    >
      {!text && busy && <p className="muted">Claude анализирует ваши траты…</p>}
      <div className="fn-ai-text">{renderMd(text)}</div>
    </Sheet>
  );
}

function inline(s: string): ReactNode[] {
  return s.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));
}

function renderMd(text: string): ReactNode[] {
  return text.split('\n').map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} className="fn-ai-gap" />;
    const h = t.match(/^#{1,4}\s+(.*)$/);
    if (h) return <h4 key={i}>{inline(h[1])}</h4>;
    const li = t.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) return <div key={i} className="fn-ai-li">{inline(li[1])}</div>;
    return <p key={i}>{inline(t)}</p>;
  });
}
