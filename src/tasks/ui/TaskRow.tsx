import { useRef, useState, type CSSProperties } from 'react';
import { Bell, Check, CalendarDays, ListChecks, Network, Pin, Repeat, Trash2, Timer, AlignLeft } from 'lucide-react';
import { PRIORITY_META, todayYmd } from '../../utils/mapTasks';
import { dayLabel, isOverdue, whenLabel, type TaskItem, type TaskList } from '../model';
import { toast } from '../../store/appStore';
import { openTask, toggleDone, trashTask, updateTask } from '../store';
import { DatePicker } from './DatePicker';

/** Кружок-чекбокс в цвете приоритета */
export function TaskCheck({ task, onToggle }: { task: Pick<TaskItem, 'done' | 'priority' | 'wontDo'>; onToggle: () => void }) {
  const color = task.priority ? PRIORITY_META[task.priority].color : undefined;
  return (
    <button
      className={`tk-check${task.done ? ' on' : ''}${task.wontDo ? ' wont' : ''}`}
      style={color ? ({ '--pc': color } as CSSProperties) : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={task.done ? 'Отметить невыполненной' : 'Выполнить'}
    >
      {task.done && <Check size={13} strokeWidth={3.2} />}
    </button>
  );
}

export function TaskRow({
  task,
  list,
  showList = true,
  showDate = true,
  timeOnly,
  tagColors,
  draggable,
  occurrence,
}: {
  /** дата показанного повтора (ежедневник/календарь); если это не текущий повтор — галочка недоступна */
  occurrence?: string;
  task: TaskItem;
  list?: TaskList;
  showList?: boolean;
  showDate?: boolean;
  /** показывать только время (в ежедневнике день и так выбран) */
  timeOnly?: boolean;
  tagColors?: Record<string, string>;
  draggable?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const [picking, setPicking] = useState(false);
  const [completing, setCompleting] = useState(false);
  const drag = useRef<{ x: number; y: number; id: number; horiz: boolean | null; base: number } | null>(null);
  const today = todayYmd();
  const overdue = isOverdue(task, today);
  // сегодняшним задачам достаточно времени: «10:00–11:00» вместо «Сегодня, 10:00–11:00»
  const when = !task.date
    ? ''
    : timeOnly
      ? task.time
        ? whenLabel({ ...task, date: today }, today).replace(/^Сегодня, /, '')
        : ''
      : task.date === today && task.time
        ? whenLabel(task, today).replace(/^Сегодня, /, '')
        : whenLabel(task, today);
  const checklistDone = task.checklist.filter((c) => c.done).length;

  const future = !!occurrence && !!task.date && occurrence !== task.date;
  const done = () => {
    if (completing) return;
    if (future) {
      toast(`Сначала отметьте повтор ${dayLabel(task.date!).toLowerCase()}`);
      return;
    }
    if (task.done) return toggleDone(task.id);
    // короткая анимация «вычёркивания» перед исчезновением из списка
    setCompleting(true);
    setTimeout(() => {
      setCompleting(false);
      toggleDone(task.id);
    }, 260);
  };

  // свайпы на сенсорном экране: вправо — выполнить, влево — дата и удаление
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horiz: null, base: dx };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.horiz === null && Math.abs(mx) + Math.abs(my) > 10) d.horiz = Math.abs(mx) > Math.abs(my) * 1.3;
    if (d.horiz) setDx(Math.max(-150, Math.min(110, d.base + mx)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.horiz) return;
    if (dx > 80) {
      setDx(0);
      if (!future) done();
    } else if (dx < -60) setDx(-132);
    else setDx(0);
  };

  return (
    <div className={`tk-row-wrap${dx ? ' swiping' : ''}`}>
      <div className="tk-swipe-bg">
        <span className="tk-swipe-done">
          <Check size={18} /> Выполнить
        </span>
        <div className="grow" />
        <button
          className="tk-swipe-btn date"
          onClick={() => {
            setDx(0);
            setPicking(true);
          }}
        >
          <CalendarDays size={18} />
        </button>
        <button
          className="tk-swipe-btn del"
          onClick={() => {
            setDx(0);
            trashTask(task.id);
          }}
        >
          <Trash2 size={18} />
        </button>
      </div>
      <div
        className={`tk-row${task.done ? ' is-done' : ''}${completing ? ' completing' : ''}`}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onClick={() => (dx ? setDx(0) : openTask(task.id))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/sm-task', task.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <span className={future ? 'tk-check-future' : undefined}>
          <TaskCheck task={completing ? { ...task, done: true } : task} onToggle={done} />
        </span>
        <div className="tk-body">
          <div className="tk-title">
            {task.pinned && <Pin size={12} className="tk-pin" />}
            {task.title || <span className="faint">Без названия</span>}
          </div>
          {(when || task.repeat || task.reminders.length > 0 || task.checklist.length > 0 || task.tags.length > 0 || task.source || task.notes) && (
            <div className="tk-meta">
              {showDate && when && <span className={`tk-when${overdue ? ' overdue' : task.date === today ? ' today' : ''}`}>{when}</span>}
              {task.repeat && <Repeat size={12} className="tk-mi" />}
              {task.date && task.reminders.length > 0 && !task.done && <Bell size={12} className="tk-mi" />}
              {task.checklist.length > 0 && (
                <span className="tk-mi-text">
                  <ListChecks size={12} /> {checklistDone}/{task.checklist.length}
                </span>
              )}
              {task.notes?.trim() && <AlignLeft size={12} className="tk-mi" />}
              {!!task.focusMinutes && (
                <span className="tk-mi-text">
                  <Timer size={12} /> {task.focusMinutes}м
                </span>
              )}
              {task.source && <Network size={12} className="tk-mi" />}
              {task.tags.map((g) => (
                <span key={g} className="tk-tag" style={tagColors?.[g] ? ({ '--tc': tagColors[g] } as CSSProperties) : undefined}>
                  #{g}
                </span>
              ))}
            </div>
          )}
        </div>
        {showList && list && (
          <span className="tk-list-dot" title={list.name}>
            <i style={{ background: list.color }} />
            <span className="ellipsis">{list.name}</span>
          </span>
        )}
      </div>
      {picking && (
        <DatePicker
          value={task}
          onClose={() => setPicking(false)}
          onDone={(v) => {
            setPicking(false);
            updateTask(task.id, { date: v.date, time: v.time, duration: v.duration, reminders: v.reminders, repeat: v.repeat });
          }}
        />
      )}
    </div>
  );
}
