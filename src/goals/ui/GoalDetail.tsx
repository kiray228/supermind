import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Archive, ArrowCounterClockwise, CheckCircle, LinkSimple, MagnifyingGlass, Minus, Pause, PencilSimple, Play, Plus, Quotes, Trash } from '@phosphor-icons/react';
import { confirmDialog } from '../../ui/dialogs';
import { dayLabel, isActive } from '../../tasks/model';
import { useTasks } from '../../tasks/store';
import { todayYmd } from '../../utils/mapTasks';
import {
  deadlineInfo,
  fmtNum,
  fullDate,
  GOAL_PRIORITIES,
  goalProgress,
  goalProgressInfo,
  linkedTaskIds,
  MODES,
  periodLabel,
  STATUS_LABEL,
  timeElapsed,
  type Goal,
  type GoalsData,
} from '../model';
import { bumpTarget, createGoalTask, deleteGoal, linkTask, setGoalStatus, setManualProgress, updateGoal } from '../store';
import { areaColor, areaOf, ProgressBar, ProgressRing, Sheet, useTaskLookup } from './parts';
import { AddInput, StagesSection, TaskMini } from './Stages';

const dtFmt = (ms: number) =>
  new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function GoalDetail({ data, goal, onClose, onEdit }: { data: GoalsData; goal: Goal; onClose: () => void; onEdit: () => void }) {
  const look = useTaskLookup();
  const [picker, setPicker] = useState(false);
  const today = todayYmd();
  const area = areaOf(data, goal.areaId);
  const color = areaColor(area);
  const pct = goalProgress(goal, look);
  const info = goalProgressInfo(goal, look);
  const dl = deadlineInfo(goal, today);
  const elapsed = goal.status === 'active' ? timeElapsed(goal, today) : null;
  const prio = GOAL_PRIORITIES.find((p) => p.v === goal.priority);

  const remove = async () => {
    if (await confirmDialog('Удалить цель?', `«${goal.title}» со всеми этапами будет удалена. Связанные задачи останутся.`, { okText: 'Удалить', danger: true })) deleteGoal(goal.id);
  };

  const head = (
    <div className="gl-detail-head grow">
      <ProgressRing pct={pct} size={60} stroke={5} color={color}>
        <span className="gl-detail-emoji">{goal.emoji || '🎯'}</span>
      </ProgressRing>
      <div className="grow">
        <h2 className="gl-detail-title">{goal.title}</h2>
        <div className="gl-detail-meta tiny">
          {area && (
            <span className="gl-pill" style={{ '--c': area.color } as CSSProperties}>
              {area.emoji} {area.name}
            </span>
          )}
          <span className="faint">{periodLabel(goal)}</span>
          {goal.priority > 0 && prio && (
            <span className="gl-prio-label">
              <span className={'gl-prio p' + goal.priority} aria-hidden /> {prio.label}
            </span>
          )}
          {goal.status !== 'active' && <span className={'gl-status is-' + goal.status}>{STATUS_LABEL[goal.status]}</span>}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Sheet onClose={onClose} className="gl-detail" head={head}>
        {goal.why && (
          <div className="gl-why" style={{ '--c': color } as CSSProperties}>
            <Quotes size={16} />
            <div>
              <div className="tiny faint">Зачем мне это</div>
              <div className="gl-why-text">{goal.why}</div>
            </div>
          </div>
        )}

        <section className="gl-sec gl-progress" style={{ '--c': color } as CSSProperties}>
          <div className="gl-progress-top">
            <span className="gl-big-pct">{pct}%</span>
            <span className={'gl-due is-' + dl.state}>{dl.text}</span>
          </div>
          <ProgressBar pct={pct} color={color} />
          {elapsed !== null && (
            <div className="tiny faint gl-elapsed">
              Прошло {elapsed}% срока{goal.deadline ? ` · до ${fullDate(goal.deadline)}` : ''}
              {elapsed > pct + 15 && pct < 100 ? ' — стоит ускориться' : ''}
            </div>
          )}
          <div className="segmented gl-mode-seg">
            {MODES.map((m) => (
              <button key={m.v} className={goal.mode === m.v ? 'active' : ''} onClick={() => updateGoal(goal.id, { mode: m.v })} title={m.hint}>
                {m.label}
              </button>
            ))}
          </div>
          {goal.mode === 'manual' && <ManualSlider goal={goal} />}
          {goal.mode === 'target' && <TargetBlock goal={goal} />}
          {goal.mode === 'stages' && (
            <div className="small muted">{info.total ? `Выполнено ${info.done} из ${info.total} шагов` : 'Добавьте этапы и шаги ниже — прогресс посчитается сам'}</div>
          )}
          {goal.mode === 'tasks' && (
            <div className="small muted">{info.total ? `Выполнено ${info.done} из ${info.total} задач` : 'Создайте или привяжите задачи — прогресс посчитается по ним'}</div>
          )}
        </section>

        <StagesSection goal={goal} area={area} look={look} />

        <section className="gl-sec">
          <div className="gl-sec-head">
            <h3>Задачи</h3>
            <div className="grow" />
            <button className="btn btn-sm btn-ghost" onClick={() => setPicker(true)}>
              <LinkSimple size={14} /> Привязать
            </button>
          </div>
          {goal.taskIds.length === 0 && <div className="small faint gl-sec-empty">Задачи появятся в разделе «Задачи» с тегом #цель.</div>}
          <div className="gl-steps">
            {goal.taskIds.map((id) => (
              <TaskMini key={id} goalId={goal.id} taskId={id} look={look} />
            ))}
            <AddInput placeholder="Новая задача к цели" onAdd={(t) => void createGoalTask(goal.id, t)} />
          </div>
        </section>

        <section className="gl-sec">
          <div className="gl-sec-head">
            <h3>Заметки</h3>
          </div>
          <NotesField goal={goal} />
        </section>

        <HistorySection goal={goal} />

        <div className="gl-detail-actions">
          {goal.status === 'active' && (
            <>
              <button className="btn btn-primary gl-complete-btn" onClick={() => setGoalStatus(goal.id, 'done')}>
                <CheckCircle size={17} /> Цель достигнута
              </button>
              <button className="btn" onClick={() => setGoalStatus(goal.id, 'paused')}>
                <Pause size={16} /> Отложить
              </button>
            </>
          )}
          {goal.status === 'paused' && (
            <button className="btn btn-primary" onClick={() => setGoalStatus(goal.id, 'active')}>
              <Play size={16} /> Возобновить
            </button>
          )}
          {(goal.status === 'done' || goal.status === 'archived') && (
            <button className="btn" onClick={() => setGoalStatus(goal.id, 'active')}>
              <ArrowCounterClockwise size={16} /> Вернуть в работу
            </button>
          )}
          {goal.status !== 'archived' && (
            <button className="btn btn-ghost" onClick={() => setGoalStatus(goal.id, 'archived')}>
              <Archive size={16} /> В архив
            </button>
          )}
          <div className="grow" />
          <button className="btn btn-ghost" onClick={onEdit}>
            <PencilSimple size={16} /> Изменить
          </button>
          <button className="btn btn-ghost btn-danger" onClick={() => void remove()} aria-label="Удалить цель">
            <Trash size={16} />
          </button>
        </div>
      </Sheet>
      {picker && <TaskPicker goal={goal} onClose={() => setPicker(false)} />}
    </>
  );
}

function ManualSlider({ goal }: { goal: Goal }) {
  const [v, setV] = useState(goal.manual);
  useEffect(() => setV(goal.manual), [goal.manual]);
  return (
    <div className="gl-manual">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={v}
        onChange={(e) => {
          setV(Number(e.target.value));
          setManualProgress(goal.id, Number(e.target.value));
        }}
        aria-label="Процент выполнения"
      />
      <span className="gl-manual-val">{v}%</span>
    </div>
  );
}

function TargetBlock({ goal }: { goal: Goal }) {
  const [amount, setAmount] = useState('');
  const t = goal.target;
  if (!t) return null;
  const unit = t.unit ? ' ' + t.unit : '';
  const add = (sign: 1 | -1) => {
    const n = Number(amount.replace(/\s/g, '').replace(',', '.'));
    if (!amount.trim() || !Number.isFinite(n) || n === 0) return;
    bumpTarget(goal.id, sign * Math.abs(n));
    setAmount('');
  };
  const recent = goal.history.filter((h) => h.kind === 'target').slice(-5).reverse();
  return (
    <div className="gl-target">
      <div className="gl-target-row">
        <button className="gl-round-btn" onClick={() => bumpTarget(goal.id, -t.step)} aria-label={`Убавить ${fmtNum(t.step)}`}>
          <Minus size={20} />
        </button>
        <div className="gl-target-val">
          <b>{fmtNum(t.current)}</b>
          <span className="muted">
            {' '}
            / {fmtNum(t.target)}
            {unit}
          </span>
          {t.start !== 0 && <div className="tiny faint">начало: {fmtNum(t.start)}</div>}
        </div>
        <button className="gl-round-btn is-plus" onClick={() => bumpTarget(goal.id, t.step)} aria-label={`Прибавить ${fmtNum(t.step)}`}>
          <Plus size={20} />
        </button>
      </div>
      <div className="gl-target-add">
        <input className="input" inputMode="decimal" placeholder="Своё значение" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(1)} />
        <button className="btn" onClick={() => add(-1)} disabled={!amount.trim()}>
          −
        </button>
        <button className="btn btn-primary" onClick={() => add(1)} disabled={!amount.trim()}>
          +
        </button>
      </div>
      {recent.length > 0 && (
        <div className="gl-incs">
          {recent.map((h) => (
            <div key={h.id} className="tiny row">
              <span className={'gl-inc ' + ((h.delta ?? 0) >= 0 ? 'is-up' : 'is-down')}>{h.text}</span>
              <span className="grow" />
              <span className="faint">{dtFmt(h.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Заметки: сохраняются с задержкой и при закрытии окна */
function NotesField({ goal }: { goal: Goal }) {
  const [v, setV] = useState(goal.notes);
  const latest = useRef({ v, saved: goal.notes, id: goal.id });
  latest.current.v = v;
  useEffect(() => {
    if (v === latest.current.saved) return;
    const t = setTimeout(() => {
      latest.current.saved = v;
      updateGoal(goal.id, { notes: v });
    }, 600);
    return () => clearTimeout(t);
  }, [v, goal.id]);
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.v !== l.saved) updateGoal(l.id, { notes: l.v });
    },
    [],
  );
  return <textarea className="textarea gl-notes" value={v} placeholder="Мысли, ресурсы, ссылки, выводы…" onChange={(e) => setV(e.target.value)} rows={3} />;
}

function HistorySection({ goal }: { goal: Goal }) {
  const [all, setAll] = useState(false);
  const items = [...goal.history].reverse();
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 6);
  return (
    <section className="gl-sec">
      <div className="gl-sec-head">
        <h3>История</h3>
        <span className="tiny faint">{items.length}</span>
      </div>
      <div className="gl-history">
        {shown.map((h) => (
          <div key={h.id} className="gl-hist">
            <span className={'gl-hist-dot is-' + (h.kind ?? 'info')} />
            <span className="grow small">{h.text}</span>
            <span className="tiny faint">{dtFmt(h.at)}</span>
          </div>
        ))}
      </div>
      {items.length > 6 && (
        <button className="btn btn-sm btn-ghost" onClick={() => setAll(!all)}>
          {all ? 'Свернуть' : `Показать всё (${items.length})`}
        </button>
      )}
    </section>
  );
}

/** Привязать существующую задачу */
function TaskPicker({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const tasks = useTasks((s) => s.data?.tasks);
  const [q, setQ] = useState('');
  const linked = useMemo(() => new Set(linkedTaskIds(goal)), [goal]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (tasks ?? [])
      .filter((t) => isActive(t) && !linked.has(t.id) && (!s || t.title.toLowerCase().includes(s)))
      .slice(0, 80);
  }, [tasks, q, linked]);
  return (
    <Sheet onClose={onClose} title="Привязать задачу" className="gl-picker">
      <div className="gl-search">
        <MagnifyingGlass size={16} />
        <input className="input" value={q} placeholder="Поиск задач" onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="gl-pick-list">
        {list.length === 0 && <div className="empty small">Нет подходящих задач</div>}
        {list.map((t) => (
          <button
            key={t.id}
            className="gl-pick-item"
            onClick={() => {
              linkTask(goal.id, t.id);
              onClose();
            }}
          >
            <span className="grow ellipsis">{t.title}</span>
            {t.date && <span className="tiny faint">{dayLabel(t.date)}</span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
