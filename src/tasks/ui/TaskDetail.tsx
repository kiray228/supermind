import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  Copy,
  Flag,
  GripVertical,
  MoreHorizontal,
  Network,
  Pin,
  Plus,
  Repeat,
  Sparkles,
  Tag,
  Timer,
  Trash2,
  X,
  Ban,
  Undo2,
} from 'lucide-react';
import { PRIORITY_META, todayYmd } from '../../utils/mapTasks';
import { uid } from '../../utils/tree';
import { toast, useApp } from '../../store/appStore';
import { openDoc } from '../../actions';
import { isOverdue, repeatLabel, reminderLabel, whenLabel, type ChecklistItem, type Priority, type TaskItem } from '../model';
import { allTags, duplicateTask, openTask, purgeTask, restoreTask, setWontDo, toggleDone, trashTask, updateTask, useTasks } from '../store';
import { addTaskToCalendar, askNotifyIfNeeded } from '../sync';
import { DatePicker } from './DatePicker';
import { TaskCheck } from './TaskRow';
import './tasks.css';

/** Окно задачи поверх любого раздела */
export function TaskDetailHost() {
  const id = useTasks((s) => s.openTaskId);
  const task = useTasks((s) => (id ? s.data?.tasks.find((t) => t.id === id) : undefined));
  if (!id || !task) return null;
  return <TaskDetail key={id} task={task} onClose={() => openTask(null)} />;
}

const PRIORITIES: { p: Priority; label: string; color: string }[] = [
  { p: 1, label: 'Высокий', color: PRIORITY_META[1].color },
  { p: 2, label: 'Средний', color: PRIORITY_META[2].color },
  { p: 3, label: 'Низкий', color: PRIORITY_META[3].color },
  { p: 0, label: 'Без приоритета', color: 'var(--text-3)' },
];

function TaskDetail({ task, onClose }: { task: TaskItem; onClose: () => void }) {
  const data = useTasks((s) => s.data)!;
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState<'more' | 'prio' | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const latest = useRef({ title, notes, task });
  latest.current = { title, notes, task };

  // несохранённые название и описание записываются при закрытии окна
  useEffect(
    () => () => {
      const { title: t, notes: n, task: tk } = latest.current;
      const patch: Partial<TaskItem> = {};
      if (t.trim() && t.trim() !== tk.title) patch.title = t.trim();
      if (n !== (tk.notes ?? '')) patch.notes = n || undefined;
      if (Object.keys(patch).length) updateTask(tk.id, patch);
    },
    [],
  );

  const save = (p: Partial<TaskItem>) => updateTask(task.id, p);
  const commitTitle = () => title.trim() && title.trim() !== task.title && save({ title: title.trim() });
  const commitNotes = () => notes !== (task.notes ?? '') && save({ notes: notes || undefined });

  const setChecklist = (fn: (c: ChecklistItem[]) => ChecklistItem[]) => save({ checklist: fn(task.checklist) });
  const list = data.lists.find((l) => l.id === task.listId);
  const pc = task.priority ? PRIORITY_META[task.priority] : undefined;
  const overdue = isOverdue(task);
  const tags = allTags(data).filter((g) => !task.tags.includes(g) && g.toLowerCase().includes(tagInput.toLowerCase().replace(/^#/, '')));

  const addTag = (g: string) => {
    const v = g.trim().replace(/^#/, '').replace(/\s+/g, '_');
    if (v && !task.tags.includes(v)) save({ tags: [...task.tags, v] });
    setTagInput('');
  };

  const aiSplit = async () => {
    if (!useApp.getState().settings.apiKey.trim()) {
      toast('Добавьте API-ключ Claude в Настройках');
      return;
    }
    setAiBusy(true);
    try {
      const { streamText } = await import('../../ai/claude');
      const r = await streamText({
        system: 'Ты помощник по планированию. Разбей задачу на 3–8 конкретных выполнимых шагов. Ответ — только список шагов, по одному на строку, без нумерации и пояснений, на русском.',
        messages: [{ role: 'user', content: `Задача: ${task.title}${task.notes ? `\nОписание: ${task.notes}` : ''}` }],
        effort: 'low',
      });
      const steps = r
        .split('\n')
        .map((s) => s.replace(/^[\s\-–•*\d.)]+/, '').trim())
        .filter(Boolean)
        .slice(0, 12);
      if (steps.length) setChecklist((c) => [...c, ...steps.map((text) => ({ id: uid(), text, done: false }))]);
      toast(`Добавлено подзадач: ${steps.length}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const startFocus = async () => {
    try {
      const { useFocus } = await import('../focusTimer');
      const f = useFocus.getState();
      f.setTask(task.id);
      f.start();
      onClose();
      useApp.getState().go('focus');
    } catch {
      toast('Таймер фокуса недоступен');
    }
  };

  return (
    <div className="modal-backdrop td-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal td-modal"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        onPointerDown={(e) => menu && !(e.target as Element).closest('.td-pop-anchor') && setMenu(null)}
      >
        {/* верхняя строка: выполнено, дата, приоритет, меню */}
        <div className="td-top">
          <TaskCheck task={task} onToggle={() => toggleDone(task.id)} />
          <button className={`td-when${overdue ? ' overdue' : ''}${task.date ? ' set' : ''}`} onClick={() => setPicking(true)}>
            <CalendarDays size={16} />
            <span className="ellipsis">{task.date ? whenLabel(task) : 'Дата и напоминание'}</span>
            {task.repeat && <Repeat size={13} />}
            {task.date && task.reminders.length > 0 && <Bell size={13} />}
          </button>
          <div className="grow" />
          <div className="td-pop-anchor">
            <button className="icon-btn" onClick={() => setMenu(menu === 'prio' ? null : 'prio')} aria-label="Приоритет" style={pc ? { color: pc.color } : undefined}>
              <Flag fill={pc ? pc.color : 'none'} />
            </button>
            {menu === 'prio' && (
              <div className="td-pop">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.p}
                    className={task.priority === p.p ? 'active' : ''}
                    onClick={() => {
                      save({ priority: p.p });
                      setMenu(null);
                    }}
                  >
                    <Flag size={16} color={p.color} fill={p.p ? p.color : 'none'} /> {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="td-pop-anchor">
            <button className="icon-btn" onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-label="Ещё">
              <MoreHorizontal />
            </button>
            {menu === 'more' && (
              <div className="td-pop right">
                <button onClick={() => (setMenu(null), void addTaskToCalendar(task))}>
                  <CalendarPlus size={16} /> Добавить в календарь телефона
                </button>
                <button onClick={() => (setMenu(null), void startFocus())}>
                  <Timer size={16} /> Начать фокус (помодоро)
                </button>
                <button onClick={() => (setMenu(null), void aiSplit())} disabled={aiBusy}>
                  <Sparkles size={16} /> ИИ: разбить на подзадачи
                </button>
                <button onClick={() => (setMenu(null), save({ pinned: !task.pinned || undefined }))}>
                  <Pin size={16} /> {task.pinned ? 'Открепить' : 'Закрепить сверху'}
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    const c = duplicateTask(task.id);
                    if (c) openTask(c.id);
                  }}
                >
                  <Copy size={16} /> Дублировать
                </button>
                {!task.done && !task.wontDo && (
                  <button onClick={() => (setMenu(null), setWontDo(task.id))}>
                    <Ban size={16} /> Не буду делать
                  </button>
                )}
                {task.source && (
                  <button onClick={() => (onClose(), void openDoc(task.source!.docId, task.source!.topicId))}>
                    <Network size={16} /> Открыть в карте
                  </button>
                )}
                <div className="sep" />
                {task.deleted ? (
                  <>
                    <button onClick={() => (setMenu(null), restoreTask(task.id))}>
                      <Undo2 size={16} /> Восстановить
                    </button>
                    <button className="danger" onClick={() => (onClose(), purgeTask(task.id))}>
                      <Trash2 size={16} /> Удалить навсегда
                    </button>
                  </>
                ) : (
                  <button
                    className="danger"
                    onClick={() => {
                      onClose();
                      trashTask(task.id);
                      toast('Задача в корзине');
                    }}
                  >
                    <Trash2 size={16} /> Удалить
                  </button>
                )}
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X />
          </button>
        </div>

        {(task.deleted || task.wontDo) && (
          <div className="td-banner">
            {task.deleted ? 'Задача в корзине' : 'Отмечено «Не буду делать»'}
            <button className="btn btn-sm" onClick={() => (task.deleted ? restoreTask(task.id) : toggleDone(task.id))}>
              Вернуть
            </button>
          </div>
        )}

        <AutoText
          className={`td-title${task.done ? ' done' : ''}`}
          value={title}
          placeholder="Что нужно сделать?"
          onChange={setTitle}
          onBlur={commitTitle}
          onEnter={commitTitle}
        />
        <AutoText className="td-notes" value={notes} placeholder="Описание, заметки, ссылки…" onChange={setNotes} onBlur={commitNotes} multiline />

        {/* подзадачи */}
        <div className="td-section">
          {task.checklist.length > 0 && (
            <div className="td-progress">
              <span style={{ width: `${(task.checklist.filter((c) => c.done).length / task.checklist.length) * 100}%` }} />
            </div>
          )}
          {task.checklist.map((c, i) => (
            <ChecklistRow
              key={c.id}
              item={c}
              onChange={(p) => setChecklist((all) => all.map((x) => (x.id === c.id ? { ...x, ...p } : x)))}
              onDelete={() => setChecklist((all) => all.filter((x) => x.id !== c.id))}
              onEnter={() => {
                const n = { id: uid(), text: '', done: false };
                setChecklist((all) => [...all.slice(0, i + 1), n, ...all.slice(i + 1)]);
                setTimeout(() => document.querySelector<HTMLInputElement>(`[data-ck="${n.id}"]`)?.focus(), 30);
              }}
              onMove={(dir) =>
                setChecklist((all) => {
                  const j = i + dir;
                  if (j < 0 || j >= all.length) return all;
                  const a = [...all];
                  [a[i], a[j]] = [a[j], a[i]];
                  return a;
                })
              }
            />
          ))}
          <AddLine
            placeholder="Добавить подзадачу"
            onAdd={(text) => setChecklist((all) => [...all, { id: uid(), text, done: false }])}
          />
        </div>

        {/* параметры */}
        <div className="td-props">
          <label className="td-prop">
            <span className="td-prop-label">Список</span>
            <span className="td-list-dot" style={{ background: list?.color }} />
            <select className="td-select" value={task.listId} onChange={(e) => save({ listId: e.target.value })}>
              {data.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.emoji ? l.emoji + ' ' : ''}
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <div className="td-prop td-tags">
            <span className="td-prop-label">
              <Tag size={14} /> Теги
            </span>
            {task.tags.map((g) => (
              <span key={g} className="tk-tag big" style={data.tagColors[g] ? ({ '--tc': data.tagColors[g] } as CSSProperties) : undefined}>
                #{g}
                <button onClick={() => save({ tags: task.tags.filter((x) => x !== g) })} aria-label="Убрать тег">
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              className="td-tag-input"
              placeholder="+ тег"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              onBlur={() => tagInput.trim() && addTag(tagInput)}
            />
            {tagInput && tags.length > 0 && (
              <div className="td-tag-sugg">
                {tags.slice(0, 6).map((g) => (
                  <button key={g} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => addTag(g)}>
                    #{g}
                  </button>
                ))}
              </div>
            )}
          </div>

          {task.date && (
            <button className="td-prop td-prop-btn" onClick={() => setPicking(true)}>
              <span className="td-prop-label">
                <Bell size={14} /> Напоминания
              </span>
              <span className="small grow">{task.reminders.length ? task.reminders.map((r) => reminderLabel(r, !!task.time)).join(', ') : 'нет'}</span>
            </button>
          )}
          {task.repeat && (
            <button className="td-prop td-prop-btn" onClick={() => setPicking(true)}>
              <span className="td-prop-label">
                <Repeat size={14} /> Повтор
              </span>
              <span className="small grow">{repeatLabel(task.repeat)}</span>
            </button>
          )}
          {task.source && (
            <button className="td-prop td-prop-btn" onClick={() => (onClose(), void openDoc(task.source!.docId, task.source!.topicId))}>
              <span className="td-prop-label">
                <Network size={14} /> Карта
              </span>
              <span className="small grow ellipsis">{task.source.docTitle || 'Открыть тему'}</span>
            </button>
          )}
        </div>

        <div className="td-foot tiny faint">
          Создано {new Date(task.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {task.completedAt && ` · выполнено ${new Date(task.completedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
          {!!task.repeatDone && ` · повторов выполнено: ${task.repeatDone}`}
          {!!task.focusMinutes && ` · фокус: ${task.focusMinutes} мин`}
        </div>
      </div>

      {picking && (
        <DatePicker
          value={task}
          onClose={() => setPicking(false)}
          onDone={(v) => {
            setPicking(false);
            save({ date: v.date, time: v.time, duration: v.duration, reminders: v.reminders, repeat: v.repeat });
            if (v.date && v.reminders.length && todayYmd() <= v.date) void askNotifyIfNeeded();
          }}
        />
      )}
    </div>
  );
}

function ChecklistRow({
  item,
  onChange,
  onDelete,
  onEnter,
  onMove,
}: {
  item: ChecklistItem;
  onChange: (p: Partial<ChecklistItem>) => void;
  onDelete: () => void;
  onEnter: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [text, setText] = useState(item.text);
  useEffect(() => setText(item.text), [item.text]);
  return (
    <div className={`td-ck${item.done ? ' done' : ''}`}>
      <GripVertical size={14} className="td-grip" />
      <button className={`td-ck-box${item.done ? ' on' : ''}`} onClick={() => onChange({ done: !item.done })} aria-label="Готово">
        {item.done && '✓'}
      </button>
      <input
        data-ck={item.id}
        className="td-ck-text"
        value={text}
        placeholder="Подзадача"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (text.trim() ? text !== item.text && onChange({ text }) : onDelete())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (text.trim()) {
              if (text !== item.text) onChange({ text });
              onEnter();
            }
          } else if (e.key === 'Backspace' && !text) {
            e.preventDefault();
            onDelete();
          } else if (e.altKey && e.key === 'ArrowUp') onMove(-1);
          else if (e.altKey && e.key === 'ArrowDown') onMove(1);
        }}
      />
      <button className="td-ck-del" onClick={onDelete} aria-label="Удалить подзадачу">
        <X size={14} />
      </button>
    </div>
  );
}

export function AddLine({ placeholder, onAdd }: { placeholder: string; onAdd: (t: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="td-add">
      <Plus size={16} />
      <input
        value={text}
        placeholder={placeholder}
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            e.preventDefault();
            onAdd(text.trim());
            setText('');
          }
        }}
        onBlur={() => {
          if (text.trim()) {
            onAdd(text.trim());
            setText('');
          }
        }}
      />
    </div>
  );
}

/** Поле, растущее по высоте текста */
function AutoText({
  value,
  onChange,
  onBlur,
  onEnter,
  placeholder,
  className,
  multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onEnter?: () => void;
  placeholder: string;
  className: string;
  multiline?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(multiline ? e.target.value : e.target.value.replace(/\n/g, ' '))}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter') {
          e.preventDefault();
          onEnter?.();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}
