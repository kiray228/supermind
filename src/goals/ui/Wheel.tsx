import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { BellSlash, ChartPieSlice, Plus, Target, Trash } from '@phosphor-icons/react';
import { IconTile } from '../../ui/icons';
import { toast } from '../../store/appStore';
import { confirmDialog } from '../../ui/dialogs';
import { daysBetween, plural } from '../../tasks/model';
import { todayYmd } from '../../utils/mapTasks';
import { fullDate, sortedAreas, weakestAreas, wheelAverage, wheelDue, wheelSorted, type GoalsData, type LifeArea, type WheelSnapshot } from '../model';
import { deleteWheel, saveWheel, setGoalsPrefs } from '../store';
import { Sheet } from './parts';

const CX = 150;
const R = 118;

function pt(angle: number, r: number): string {
  return `${(CX + r * Math.cos(angle)).toFixed(2)} ${(CX + r * Math.sin(angle)).toFixed(2)}`;
}

function wedge(a0: number, a1: number, r: number): string {
  if (r <= 0) return '';
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${CX} ${CX} L ${pt(a0, r)} A ${r} ${r} 0 ${large} 1 ${pt(a1, r)} Z`;
}

/** Колесо баланса: секторы сфер (длина — оценка), прошлая оценка — пунктиром */
export function WheelChart({ areas, cur, prev }: { areas: LifeArea[]; cur?: WheelSnapshot; prev?: WheelSnapshot }) {
  const n = Math.max(areas.length, 1);
  const step = (2 * Math.PI) / n;
  const a0 = (i: number) => -Math.PI / 2 + i * step;
  return (
    <svg className="gl-wheel-svg" viewBox="-14 -14 328 328" role="img" aria-label="Колесо баланса">
      {[2, 4, 6, 8, 10].map((v) => (
        <circle key={v} className={'gl-wh-ring' + (v === 10 ? ' is-outer' : '')} cx={CX} cy={CX} r={(R * v) / 10} />
      ))}
      {areas.map((a, i) => (
        <line key={a.id} className="gl-wh-spoke" x1={CX} y1={CX} x2={CX + R * Math.cos(a0(i))} y2={CX + R * Math.sin(a0(i))} />
      ))}
      {cur &&
        areas.map((a, i) => {
          const s = cur.scores[a.id];
          if (typeof s !== 'number') return null;
          return <path key={a.id} className="gl-wh-wedge" d={wedge(a0(i), a0(i) + step, (R * s) / 10)} style={{ fill: a.color, stroke: a.color }} />;
        })}
      {prev &&
        areas.map((a, i) => {
          const s = prev.scores[a.id];
          if (typeof s !== 'number') return null;
          return <path key={a.id} className="gl-wh-prev" d={wedge(a0(i), a0(i) + step, (R * s) / 10)} />;
        })}
      {areas.map((a, i) => {
        const mid = a0(i) + step / 2;
        const s = cur?.scores[a.id];
        const r = typeof s === 'number' ? Math.max(18, (R * s) / 10 - 14) : 0;
        return (
          <g key={a.id}>
            <text className="gl-wh-emoji" x={CX + (R + 2) * Math.cos(mid)} y={CX + (R + 2) * Math.sin(mid)}>
              {a.emoji}
            </text>
            {typeof s === 'number' && n <= 12 && (
              <text className="gl-wh-score" x={CX + r * Math.cos(mid)} y={CX + r * Math.sin(mid)}>
                {s}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function WheelTab({ data, onNewGoal }: { data: GoalsData; onNewGoal: (areaId: string) => void }) {
  const areas = sortedAreas(data);
  const snaps = useMemo(() => wheelSorted(data), [data]);
  const [selId, setSelId] = useState<string | null>(null);
  const [rate, setRate] = useState(false);
  const today = todayYmd();
  const idx = Math.max(0, selId ? snaps.findIndex((s) => s.id === selId) : 0);
  const cur = snaps[idx];
  const prev = snaps[idx + 1];
  const avg = cur ? wheelAverage(cur, areas) : null;
  const prevAvg = prev ? wheelAverage(prev, areas) : null;
  const weak = cur ? weakestAreas(cur, areas) : [];
  const due = wheelDue(data, today);
  const lastDays = snaps[0] ? daysBetween(snaps[0].date, today) : null;

  const remove = async (s: WheelSnapshot) => {
    if (!(await confirmDialog('Удалить оценку?', `Оценка от ${fullDate(s.date)} будет удалена.`, { okText: 'Удалить', danger: true }))) return;
    deleteWheel(s.id);
    if (selId === s.id) setSelId(null);
  };

  if (!areas.length)
    return (
      <div className="empty">
        <IconTile icon={ChartPieSlice} tone="violet" size="lg" />
        <div>Добавьте сферы жизни, чтобы оценить баланс</div>
      </div>
    );

  return (
    <div className="gl-wheel-page">
      {due && (
        <div className="gl-banner-card">
          <IconTile icon={ChartPieSlice} tone="violet" size="md" />
          <div className="grow">
            <div className="bold">{snaps.length ? 'Пора обновить колесо баланса' : 'Оцените баланс жизни'}</div>
            <div className="tiny muted">
              {lastDays !== null ? `Последняя оценка — ${lastDays} ${plural(lastDays, 'день', 'дня', 'дней')} назад. ` : ''}Раз в месяц оценивайте сферы от 1 до 10 и следите за изменениями.
            </div>
          </div>
          <div className="gl-banner-actions">
            <button className="btn btn-sm btn-primary" onClick={() => setRate(true)}>
              Оценить
            </button>
            {snaps.length > 0 && (
              <button className="icon-btn" onClick={() => setGoalsPrefs({ wheelSnooze: today.slice(0, 7) })} aria-label="Не напоминать в этом месяце" title="Не напоминать в этом месяце">
                <BellSlash size={19} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="gl-wheel-card">
        <div className="gl-wheel-head">
          <div className="grow">
            <h3>{!cur ? 'Колесо баланса' : idx === 0 ? 'Текущий баланс' : 'Оценка из истории'}</h3>
            <div className="tiny faint">
              {cur ? fullDate(cur.date) : 'Ещё нет оценок'}
              {prev ? ` · пунктир — ${fullDate(prev.date)}` : ''}
            </div>
          </div>
          <button className="btn btn-sm btn-tinted" onClick={() => setRate(true)}>
            <Plus size={15} weight="bold" /> Оценить
          </button>
        </div>
        <div className="gl-wheel-body">
          <WheelChart areas={areas} cur={cur} prev={prev} />
          <div className="gl-legend">
            {areas.map((a) => {
              const s = cur?.scores[a.id];
              const p = prev?.scores[a.id];
              const d = typeof s === 'number' && typeof p === 'number' ? s - p : 0;
              return (
                <div key={a.id} className="gl-legend-row" style={{ '--c': a.color } as CSSProperties}>
                  <span className="gl-dot" />
                  <span className="grow ellipsis small">
                    {a.emoji} {a.name}
                  </span>
                  {d !== 0 && <span className={'tiny gl-delta ' + (d > 0 ? 'is-up' : 'is-down')}>{d > 0 ? `+${d}` : `−${-d}`}</span>}
                  <b className="gl-legend-score">{typeof s === 'number' ? s : '—'}</b>
                </div>
              );
            })}
          </div>
        </div>
        {cur && (
          <div className="gl-wheel-stats">
            <div className="gl-stat">
              <span className="tiny muted">Среднее</span>
              <b>
                {avg !== null ? avg.toFixed(1) : '—'}
                {avg !== null && prevAvg !== null && Math.abs(avg - prevAvg) >= 0.05 && (
                  <span className={'tiny gl-delta ' + (avg > prevAvg ? 'is-up' : 'is-down')}>
                    {' '}
                    {avg > prevAvg ? '+' : '−'}
                    {Math.abs(avg - prevAvg).toFixed(1)}
                  </span>
                )}
              </b>
            </div>
            {weak.length > 0 && (
              <div className="gl-attention">
                <span className="tiny muted">Уделите внимание:</span>
                <div className="gl-attention-list">
                  {weak.map((a) => (
                    <button key={a.id} className="chip gl-area-chip active" style={{ '--c': a.color } as CSSProperties} onClick={() => onNewGoal(a.id)} title="Поставить цель в этой сфере">
                      {a.emoji} {a.name} <Target size={13} weight="bold" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {cur?.note && <div className="gl-wheel-note small muted">«{cur.note}»</div>}
      </div>

      {snaps.length > 0 && (
        <section className="gl-sec">
          <div className="gl-sec-head">
            <h3>История оценок</h3>
            <span className="tiny faint">{snaps.length}</span>
          </div>
          <div className="gl-wheel-hist">
            {snaps.map((s, i) => {
              const a = wheelAverage(s, areas);
              return (
                <div key={s.id} className={'gl-wh-item' + (i === idx ? ' active' : '')}>
                  <button className="gl-wh-item-main" onClick={() => setSelId(i === 0 ? null : s.id)}>
                    <span className="small bold">{fullDate(s.date)}</span>
                    <span className="tiny muted ellipsis">
                      среднее {a !== null ? a.toFixed(1) : '—'}
                      {s.note ? ` · ${s.note}` : ''}
                    </span>
                  </button>
                  <button className="icon-btn gl-mini-btn" onClick={() => void remove(s)} aria-label="Удалить оценку">
                    <Trash size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {rate && (
        <RateModal
          areas={areas}
          initial={snaps[0]}
          onClose={() => setRate(false)}
          onSaved={() => {
            setSelId(null);
            setRate(false);
          }}
        />
      )}
    </div>
  );
}

function RateModal({ areas, initial, onClose, onSaved }: { areas: LifeArea[]; initial?: WheelSnapshot; onClose: () => void; onSaved: () => void }) {
  const [scores, setScores] = useState<Record<string, number>>(() => Object.fromEntries(areas.map((a) => [a.id, initial?.scores[a.id] ?? 5])));
  const [note, setNote] = useState('');
  const save = () => {
    if (saveWheel(scores, note.trim())) toast('Оценка сохранена');
    onSaved();
  };
  return (
    <Sheet onClose={onClose} title="Оцените сферы жизни" className="gl-rate">
      <div className="small muted gl-rate-hint">Насколько вы довольны каждой сферой сейчас? 1 — совсем плохо, 10 — идеально.</div>
      <div className="gl-rate-list">
        {areas.map((a) => (
          <div key={a.id} className="gl-rate-row" style={{ '--c': a.color } as CSSProperties}>
            <div className="row">
              <span className="grow small">
                {a.emoji} {a.name}
              </span>
              <b className="gl-rate-val">{scores[a.id]}</b>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={scores[a.id]}
              onChange={(e) => setScores({ ...scores, [a.id]: Number(e.target.value) })}
              aria-label={a.name}
            />
          </div>
        ))}
      </div>
      <label className="label">Заметка</label>
      <input className="input" value={note} placeholder="Что сейчас влияет на баланс?" onChange={(e) => setNote(e.target.value)} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button className="btn btn-primary" onClick={save}>
          Сохранить
        </button>
      </div>
    </Sheet>
  );
}
