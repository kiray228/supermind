import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, CheckCheck, Flag, Folder, Hash, Trash2, X } from 'lucide-react';
import { addDaysYmd, PRIORITY_META, todayYmd } from '../../utils/mapTasks';
import { onBack } from '../../ui/dialogs';
import { toast } from '../../store/appStore';
import { allTags, useTasks } from '../store';
import { bulkComplete, bulkTag, bulkTrash, bulkUpdate, endSelect, selectAll, useBulk } from '../bulk';
import { DatePicker } from './DatePicker';
import { Popover } from './Popover';

type Pop = 'date' | 'list' | 'prio' | 'tag' | null;

/** Ближайший понедельник после сегодня */
const nextMonday = (today: string) => {
  const d = new Date(today + 'T00:00:00');
  return addDaysYmd(today, ((8 - d.getDay()) % 7) || 7);
};

/** Панель действий над выбранными задачами (внизу экрана) */
export function BulkBar({ visible }: { visible: string[] }) {
  const ids = useBulk((s) => s.ids) ?? [];
  const data = useTasks((s) => s.data);
  const [pop, setPop] = useState<Pop>(null);
  const [picking, setPicking] = useState(false);
  const [tag, setTag] = useState('');
  const dateBtn = useRef<HTMLButtonElement>(null);
  const listBtn = useRef<HTMLButtonElement>(null);
  const prioBtn = useRef<HTMLButtonElement>(null);
  const tagBtn = useRef<HTMLButtonElement>(null);
  const today = todayYmd();

  // «Назад» на Android и Esc — выйти из выбора
  useEffect(() => onBack(() => (endSelect(), true)), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !pop && !picking && endSelect();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [pop, picking]);

  const n = ids.length;
  const none = () => toast('Выберите задачи');
  /** выполнить действие и выйти из выбора */
  const run = (fn: () => number) => {
    setPop(null);
    if (!n) return none();
    if (fn() > 0) endSelect();
  };
  const allOn = visible.length > 0 && visible.every((x) => ids.includes(x));

  const tags = data ? allTags(data) : [];
  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').replace(/\s+/g, '-');
    if (!t) return;
    setTag('');
    run(() => bulkTag(ids, t));
  };

  return createPortal(
    <div className="tk-bulk" role="toolbar" aria-label="Действия с выбранными задачами">
      <div className="tk-bulk-top">
        <button className="icon-btn" onClick={endSelect} aria-label="Закончить выбор">
          <X size={18} />
        </button>
        <span className="tk-bulk-count">{n ? `Выбрано: ${n}` : 'Выберите задачи'}</span>
        <button className="tk-bulk-all" onClick={() => selectAll(visible)} disabled={!visible.length}>
          {allOn ? 'Снять выбор' : 'Выбрать все'}
        </button>
      </div>
      <div className="tk-bulk-acts">
        <button onClick={() => run(() => bulkComplete(ids))}>
          <CheckCheck size={20} />
          <span>Готово</span>
        </button>
        <button ref={dateBtn} onClick={() => (n ? setPop('date') : none())}>
          <CalendarDays size={20} />
          <span>Дата</span>
        </button>
        <button ref={listBtn} onClick={() => (n ? setPop('list') : none())}>
          <Folder size={20} />
          <span>Список</span>
        </button>
        <button ref={prioBtn} onClick={() => (n ? setPop('prio') : none())}>
          <Flag size={20} />
          <span>Приоритет</span>
        </button>
        <button ref={tagBtn} onClick={() => (n ? setPop('tag') : none())}>
          <Hash size={20} />
          <span>Тег</span>
        </button>
        <button className="danger" onClick={() => run(() => bulkTrash(ids))}>
          <Trash2 size={20} />
          <span>Удалить</span>
        </button>
      </div>

      {pop === 'date' && (
        <Popover anchor={dateBtn} onClose={() => setPop(null)}>
          {(
            [
              ['Сегодня', today],
              ['Завтра', addDaysYmd(today, 1)],
              ['Следующая неделя', nextMonday(today)],
            ] as const
          ).map(([l, d]) => (
            <button key={l} onClick={() => run(() => bulkUpdate(ids, { date: d }, `Перенесено на ${l.toLowerCase()}`))}>
              <span className="tk-sp" /> {l}
            </button>
          ))}
          <button onClick={() => run(() => bulkUpdate(ids, { date: undefined }, 'Без даты'))}>
            <span className="tk-sp" /> Без даты
          </button>
          <div className="sep" />
          <button
            onClick={() => {
              setPop(null);
              setPicking(true);
            }}
          >
            <CalendarDays size={16} /> Выбрать дату…
          </button>
        </Popover>
      )}
      {pop === 'list' && data && (
        <Popover anchor={listBtn} onClose={() => setPop(null)}>
          <div className="td-pop-label">Переместить в список</div>
          {[...data.lists]
            .sort((a, b) => a.order - b.order)
            .map((l) => (
              <button key={l.id} onClick={() => run(() => bulkUpdate(ids, { listId: l.id }, `В список «${l.name}»`))}>
                {l.emoji ? <span className="tk-emoji">{l.emoji}</span> : <i className="tk-dot" style={{ background: l.color }} />} {l.name}
              </button>
            ))}
        </Popover>
      )}
      {pop === 'prio' && (
        <Popover anchor={prioBtn} onClose={() => setPop(null)}>
          {[1, 2, 3, 0].map((p) => (
            <button key={p} onClick={() => run(() => bulkUpdate(ids, { priority: p as 0 | 1 | 2 | 3 }, p ? `Приоритет «${PRIORITY_META[p].label.toLowerCase()}»` : 'Без приоритета'))}>
              <Flag size={16} style={{ color: PRIORITY_META[p]?.color ?? 'var(--text-3)' } as CSSProperties} /> {p ? PRIORITY_META[p].label : 'Без приоритета'}
            </button>
          ))}
        </Popover>
      )}
      {pop === 'tag' && (
        <Popover anchor={tagBtn} onClose={() => setPop(null)}>
          <form
            className="tk-bulk-tag"
            onSubmit={(e) => {
              e.preventDefault();
              addTag(tag);
            }}
          >
            <input className="input" autoFocus value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Новый тег" aria-label="Тег" />
            <button type="submit" className="icon-btn" aria-label="Добавить тег" disabled={!tag.trim()}>
              <Check size={16} />
            </button>
          </form>
          {tags.slice(0, 12).map((g) => (
            <button key={g} onClick={() => addTag(g)}>
              <Hash size={16} /> {g}
            </button>
          ))}
        </Popover>
      )}
      {picking && (
        <DatePicker
          value={{ reminders: [] }}
          onClose={() => setPicking(false)}
          onDone={(v) => {
            setPicking(false);
            if (!v.date) return;
            run(() => bulkUpdate(ids, { date: v.date, time: v.time, duration: v.duration, reminders: v.reminders, repeat: v.repeat, alarm: v.alarm }, 'Новая дата'));
          }}
        />
      )}
    </div>,
    document.body,
  );
}
