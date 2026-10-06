import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUp, Bell, CalendarDays, Flag, HelpCircle, Inbox, Repeat, Tag, X } from 'lucide-react';
import { PRIORITY_META } from '../../utils/mapTasks';
import { parsedReminder, repeatLabel, whenLabel, type Priority, type TaskItem } from '../model';
import { parseTask } from '../parse';
import { addTask, defaultReminders, useTasks } from '../store';
import { askNotifyIfNeeded } from '../sync';
import { DatePicker, type When } from './DatePicker';
import { registerQuickInput } from '../../ui/keyboard';
import { Popover } from './Popover';
import './tasks.css';

/** Окно быстрого добавления (кнопка «+» в любом разделе) */
// Окно всегда в DOM (скрыто, пока закрыто): на iPhone клавиатура открывается, только если
// фокус ставится в уже существующее поле прямо в обработчике нажатия на «+»
export function QuickAddHost() {
  const preset = useTasks((s) => s.quickAdd);
  const [added, setAdded] = useState(0);
  const [round, setRound] = useState(0);
  const open = !!preset;
  const close = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    useTasks.setState({ quickAdd: null });
    setAdded(0);
    // сбросить введённое: новое поле при следующем открытии
    setRound((r) => r + 1);
  };
  return (
    <div
      className={open ? 'modal-backdrop qa-backdrop' : 'qa-hidden'}
      aria-hidden={!open}
      onPointerDown={(e) => open && e.target === e.currentTarget && close()}
    >
      <div className="modal qa-modal">
        <SmartInput key={round} preset={preset ?? {}} quick hidden={!open} onAdded={() => setAdded((n) => n + 1)} onCancel={close} />
        {added > 0 && <div className="tiny muted qa-count">Добавлено: {added}. Можно ввести следующую задачу.</div>}
      </div>
    </div>
  );
}

/**
 * Поле «умного ввода»: дата, время, повтор, приоритет (!1), теги (#тег) и список (~Список)
 * распознаются прямо из текста и подсвечиваются.
 */
export function SmartInput({
  preset,
  quick,
  hidden,
  onAdded,
  onCancel,
  compact,
}: {
  preset: Partial<TaskItem>;
  /** поле окна быстрого ввода (регистрируется для мгновенного фокуса) */
  quick?: boolean;
  hidden?: boolean;
  onAdded?: (t: TaskItem) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const data = useTasks((s) => s.data);
  const [text, setText] = useState('');
  const [manual, setManual] = useState<Partial<When> & { priority?: Priority; listId?: string; tags?: string[] }>({});
  const [picking, setPicking] = useState(false);
  const [prioOpen, setPrioOpen] = useState(false);
  const prioRef = useRef<HTMLButtonElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseTask(text), [text]);

  const listByName = parsed.list ? data?.lists.find((l) => l.name.toLowerCase().startsWith(parsed.list!.toLowerCase())) : undefined;
  // «в 15:00» без даты в разделе «Завтра» или в выбранном дне календаря — на этот день, а не на сегодня
  const date = 'date' in manual ? manual.date : parsed.dateImplicit && preset.date ? preset.date : parsed.date ?? preset.date;
  const time = 'time' in manual ? manual.time : parsed.time ?? (parsed.date ? undefined : preset.time);
  const duration = 'duration' in manual ? manual.duration : parsed.duration ?? preset.duration;
  const repeat = 'repeat' in manual ? manual.repeat : parsed.repeat ?? preset.repeat;
  const priority = manual.priority ?? parsed.priority ?? preset.priority ?? 0;
  const listId = manual.listId ?? listByName?.id ?? preset.listId;
  const tags = [...new Set([...(preset.tags ?? []), ...parsed.tags, ...(manual.tags ?? [])])];
  const reminders =
    'reminders' in manual && manual.reminders
      ? manual.reminders
      : parsed.reminder !== undefined
        ? [parsedReminder(parsed.reminder, !!time)]
        : date && data
          ? defaultReminders(data, !!time)
          : [];
  const list = data?.lists.find((l) => l.id === (listId ?? 'inbox'));

  const submit = () => {
    const title = parsed.title.trim();
    if (!title) return;
    const t = addTask({ ...preset, title, date, time, duration, repeat, priority, listId, tags, reminders });
    if (!t) return;
    setText('');
    setManual({});
    if (t.date && t.reminders.length) void askNotifyIfNeeded();
    onAdded?.(t);
    // клавиатура на телефоне остаётся открытой для следующей задачи
    requestAnimationFrame(() => ref.current?.focus());
  };

  // подсветка распознанных фрагментов: слой с тем же текстом под прозрачным полем
  const highlighted = useMemo(() => {
    const parts: { s: string; hit: boolean }[] = [];
    let i = 0;
    for (const [a, b] of parsed.spans) {
      if (a > i) parts.push({ s: text.slice(i, a), hit: false });
      parts.push({ s: text.slice(a, b), hit: true });
      i = b;
    }
    parts.push({ s: text.slice(i), hit: false });
    return parts;
  }, [parsed, text]);

  const pc = priority ? PRIORITY_META[priority] : undefined;

  return (
    <div className={`qa${compact ? ' compact' : ''}`}>
      <div className="qa-field">
        <div className="qa-hl" aria-hidden>
          {highlighted.map((p, i) => (p.hit ? <mark key={i}>{p.s}</mark> : <span key={i}>{p.s}</span>))}
        </div>
        <input
          ref={(el) => {
            ref.current = el;
            if (quick) registerQuickInput(el);
          }}
          tabIndex={hidden ? -1 : undefined}
          className="qa-input"
          value={text}
          enterKeyHint="send"
          placeholder={compact ? 'Добавить задачу…' : 'Задача, напр. «Созвон завтра в 15:00»'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') onCancel?.();
          }}
        />
        {!compact && (
          <>
            <button ref={helpRef} className="qa-help" onPointerDown={(e) => e.preventDefault()} onClick={() => setHelpOpen(!helpOpen)} aria-label="Как писать даты и метки">
              <HelpCircle size={15} />
            </button>
            {helpOpen && (
              <Popover anchor={helpRef} align="right" onClose={() => setHelpOpen(false)}>
                <div className="qa-help-body">
                  <b>Пишите прямо в тексте — SuperMind поймёт:</b>
                  <p>📅 <i>завтра в 18:30</i>, <i>в пятницу</i>, <i>15 октября</i>, <i>через 2 часа</i>, <i>вечером</i></p>
                  <p>⏱ <i>с 14 до 16</i> — время и длительность</p>
                  <p>🔁 <i>каждый день</i>, <i>по будням</i>, <i>каждый понедельник</i>, <i>каждые 2 недели</i></p>
                  <p>🔔 <i>напомнить за 15 минут</i></p>
                  <p>🚩 <i>!1</i> высокий, <i>!2</i> средний, <i>!3</i> низкий приоритет</p>
                  <p>🏷 <i>#дом</i> — тег, <i>~Работа</i> — список</p>
                </div>
              </Popover>
            )}
          </>
        )}
      </div>
      {(!compact || text) && (
        <div className="qa-bar">
          <div className="qa-chips">
          <button
            className={`qa-chip${date ? ' set' : ''}`}
            onClick={() => {
              setPrioOpen(false);
              // убрать клавиатуру, чтобы она не закрывала окно выбора даты
              ref.current?.blur();
              setPicking(true);
            }}
          >
            <CalendarDays size={15} />
            {date ? whenLabel({ date, time, duration }) : 'Дата'}
            {repeat && <Repeat size={13} />}
            {date && reminders.length > 0 && <Bell size={13} />}
          </button>
          <div className="qa-pop-anchor">
            <button ref={prioRef} className={`qa-chip${pc ? ' set' : ''}`} style={pc ? ({ '--qc': pc.color } as CSSProperties) : undefined} onClick={() => setPrioOpen(!prioOpen)}>
              <Flag size={15} fill={pc ? pc.color : 'none'} />
              {pc ? pc.label : 'Приоритет'}
            </button>
            {prioOpen && (
              <Popover anchor={prioRef} onClose={() => setPrioOpen(false)}>
                {([1, 2, 3, 0] as Priority[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setManual((m) => ({ ...m, priority: p }));
                      setPrioOpen(false);
                    }}
                  >
                    <Flag size={16} color={p ? PRIORITY_META[p].color : 'var(--text-3)'} fill={p ? PRIORITY_META[p].color : 'none'} />
                    {p ? PRIORITY_META[p].label : 'Без приоритета'}
                  </button>
                ))}
              </Popover>
            )}
          </div>
          <label className="qa-chip qa-list">
            {list?.emoji ? <span>{list.emoji}</span> : <Inbox size={15} />}
            <select value={list?.id ?? 'inbox'} onChange={(e) => setManual((m) => ({ ...m, listId: e.target.value }))}>
              {data?.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <span className="ellipsis">{list?.name ?? 'Входящие'}</span>
          </label>
          {tags.map((g) => (
            <span key={g} className="qa-chip set">
              <Tag size={13} />
              {g}
              {manual.tags?.includes(g) && (
                <button className="qa-x" onClick={() => setManual((m) => ({ ...m, tags: m.tags?.filter((x) => x !== g) }))}>
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {repeat && <span className="qa-chip set">{repeatLabel(repeat)}</span>}
          </div>
          <button className="qa-send" onClick={submit} disabled={!parsed.title.trim()} aria-label="Добавить">
            <ArrowUp size={18} />
          </button>
        </div>
      )}
      {picking && (
        <DatePicker
          value={{ date, time, duration, repeat, reminders }}
          onClose={() => setPicking(false)}
          onDone={(v) => {
            setPicking(false);
            setManual((m) => ({ ...m, date: v.date, time: v.time, duration: v.duration, repeat: v.repeat, reminders: v.reminders }));
            requestAnimationFrame(() => ref.current?.focus());
          }}
        />
      )}
    </div>
  );
}

