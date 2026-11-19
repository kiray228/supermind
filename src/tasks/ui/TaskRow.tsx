import { useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, CornerDownRight, ListChecks, Network, Pin, Repeat, Timer, AlignLeft, Undo2 } from 'lucide-react';
import { PRIORITY_META, addDaysYmd, todayYmd } from '../../utils/mapTasks';
import { dayLabelInline, isOverdue, whenLabel, type TaskItem, type TaskList } from '../model';
import { toast } from '../../store/appStore';
import { moveOccurrence, openTask, purgeTask, restoreTask, skipOccurrence, toggleDone, trashTask, updateTask, useTasks } from '../store';
import { mergeHandlers, useLongPressDrag, useSwipeActions } from '../../ui/gestures';
import { startTouchDrag } from './touchDrag';
import { startSelect, toggleSelect, useBulk } from '../bulk';
import { SwipeBg } from '../../ui/SwipeBg';
import { DatePicker } from './DatePicker';
import { t } from '../../i18n/index';
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
      aria-label={task.done ? t('Отметить невыполненной') : t('Выполнить')}
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
/** dragRow — строку можно перетащить пальцем (долгое нажатие и повести) */
export function useTaskActions(task: TaskItem, occurrence?: string, dragRow?: RefObject<HTMLElement | null>, selectable = false) {
  const [picking, setPicking] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [menu, setMenu] = useState(false);
  const today = todayYmd();
  const tomorrow = addDaysYmd(today, 1);

  const future = !!occurrence && !!task.date && occurrence !== task.date;
  const trashed = !!task.deleted;
  /** показанный повтор (у обычной задачи — её дата) */
  const occ = occurrence ?? task.date;
  const repeating = !!task.repeat && !!occ && !trashed;
  const done = () => {
    if (completing) return;
    if (future) {
      toast(t('Сначала отметьте повтор {day}', { day: dayLabelInline(task.date!) }));
      return;
    }
    if (task.done) return toggleDone(task.id);
    // короткая анимация «вычёркивания» перед исчезновением из списка, лёгкий отклик на телефоне
    navigator.vibrate?.(10);
    setCompleting(true);
    setTimeout(() => {
      setCompleting(false);
      toggleDone(task.id);
    }, 260);
  };
  /** удалить всю серию повторов (или обычную задачу) */
  const removeAll = () => {
    trashTask(task.id);
    toast(repeating ? t('Задача удалена со всеми повторами') : t('Задача удалена'), { label: t('Вернуть'), run: () => restoreTask(task.id) });
  };
  const remove = () => {
    // у повторяющейся — только этот повтор (вся серия — из меню)
    if (repeating) {
      skipOccurrence(task.id, occ!);
      return;
    }
    if (trashed) {
      purgeTask(task.id);
      toast(t('Задача удалена навсегда'));
      return;
    }
    trashTask(task.id);
    toast(t('Задача удалена'), { label: t('Вернуть'), run: () => restoreTask(task.id) });
  };

  // сенсорный экран: вправо — выполнить (в корзине — восстановить), влево — удалить; долгое нажатие — меню
  // долгое нажатие: отпустили — меню; повели — перетаскивание (если строку можно перетаскивать)
  const swipe = useSwipeActions({ onDelete: remove, onRight: trashed ? () => restoreTask(task.id) : future ? undefined : done });
  const press = useLongPressDrag(
    () => setMenu(true),
    dragRow && !task.deleted
      ? (x, y) => {
          swipe.abort();
          if (dragRow.current) startTouchDrag(task.id, dragRow.current, x, y);
        }
      : undefined,
  );
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
      rightLabel={trashed ? t('Вернуть') : task.done ? t('Не готово') : t('Выполнить')}
      rightIcon={trashed || task.done ? <Undo2 size={22} strokeWidth={2.4} /> : undefined}
      deleteLabel={trashed ? t('Навсегда') : repeating ? t('Пропустить') : t('Удалить')}
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
                  <div className="dlg-as-title">{task.title || t('Без названия')}</div>
                </div>
                {trashed ? (
                  <>
                    <button className="dlg-as-btn" onClick={act(() => restoreTask(task.id))}>
                      {t('Восстановить')}
                    </button>
                    <button className="dlg-as-btn danger" onClick={act(remove)}>
                      {t('Удалить навсегда')}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="dlg-as-btn" onClick={act(done)}>
                      {task.done ? t('Отметить невыполненной') : t('Выполнить')}
                    </button>
                    {!task.done && occ !== tomorrow && (
                      <button className="dlg-as-btn" onClick={act(() => (repeating && future ? moveOccurrence(task.id, occ!, tomorrow) : updateTask(task.id, { date: tomorrow })))}>
                        {repeating && future ? t('Перенести этот повтор на завтра') : t('Перенести на завтра')}
                      </button>
                    )}
                    <button className="dlg-as-btn" onClick={act(() => setPicking(true))}>
                      {t('Выбрать дату')}
                    </button>
                    <button className="dlg-as-btn" onClick={act(() => updateTask(task.id, { pinned: !task.pinned }))}>
                      {task.pinned ? t('Открепить') : t('Закрепить')}
                    </button>
                    {selectable && (
                      <button className="dlg-as-btn" onClick={act(() => startSelect(task.id))}>
                        {t('Выбрать несколько')}
                      </button>
                    )}
                    {repeating ? (
                      <>
                        <button className="dlg-as-btn" onClick={act(remove)}>
                          {t('Пропустить этот повтор')}
                        </button>
                        <button className="dlg-as-btn danger" onClick={act(removeAll)}>
                          {t('Удалить все повторы')}
                        </button>
                      </>
                    ) : (
                      <button className="dlg-as-btn danger" onClick={act(remove)}>
                        {t('Удалить')}
                      </button>
                    )}
                  </>
                )}
              </div>
              <button className="dlg-as-btn dlg-as-cancel" autoFocus onClick={() => setMenu(false)}>
                {t('Отмена')}
              </button>
            </div>
          </div>,
          document.body,
        )}
      {picking && (
        <DatePicker
          value={repeating && future ? { ...task, date: occ, repeat: undefined } : task}
          onClose={() => setPicking(false)}
          onDone={(v) => {
            setPicking(false);
            // будущий повтор — переносится только он (отдельной задачей), серия остаётся
            if (repeating && future) {
              if (!v.date) return;
              const c = moveOccurrence(task.id, occ!, v.date);
              if (c && c.id !== task.id) updateTask(c.id, { time: v.time, duration: v.duration, reminders: v.reminders, alarm: v.alarm, ...(v.repeat ? { repeat: v.repeat } : {}) });
              return;
            }
            updateTask(task.id, { date: v.date, time: v.time, duration: v.duration, reminders: v.reminders, repeat: v.repeat, alarm: v.alarm });
          }}
        />
      )}
    </>
  );
  return { swipe, handlers, bg, overlays, done, completing, future };
}

/** «Сегодня, 10:00» → «10:00» */
const stripToday = (s: string) => {
  const p = `${t('Сегодня')}, `;
  return s.startsWith(p) ? s.slice(p.length) : s;
};

export function TaskRow({
  task,
  list,
  showList = true,
  showDate = true,
  timeOnly,
  tagColors,
  draggable,
  occurrence,
  selectable,
}: {
  /** можно выбрать вместе с другими (раздел «Задачи») */
  selectable?: boolean;
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
        ? stripToday(whenLabel({ ...task, date: today }, today))
        : ''
      : task.date === today && task.time
        ? stripToday(whenLabel(task, today))
        : whenLabel(task, today);
  const checklistDone = task.checklist.filter((c) => c.done).length;
  // подзадача: название родительской задачи
  const parentTitle = useTasks((s) => (task.parentId ? s.data?.tasks.find((t) => t.id === task.parentId && !t.deleted)?.title : undefined));
  const rowRef = useRef<HTMLDivElement>(null);
  const { swipe, handlers, bg, overlays, done, completing, future } = useTaskActions(task, occurrence, draggable && !finePointer ? rowRef : undefined, selectable);
  // режим выбора нескольких задач (tasks/bulk.ts): нажатие — выбрать, жесты и перетаскивание выключены
  const picking = useBulk((s) => selectable && s.ids !== null);
  const picked = useBulk((s) => !!s.ids?.includes(task.id));

  return (
    <div ref={swipe.wrap} className={`tk-row-wrap ${swipe.wrapClass}`}>
      {bg}
      <div
        ref={rowRef}
        className={`tk-row sw-row${task.done ? ' is-done' : ''}${completing ? ' completing' : ''}${picking ? ' picking' : ''}${picked ? ' picked' : ''}`}
        style={picking ? undefined : swipe.style}
        onClick={(e) => {
          if (picking) return toggleSelect(task.id);
          // Ctrl/⌘ + щелчок — начать выбор нескольких
          if (selectable && (e.ctrlKey || e.metaKey) && !task.deleted) return startSelect(task.id);
          openTask(task.id);
        }}
        aria-selected={picking ? picked : undefined}
        {...(picking ? {} : handlers)}
        // мышь — drag-and-drop браузера; палец — долгое нажатие и повести (touchDrag.ts)
        draggable={draggable && finePointer && !picking}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/sm-task', task.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        {picking ? (
          <span className={`tk-pick${picked ? ' on' : ''}`} aria-hidden>
            {picked && <Check size={13} strokeWidth={3.2} />}
          </span>
        ) : (
          <span className={future ? 'tk-check-future' : undefined}>
            <TaskCheck task={completing ? { ...task, done: true } : task} onToggle={done} />
          </span>
        )}
        <div className="tk-body">
          <div className="tk-title">
            {task.pinned && <Pin size={12} className="tk-pin" />}
            {task.title || <span className="faint">{t('Без названия')}</span>}
          </div>
          {(when || task.repeat || task.reminders.length > 0 || task.checklist.length > 0 || task.tags.length > 0 || task.source || task.notes || parentTitle) && (
            <div className="tk-meta">
              {parentTitle !== undefined && (
                <span className="tk-mi-text tk-parent">
                  <CornerDownRight size={12} /> <span className="ellipsis">{parentTitle || t('Без названия')}</span>
                </span>
              )}
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
                  <Timer size={12} /> {t('{n}м', { n: task.focusMinutes })}
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
