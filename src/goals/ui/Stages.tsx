import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowSquareOut, ArrowUp, Check, CircleNotch, DotsThree, ListPlus, Plus, Sparkle, Stop, Trash, X } from '@phosphor-icons/react';
import { AIError } from '../../ai/claude';
import { toast } from '../../store/appStore';
import { confirmDialog } from '../../ui/dialogs';
import { dayLabel } from '../../tasks/model';
import { openTask, toggleDone } from '../../tasks/store';
import { todayYmd } from '../../utils/mapTasks';
import { aiBreakdown } from '../ai';
import { stageUnits, stepDone, taskClosed, type Goal, type GoalStage, type LifeArea, type TaskLookup } from '../model';
import {
  addStage,
  addStages,
  addStep,
  createGoalTask,
  deleteStage,
  deleteStep,
  moveStage,
  removeStages,
  toggleStageDone,
  toggleStep,
  unlinkTask,
  updateStage,
  updateStep,
} from '../store';
import { ProgressRing } from './parts';

/** Поле, которое сохраняется при потере фокуса или Enter */
export function InlineText({ value, onCommit, className, placeholder, done }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; done?: boolean }) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value);
  }, [value]);
  const commit = () => {
    const t = v.trim();
    if (t && t !== value) onCommit(t);
    else setV(value);
  };
  return (
    <input
      className={'gl-inline' + (done ? ' is-done' : '') + (className ? ' ' + className : '')}
      value={v}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

/** Поле «добавить…»: Enter добавляет и очищает */
export function AddInput({ placeholder, onAdd, className }: { placeholder: string; onAdd: (v: string) => void; className?: string }) {
  const [v, setV] = useState('');
  const add = () => {
    const t = v.trim();
    if (!t) return;
    onAdd(t);
    setV('');
  };
  return (
    <div className={'gl-add' + (className ? ' ' + className : '')}>
      <Plus size={16} />
      <input
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          }
        }}
        enterKeyHint="done"
      />
      {v.trim() && (
        <button className="btn btn-sm btn-primary" onClick={add}>
          Добавить
        </button>
      )}
    </div>
  );
}

/** Короткая строка задачи внутри цели */
export function TaskMini({ goalId, taskId, look }: { goalId: string; taskId: string; look: TaskLookup }) {
  const t = look(taskId);
  if (!t) return null;
  const closed = taskClosed(t);
  return (
    <div className={'gl-item gl-task' + (closed ? ' is-done' : '')}>
      <button className={'gl-check' + (closed ? ' on' : '')} onClick={() => toggleDone(t.id)} aria-label={closed ? 'Вернуть задачу' : 'Выполнить задачу'}>
        {closed && <Check size={13} weight="bold" />}
      </button>
      <button className="gl-task-title grow" onClick={() => openTask(t.id)}>
        <span className="ellipsis">{t.title}</span>
        {t.date && <span className="tiny faint">{dayLabel(t.date)}</span>}
      </button>
      <button className="icon-btn gl-mini-btn" onClick={() => unlinkTask(goalId, t.id)} aria-label="Отвязать задачу" title="Отвязать от цели">
        <X size={15} />
      </button>
    </div>
  );
}

function StageBlock({ goal, stage, index, look }: { goal: Goal; stage: GoalStage; index: number; look: TaskLookup }) {
  const [menu, setMenu] = useState(false);
  const u = stageUnits(stage, look);
  const done = u.done === u.total;
  const simple = !stage.steps.length && !stage.taskIds.some((id) => look(id));
  const today = todayYmd();
  const overdue = !done && stage.deadline && stage.deadline < today;

  const remove = async () => {
    if (stage.steps.length && !(await confirmDialog('Удалить этап?', `«${stage.title}» и его шаги будут удалены.`, { okText: 'Удалить', danger: true }))) return;
    deleteStage(goal.id, stage.id);
  };

  return (
    <div className={'gl-stage' + (done ? ' is-done' : '')}>
      <div className="gl-stage-head">
        {simple ? (
          <button className={'gl-check gl-check-lg' + (done ? ' on' : '')} onClick={() => toggleStageDone(goal.id, stage.id)} aria-label="Отметить этап">
            {done && <Check size={14} weight="bold" />}
          </button>
        ) : (
          <ProgressRing pct={(u.done / u.total) * 100} size={26} stroke={3} color={done ? 'var(--ok)' : undefined}>
            <span className="gl-stage-num">{done ? <Check size={12} weight="bold" /> : index + 1}</span>
          </ProgressRing>
        )}
        <InlineText className="gl-stage-title" value={stage.title} onCommit={(t) => updateStage(goal.id, stage.id, { title: t })} />
        <button className={'icon-btn gl-mini-btn' + (menu ? ' active' : '')} onClick={() => setMenu(!menu)} aria-label="Действия с этапом">
          <DotsThree size={17} />
        </button>
      </div>
      <div className="gl-stage-sub">
        <label className={'gl-date' + (overdue ? ' is-overdue' : '')}>
          <span>{stage.deadline ? 'до ' + dayLabel(stage.deadline).toLowerCase() : 'без срока'}</span>
          <input type="date" value={stage.deadline ?? ''} onChange={(e) => updateStage(goal.id, stage.id, { deadline: e.target.value || undefined })} aria-label="Срок этапа" />
        </label>
        {!simple && (
          <span className="tiny faint">
            {u.done} из {u.total}
          </span>
        )}
      </div>
      {menu && (
        <div className="gl-stage-menu">
          <button className="btn btn-sm btn-ghost" disabled={index === 0} onClick={() => moveStage(goal.id, stage.id, -1)}>
            <ArrowUp size={14} /> Выше
          </button>
          <button className="btn btn-sm btn-ghost" disabled={index === goal.stages.length - 1} onClick={() => moveStage(goal.id, stage.id, 1)}>
            <ArrowDown size={14} /> Ниже
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => void createGoalTask(goal.id, stage.title, { stageId: stage.id, date: stage.deadline })}>
            <ListPlus size={14} /> Задача этапа
          </button>
          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => void remove()}>
            <Trash size={14} /> Удалить
          </button>
        </div>
      )}
      <div className="gl-steps">
        {stage.steps.map((s) => {
          const sd = stepDone(s, look);
          const task = s.taskId ? look(s.taskId) : undefined;
          return (
            <div key={s.id} className={'gl-item' + (sd ? ' is-done' : '')}>
              <button className={'gl-check' + (sd ? ' on' : '')} onClick={() => toggleStep(goal.id, stage.id, s.id)} aria-label={sd ? 'Снять отметку' : 'Выполнить шаг'}>
                {sd && <Check size={13} weight="bold" />}
              </button>
              <InlineText className="grow" value={s.title} done={sd} onCommit={(t) => updateStep(goal.id, stage.id, s.id, { title: t })} />
              {task ? (
                <button className="icon-btn gl-mini-btn gl-linked" onClick={() => openTask(task.id)} aria-label="Открыть задачу" title={task.date ? 'Задача · ' + dayLabel(task.date) : 'Открыть задачу'}>
                  <ArrowSquareOut size={15} />
                </button>
              ) : (
                !sd && (
                  <button
                    className="icon-btn gl-mini-btn"
                    onClick={() => void createGoalTask(goal.id, s.title, { stageId: stage.id, stepId: s.id, date: stage.deadline })}
                    aria-label="Создать задачу из шага"
                    title="В задачи"
                  >
                    <ListPlus size={15} />
                  </button>
                )
              )}
              <button className="icon-btn gl-mini-btn" onClick={() => deleteStep(goal.id, stage.id, s.id)} aria-label="Удалить шаг">
                <X size={15} />
              </button>
            </div>
          );
        })}
        {stage.taskIds.map((id) => (
          <TaskMini key={id} goalId={goal.id} taskId={id} look={look} />
        ))}
        <AddInput className="gl-add-step" placeholder="Добавить шаг" onAdd={(t) => addStep(goal.id, stage.id, t)} />
      </div>
    </div>
  );
}

export function StagesSection({ goal, area, look }: { goal: Goal; area?: LifeArea; look: TaskLookup }) {
  const [busy, setBusy] = useState<AbortController | null>(null);
  const [chars, setChars] = useState(0);
  let done = 0;
  let total = 0;
  for (const st of goal.stages) {
    const u = stageUnits(st, look);
    done += u.done;
    total += u.total;
  }

  const acRef = useRef<AbortController | null>(null);
  // закрыли окно — запрос к ИИ прекращаем
  useEffect(() => () => acRef.current?.abort(), []);

  const runAi = async () => {
    if (busy) {
      busy.abort();
      return;
    }
    const ac = new AbortController();
    acRef.current = ac;
    setBusy(ac);
    setChars(0);
    try {
      const drafts = await aiBreakdown(goal, area, { signal: ac.signal, onText: (s) => setChars(s.length) });
      const ids = addStages(goal.id, drafts);
      toast(`ИИ добавил этапов: ${ids.length}`, { label: 'Отменить', run: () => removeStages(goal.id, ids) });
    } catch (e) {
      if (!ac.signal.aborted) toast(e instanceof AIError || e instanceof Error ? e.message : 'Ошибка ИИ');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="gl-sec">
      <div className="gl-sec-head">
        <h3>Этапы</h3>
        {total > 0 && goal.stages.length > 0 && (
          <span className="tiny faint">
            {done}/{total}
          </span>
        )}
        <div className="grow" />
        <button className={'btn btn-sm gl-ai-btn' + (busy ? ' is-busy' : '')} onClick={() => void runAi()}>
          {busy ? <CircleNotch size={14} className="gl-spin" /> : <Sparkle size={14} />}
          {busy ? (chars ? `Думаю… ${chars}` : 'Думаю…') : 'ИИ: разбить цель на шаги'}
          {busy && <Stop size={11} className="gl-stop" />}
        </button>
      </div>
      {goal.stages.length === 0 && <div className="small faint gl-sec-empty">Разбейте цель на этапы со своими сроками и шагами — так её проще достичь.</div>}
      <div className="gl-stages">
        {goal.stages.map((st, i) => (
          <StageBlock key={st.id} goal={goal} stage={st} index={i} look={look} />
        ))}
      </div>
      <AddInput placeholder="Новый этап" onAdd={(t) => addStage(goal.id, t)} />
    </section>
  );
}
