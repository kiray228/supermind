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
import { t } from '../../i18n/index';

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
  const none = () => toast(t('Выберите задачи'));
  /** выполнить действие и выйти из выбора */
  const run = (fn: () => number) => {
    setPop(null);
    if (!n) return none();
    if (fn() > 0) endSelect();
  };
  const allOn = visible.length > 0 && visible.every((x) => ids.includes(x));

  const tags = data ? allTags(data) : [];
  const addTag = (raw: string) => {
    const tg = raw.trim().replace(/^#/, '').replace(/\s+/g, '-');
    if (!tg) return;
    setTag('');
    run(() => bulkTag(ids, tg));
  };

  return createPortal(
    <div className="tk-bulk" role="toolbar" aria-label={t('Действия с выбранными задачами')}>
      <div className="tk-bulk-top">
        <button className="icon-btn" onClick={endSelect} aria-label={t('Закончить выбор')}>
          <X size={18} />
        </button>
        <span className="tk-bulk-count">{n ? t('Выбрано: {n}', { n }) : t('Выберите задачи')}</span>
        <button className="tk-bulk-all" onClick={() => selectAll(visible)} disabled={!visible.length}>
          {allOn ? t('Снять выбор') : t('Выбрать все')}
        </button>
      </div>
      <div className="tk-bulk-acts">
        <button onClick={() => run(() => bulkComplete(ids))}>
          <CheckCheck size={20} />
          <span>{t('Готово')}</span>
        </button>
        <button ref={dateBtn} onClick={() => (n ? setPop('date') : none())}>
          <CalendarDays size={20} />
          <span>{t('Дата')}</span>
        </button>
        <button ref={listBtn} onClick={() => (n ? setPop('list') : none())}>
          <Folder size={20} />
          <span>{t('Список')}</span>
        </button>
        <button ref={prioBtn} onClick={() => (n ? setPop('prio') : none())}>
          <Flag size={20} />
          <span>{t('Приоритет')}</span>
        </button>
        <button ref={tagBtn} onClick={() => (n ? setPop('tag') : none())}>
          <Hash size={20} />
          <span>{t('Тег')}</span>
        </button>
        <button className="danger" onClick={() => run(() => bulkTrash(ids))}>
          <Trash2 size={20} />
          <span>{t('Удалить')}</span>
        </button>
      </div>

      {pop === 'date' && (
        <Popover anchor={dateBtn} onClose={() => setPop(null)}>
          {(
            [
              [t('Сегодня'), today, t('Перенесено на сегодня')],
              [t('Завтра'), addDaysYmd(today, 1), t('Перенесено на завтра')],
              [t('Следующая неделя'), nextMonday(today), t('Перенесено на следующую неделю')],
            ] as const
          ).map(([l, d, msg]) => (
            <button key={l} onClick={() => run(() => bulkUpdate(ids, { date: d }, msg))}>
              <span className="tk-sp" /> {l}
            </button>
          ))}
          <button onClick={() => run(() => bulkUpdate(ids, { date: undefined }, t('Без даты')))}>
            <span className="tk-sp" /> {t('Без даты')}
          </button>
          <div className="sep" />
          <button
            onClick={() => {
              setPop(null);
              setPicking(true);
            }}
          >
            <CalendarDays size={16} /> {t('Выбрать дату…')}
          </button>
        </Popover>
      )}
      {pop === 'list' && data && (
        <Popover anchor={listBtn} onClose={() => setPop(null)}>
          <div className="td-pop-label">{t('Переместить в список')}</div>
          {[...data.lists]
            .sort((a, b) => a.order - b.order)
            .map((l) => (
              <button key={l.id} onClick={() => run(() => bulkUpdate(ids, { listId: l.id }, t('В список «{name}»', { name: l.name })))}>
                {l.emoji ? <span className="tk-emoji">{l.emoji}</span> : <i className="tk-dot" style={{ background: l.color }} />} {l.name}
              </button>
            ))}
        </Popover>
      )}
      {pop === 'prio' && (
        <Popover anchor={prioBtn} onClose={() => setPop(null)}>
          {[1, 2, 3, 0].map((p) => (
            <button key={p} onClick={() => run(() => bulkUpdate(ids, { priority: p as 0 | 1 | 2 | 3 }, p ? t('Приоритет «{name}»', { name: PRIORITY_META[p].label.toLowerCase() }) : t('Без приоритета')))}>
              <Flag size={16} style={{ color: PRIORITY_META[p]?.color ?? 'var(--text-3)' } as CSSProperties} /> {p ? PRIORITY_META[p].label : t('Без приоритета')}
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
            <input className="input" autoFocus value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t('Новый тег')} aria-label={t('Тег')} />
            <button type="submit" className="icon-btn" aria-label={t('Добавить тег')} disabled={!tag.trim()}>
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
            run(() => bulkUpdate(ids, { date: v.date, time: v.time, duration: v.duration, reminders: v.reminders, repeat: v.repeat, alarm: v.alarm }, t('Новая дата')));
          }}
        />
      )}
    </div>,
    document.body,
  );
}
