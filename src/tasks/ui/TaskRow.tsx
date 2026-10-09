import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, ListChecks, Network, Pin, Repeat, Timer, AlignLeft, Undo2 } from 'lucide-react';
import { PRIORITY_META, addDaysYmd, todayYmd } from '../../utils/mapTasks';
import { dayLabel, isOverdue, whenLabel, type TaskItem, type TaskList } from '../model';
import { toast } from '../../store/appStore';
import { openTask, purgeTask, restoreTask, toggleDone, trashTask, updateTask } from '../store';
import { mergeHandlers, useLongPress, useSwipeActions } from '../../ui/gestures';
import { SwipeBg } from '../../ui/SwipeBg';
import { DatePicker } from './DatePicker';
import '../../ui/dialogs.css';
import './tasks.css';

const finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

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

/**
 * Жесты и меню задачи (строки списков, ежедневника и календаря): свайп вправо — выполнить (в корзине — вернуть),
 * влево — удалить с «Вернуть» (в корзине — навсегда), долгое нажатие / правая кнопка — лист действий.
 * Разметка: обёртка ref={swipe.wrap} className={swipe.wrapClass}, первым — bg, строка — класс sw-row, style={swipe.style}, {...handlers}; overlays — после строки.
 */
export function useTaskActions(task: TaskItem, occurrence?: string) {
  const [picking, setPicking] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [menu, setMenu] = useState(false);
  const today = todayYmd();
  const tomorrow = addDaysYmd(today, 1);

  const future = !!occurrence && !!task.date && occurrence !== task.date;
  const trashed = !!task.deleted;
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
  const remove = () => {
    if (trashed) {
      purgeTask(task.id);
      toast('Задача удалена навсегда');
      return;
    }
    trashTask(task.id);
    toast('Задача удалена', { label: 'Вернуть', run: () => restoreTask(task.id) });
  };

  // сенсорный экран: вправо — выполнить (в корзине — восстановить), влево — удалить; долгое нажатие — меню
  const press = useLongPress(() => setMenu(true));
  const swipe = useSwipeActions({ onDelete: remove, onRight: trashed ? () => restoreTask(task.id) : future ? undefined : done });
  const handlers = mergeHandlers(press, swipe.bind);
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  const bg = (
    <SwipeBg
      dx={swipe.dx}
      armed={swipe.armed}
      onDelete={swipe.confirmDelete}
      rightLabel={trashed ? 'Вернуть' : task.done ? 'Не готово' : 'Выполнить'}
      rightIcon={trashed || task.done ? <Undo2 size={22} strokeWidth={2.4} /> : undefined}
      deleteLabel={trashed ? 'Навсегда' : 'Удалить'}
    />
  );
  const overlays = (
    <>
      {menu &&
        createPortal(
          // события листа не должны доходить до строки и списка (React пробрасывает их через портал)
          <div
            className="modal-backdrop dlg-as-backdrop"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) setMenu(false);
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <div className="dlg-as" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
              <div className="dlg-as-group">
                <div className="dlg-as-head">
                  <div className="dlg-as-title">{task.title || 'Без названия'}</div>
                </div>
                {trashed ? (
                  <>
                    <button className="dlg-as-btn" onClick={act(() => restoreTask(task.id))}>
                      Восстановить
                    </button>
                    <button className="dlg-as-btn danger" onClick={act(remove)}>
                      Удалить навсегда
                    </button>
                  </>
                ) : (
                  <>
                    <button className="dlg-as-btn" onClick={act(done)}>
                      {task.done ? 'Отметить невыполненной' : 'Выполнить'}
                    </button>
                    {!task.done && task.date !== tomorrow && (
                      <button className="dlg-as-btn" onClick={act(() => updateTask(task.id, { date: tomorrow }))}>
                        Перенести на завтра
                      </button>
                    )}
                    <button className="dlg-as-btn" onClick={act(() => setPicking(true))}>
                      Выбрать дату
                    </button>
                    <button className="dlg-as-btn" onClick={act(() => updateTask(task.id, { pinned: !task.pinned }))}>
                      {task.pinned ? 'Открепить' : 'Закрепить'}
                    </button>
                    <button className="dlg-as-btn danger" onClick={act(remove)}>
                      Удалить
                    </button>
                  </>
                )}
              </div>
              <button className="dlg-as-btn dlg-as-cancel" autoFocus onClick={() => setMenu(false)}>
                Отмена
              </button>
            </div>
          </div>,
          document.body,
        )}
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
    </>
  );
  return { swipe, handlers, bg, overlays, done, completing, future };
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
  const { swipe, handlers, bg, overlays, done, completing, future } = useTaskActions(task, occurrence);

  return (
    <div ref={swipe.wrap} className={`tk-row-wrap ${swipe.wrapClass}`}>
      {bg}
      <div
        className={`tk-row sw-row${task.done ? ' is-done' : ''}${completing ? ' completing' : ''}`}
        style={swipe.style}
        onClick={() => openTask(task.id)}
        {...handlers}
        // на iPhone долгое нажатие перетаскивало бы строку вместо меню — перетаскивание только мышью
        draggable={draggable && finePointer}
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
      {overlays}
    </div>
  );
}
