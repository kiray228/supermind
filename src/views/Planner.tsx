import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Flame,
  ListChecks,
  Network,
  Plus,
  Settings2,
  Smile,
  Trash2,
  X,
} from 'lucide-react';
import type { Habit, PlannerData, PlannerDay } from '../types';
import { useTasks, ensureTasks, addTask } from '../tasks/store';
import { compareTasks, occurrences, parsedReminder } from '../tasks/model';
import { parseTask } from '../tasks/parse';
import { askNotifyIfNeeded, syncSoon } from '../tasks/sync';
import { TaskRow } from '../tasks/ui/TaskRow';
import '../tasks/ui/tasks.css';
import { loadAllDocs, loadPlanner, savePlanner } from '../store/db';
import { addDaysYmd, collectMapTasks, fromYmd, PRIORITY_META, todayYmd, toYmd, updateMapTask } from '../utils/mapTasks';
import type { MapTask } from '../utils/mapTasks';
import { uid } from '../utils/tree';
import { openDoc } from '../actions';
import { confirmDialog } from '../ui/dialogs';
import { toast } from '../store/appStore';
import './views.css';

// ---------- Константы ----------

const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_SHORT_BY_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MOODS = ['😄', '🙂', '😐', '😕', '😢', '😡', '🤩', '😴'];
const MOOD_NAMES: Record<string, string> = {
  '😄': 'Отлично',
  '🙂': 'Хорошо',
  '😐': 'Нормально',
  '😕': 'Так себе',
  '😢': 'Грустно',
  '😡': 'Злость',
  '🤩': 'Восторг',
  '😴': 'Усталость',
};
const HABIT_COLORS = ['#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#64748b'];

const emptyDay = (): PlannerDay => ({ journal: '', tasks: [] });
const isEmptyDay = (d: PlannerDay) => !d.journal.trim() && !d.mood && !d.tasks?.length && !d.habits?.length;

/** Понедельник недели, в которую входит дата */
function mondayOf(ymd: string): string {
  const d = fromYmd(ymd);
  const shift = (d.getDay() + 6) % 7;
  return addDaysYmd(ymd, -shift);
}

function longTitle(ymd: string): string {
  const d = fromYmd(ymd);
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${y}`;
}

function relativeLabel(ymd: string, today: string): string {
  if (ymd === today) return 'Сегодня';
  if (ymd === addDaysYmd(today, 1)) return 'Завтра';
  if (ymd === addDaysYmd(today, -1)) return 'Вчера';
  const diff = Math.round((fromYmd(ymd).getTime() - fromYmd(today).getTime()) / 86400000);
  const n = Math.abs(diff);
  const word = n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней';
  return diff > 0 ? `Через ${n} ${word}` : `${n} ${word} назад`;
}

interface DayMarks {
  t?: boolean;
  j?: boolean;
  m?: boolean;
}

// ---------- Ежедневник ----------

export default function Planner() {
  const [data, setData] = useState<PlannerData | null>(null);
  const dataRef = useRef<PlannerData | null>(null);
  const [date, setDate] = useState(todayYmd);
  const [mapTasks, setMapTasks] = useState<MapTask[]>([]);
  const [calOpen, setCalOpen] = useState(false);
  const [habitsOpen, setHabitsOpen] = useState(false);
  const tasksDataState = useTasks((s) => s.data);
  const today = todayYmd();

  useEffect(() => {
    let alive = true;
    // задачи дня хранятся в общем списке задач — сначала он (перенос старых задач ежедневника)
    ensureTasks().then(() => loadPlanner()).then((p) => {
      if (!alive) return;
      const n: PlannerData = { days: p.days ?? {}, habits: p.habits ?? [] };
      dataRef.current = n;
      setData(n);
    });
    loadAllDocs()
      .then((docs) => alive && setMapTasks(collectMapTasks(docs)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // привычку отметили из уведомления — перечитать ежедневник
  useEffect(() => {
    const reload = () =>
      void loadPlanner().then((p) => {
        const n: PlannerData = { days: p.days ?? {}, habits: p.habits ?? [] };
        dataRef.current = n;
        setData(n);
      });
    window.addEventListener('sm-planner-changed', reload);
    return () => window.removeEventListener('sm-planner-changed', reload);
  }, []);

  const commit = useCallback((p: PlannerData) => {
    dataRef.current = p;
    setData(p);
    savePlanner(p).catch(() => toast('Не удалось сохранить ежедневник'));
  }, []);

  const updateDays = useCallback(
    (fn: (get: (ymd: string) => PlannerDay, put: (ymd: string, d: PlannerDay) => void) => void) => {
      const p = dataRef.current;
      if (!p) return;
      const days = { ...p.days };
      fn(
        (ymd) => ({ ...(days[ymd] ?? emptyDay()) }),
        (ymd, d) => {
          if (isEmptyDay(d)) delete days[ymd];
          else days[ymd] = d;
        },
      );
      commit({ ...p, days });
    },
    [commit],
  );

  const updateDay = useCallback(
    (ymd: string, fn: (d: PlannerDay) => PlannerDay) => updateDays((get, put) => put(ymd, fn(get(ymd)))),
    [updateDays],
  );

  const saveJournal = useCallback((ymd: string, text: string) => updateDay(ymd, (d) => ({ ...d, journal: text })), [updateDay]);

  // отметки для календаря
  const marks = useMemo(() => {
    const m: Record<string, DayMarks> = {};
    if (data)
      for (const [k, d] of Object.entries(data.days)) {
        m[k] = { j: !!d.journal.trim() };
      }
    for (const t of mapTasks) if (t.task.due) (m[t.task.due] ??= {}).m = true;
    for (const t of tasksDataState?.tasks ?? []) if (t.date && !t.deleted && !t.wontDo) (m[t.date] ??= {}).t = true;
    return m;
  }, [data, mapTasks, tasksDataState]);

  if (!data) {
    return (
      <div className="page pl-page">
        <div className="page-header">
          <h1>Ежедневник</h1>
        </div>
        <div className="page-body">
          <div className="empty">Загрузка…</div>
        </div>
      </div>
    );
  }

  const day = data.days[date] ?? emptyDay();
  const tasks = (tasksDataState?.tasks ?? [])
    .filter((t) => !t.deleted && !t.wontDo && (t.date === date || (t.repeat && !t.done && occurrences(t, date, date).length > 0)))
    .sort((a, b) => compareTasks(a, b, 'date'));
  const doneCount = tasks.filter((t) => t.done).length;

  // ----- задачи дня (общий список задач с напоминаниями) -----
  const addDayTask = (raw: string) => {
    const p = parseTask(raw);
    if (!p.title.trim()) return;
    const list = p.list ? tasksDataState?.lists.find((l) => l.name.toLowerCase().startsWith(p.list!.toLowerCase())) : undefined;
    const t = addTask({
      title: p.title,
      date: p.dateImplicit || !p.date ? date : p.date,
      time: p.time,
      duration: p.duration,
      repeat: p.repeat,
      priority: p.priority ?? 0,
      tags: p.tags,
      listId: list?.id,
      ...(p.reminder !== undefined ? { reminders: [parsedReminder(p.reminder, !!p.time)] } : {}),
    });
    if (t?.reminders.length) void askNotifyIfNeeded();
  };

  // ----- задачи из карт -----
  // темы карт, у которых уже есть задача с напоминанием, показываются как задача — без дубля
  const linked = new Set((tasksDataState?.tasks ?? []).filter((t) => t.source && !t.deleted).map((t) => t.source!.topicId));
  const unlinked = mapTasks.filter((t) => !linked.has(t.topicId));
  const dueMaps = unlinked.filter((t) => t.task.due === date);
  const overdueMaps = date === today ? unlinked.filter((t) => t.task.due && t.task.due < today && t.task.status !== 'done') : [];
  const toggleMap = async (t: MapTask) => {
    const done = t.task.status !== 'done';
    const patch = done ? { status: 'done' as const, progress: 100 } : { status: 'todo' as const };
    setMapTasks((ts) => ts.map((x) => (x.docId === t.docId && x.topicId === t.topicId ? { ...x, task: { ...x.task, ...patch } } : x)));
    try {
      await updateMapTask(t.docId, t.topicId, patch);
    } catch {
      toast('Не удалось обновить задачу в карте');
    }
  };

  // ----- привычки -----
  const habitDone = (ymd: string, id: string) => !!data.days[ymd]?.habits?.includes(id);
  const toggleHabit = (id: string) =>
    updateDay(date, (d) => {
      const hs = d.habits ?? [];
      return { ...d, habits: hs.includes(id) ? hs.filter((x) => x !== id) : [...hs, id] };
    });
  const streakOf = (id: string) => {
    let d = habitDone(date, id) ? date : addDaysYmd(date, -1);
    let n = 0;
    while (habitDone(d, id) && n < 10000) {
      n++;
      d = addDaysYmd(d, -1);
    }
    return n;
  };
  const setHabitRemind = (h: Habit, remind: string | undefined) => {
    const p = dataRef.current!;
    commit({ ...p, habits: p.habits.map((x) => (x.id === h.id ? { ...x, remind } : x)) });
    if (remind) void askNotifyIfNeeded();
    syncSoon(300);
  };
  const addHabit = (name: string, color: string) => {
    const p = dataRef.current!;
    commit({ ...p, habits: [...p.habits, { id: uid(), name, color }] });
  };
  const deleteHabit = async (h: Habit) => {
    const ok = await confirmDialog(`Удалить привычку «${h.name}»?`, 'История отметок этой привычки тоже будет удалена.', { okText: 'Удалить', danger: true });
    if (!ok) return;
    const p = dataRef.current!;
    const days: Record<string, PlannerDay> = {};
    for (const [k, d] of Object.entries(p.days)) {
      const nd = d.habits?.includes(h.id) ? { ...d, habits: d.habits.filter((x) => x !== h.id) } : d;
      if (!isEmptyDay(nd)) days[k] = nd;
    }
    commit({ habits: p.habits.filter((x) => x.id !== h.id), days });
  };

  const pick = (ymd: string) => {
    setDate(ymd);
    setCalOpen(false);
  };

  const habitsDoneToday = data.habits.filter((h) => habitDone(date, h.id)).length;

  return (
    <div className="page pl-page">
      <div className="page-header">
        <h1>Ежедневник</h1>
        <div className="grow" />
        <div className="row">
          <button className="btn btn-sm pl-mobile-only" onClick={() => setCalOpen(true)}>
            <CalendarDays size={16} /> Календарь
          </button>
          <button className="btn btn-sm" disabled={date === today} onClick={() => setDate(today)}>
            Сегодня
          </button>
        </div>
      </div>

      <div className="page-body pl-body">
        <div className="pl-layout">
          <aside className="pl-side">
            <div className="card pl-cal-card">
              <MonthCalendar selected={date} today={today} marks={marks} onPick={pick} />
            </div>
            <CalendarLegend />
          </aside>

          <main className="pl-main">
            <WeekStrip selected={date} today={today} marks={marks} onPick={pick} />

            <div className="pl-day-head">
              <button className="icon-btn pl-nav" onClick={() => setDate(addDaysYmd(date, -1))} aria-label="Предыдущий день">
                <ChevronLeft />
              </button>
              <div className="grow pl-day-title">
                <div className={`pl-day-rel${date === today ? ' is-today' : ''}`}>{relativeLabel(date, today)}</div>
                <h2>{longTitle(date)}</h2>
              </div>
              {day.mood && (
                <span className="pl-day-mood" title={MOOD_NAMES[day.mood]}>
                  {day.mood}
                </span>
              )}
              <button className="icon-btn pl-nav" onClick={() => setDate(addDaysYmd(date, 1))} aria-label="Следующий день">
                <ChevronRight />
              </button>
            </div>

            <div className="pl-sections">
              <div className="pl-col">
                {/* a) Задачи дня */}
                <section className="card pl-section">
                  <header className="pl-sec-head">
                    <ListChecks size={18} className="pl-sec-icon" />
                    <h3>Задачи дня</h3>
                    <div className="grow" />
                    {tasks.length > 0 && (
                      <span className="pl-sec-meta">
                        {doneCount} из {tasks.length}
                      </span>
                    )}
                  </header>
                  {tasks.length > 0 && (
                    <div className={`pl-progress${doneCount === tasks.length ? ' is-full' : ''}`}>
                      <span style={{ width: `${(doneCount / tasks.length) * 100}%` }} />
                    </div>
                  )}
                  <div className="pl-tasks">
                    {tasks.map((t) => (
                      <TaskRow key={t.id} task={t} occurrence={date} list={tasksDataState?.lists.find((l) => l.id === t.listId)} timeOnly tagColors={tasksDataState?.tagColors} />
                    ))}
                  </div>
                  <AddTaskInput key={date} onAdd={addDayTask} />
                </section>

                {/* b) Из карт */}
                <section className="card pl-section">
                  <header className="pl-sec-head">
                    <Network size={18} className="pl-sec-icon" />
                    <h3>Из карт</h3>
                    <div className="grow" />
                    {dueMaps.length + overdueMaps.length > 0 && <span className="pl-sec-meta">{dueMaps.length + overdueMaps.length}</span>}
                  </header>
                  {dueMaps.length + overdueMaps.length === 0 ? (
                    <div className="pl-empty-line">Нет задач из карт со сроком на этот день</div>
                  ) : (
                    <div className="pl-tasks">
                      {overdueMaps.map((t) => (
                        <MapTaskRow key={`o-${t.docId}-${t.topicId}`} task={t} overdue onToggle={() => toggleMap(t)} />
                      ))}
                      {dueMaps.map((t) => (
                        <MapTaskRow key={`${t.docId}-${t.topicId}`} task={t} onToggle={() => toggleMap(t)} />
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <div className="pl-col">
                {/* c) Настроение */}
                <section className="card pl-section">
                  <header className="pl-sec-head">
                    <Smile size={18} className="pl-sec-icon" />
                    <h3>Настроение</h3>
                    <div className="grow" />
                    {day.mood && <span className="pl-sec-meta">{MOOD_NAMES[day.mood] ?? ''}</span>}
                  </header>
                  <div className="pl-moods">
                    {MOODS.map((m) => (
                      <button
                        key={m}
                        className={`pl-mood${day.mood === m ? ' active' : ''}`}
                        title={MOOD_NAMES[m]}
                        aria-pressed={day.mood === m}
                        onClick={() => updateDay(date, (d) => ({ ...d, mood: d.mood === m ? undefined : m }))}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </section>

                {/* d) Привычки */}
                <section className="card pl-section">
                  <header className="pl-sec-head">
                    <Flame size={18} className="pl-sec-icon" />
                    <h3>Привычки</h3>
                    <div className="grow" />
                    {data.habits.length > 0 && (
                      <span className="pl-sec-meta">
                        {habitsDoneToday} из {data.habits.length}
                      </span>
                    )}
                    <button className="icon-btn pl-sec-btn" onClick={() => setHabitsOpen(true)} title="Настроить привычки">
                      <Settings2 />
                    </button>
                  </header>
                  {data.habits.length === 0 ? (
                    <div className="pl-empty-line">
                      <button className="btn btn-sm" onClick={() => setHabitsOpen(true)}>
                        <Plus size={15} /> Добавить привычку
                      </button>
                    </div>
                  ) : (
                    <div className="pl-habits">
                      {data.habits.map((h) => {
                        const on = habitDone(date, h.id);
                        const streak = streakOf(h.id);
                        return (
                          <div key={h.id} className={`pl-habit${on ? ' on' : ''}`} style={{ ['--hc' as string]: h.color }}>
                            <button className="pl-habit-toggle" onClick={() => toggleHabit(h.id)} aria-pressed={on} aria-label={h.name}>
                              {on ? <Check size={16} strokeWidth={3} /> : h.icon ?? null}
                            </button>
                            <div className="grow pl-habit-body" onClick={() => toggleHabit(h.id)}>
                              <div className="pl-habit-name ellipsis">{h.name}</div>
                              <div className="pl-habit-week">
                                {Array.from({ length: 7 }, (_, i) => {
                                  const d = addDaysYmd(date, i - 6);
                                  return (
                                    <span
                                      key={d}
                                      className={`pl-habit-cell${habitDone(d, h.id) ? ' on' : ''}${d === date ? ' cur' : ''}`}
                                      title={`${fromYmd(d).getDate()} ${MONTHS_GEN[fromYmd(d).getMonth()]}`}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                            <span className={`pl-streak${streak > 0 ? ' active' : ''}`} title="Серия дней подряд">
                              <Flame size={14} />
                              {streak}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* e) Дневник */}
                <section className="card pl-section">
                  <header className="pl-sec-head">
                    <BookOpen size={18} className="pl-sec-icon" />
                    <h3>Дневник</h3>
                  </header>
                  <Journal key={date} date={date} initial={day.journal} onSave={saveJournal} />
                </section>
              </div>
            </div>
          </main>
        </div>
      </div>

      {calOpen && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setCalOpen(false)}>
          <div className="modal pl-cal-modal" onKeyDown={(e) => e.key === 'Escape' && setCalOpen(false)}>
            <div className="row" style={{ marginBottom: 8 }}>
              <h2 className="grow">Календарь</h2>
              <button className="icon-btn" onClick={() => setCalOpen(false)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <MonthCalendar selected={date} today={today} marks={marks} onPick={pick} />
            <CalendarLegend />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => pick(today)}>
                Сегодня
              </button>
            </div>
          </div>
        </div>
      )}

      {habitsOpen && <HabitsModal habits={data.habits} onAdd={addHabit} onRemind={setHabitRemind} onDelete={deleteHabit} onClose={() => setHabitsOpen(false)} />}
    </div>
  );
}

// ---------- Календарь ----------

function MonthCalendar({
  selected,
  today,
  marks,
  onPick,
}: {
  selected: string;
  today: string;
  marks: Record<string, DayMarks>;
  onPick: (ymd: string) => void;
}) {
  const sel = fromYmd(selected);
  const [view, setView] = useState({ y: sel.getFullYear(), m: sel.getMonth() });
  useEffect(() => {
    const d = fromYmd(selected);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  }, [selected]);

  const first = toYmd(new Date(view.y, view.m, 1));
  const start = mondayOf(first);
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDaysYmd(start, i));
  const shift = (n: number) => setView((v) => {
    const d = new Date(v.y, v.m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  return (
    <div className="pl-cal">
      <div className="pl-cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Предыдущий месяц">
          <ChevronLeft />
        </button>
        <div className="grow pl-cal-title">
          {MONTHS[view.m]} <span className="faint">{view.y}</span>
        </div>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Следующий месяц">
          <ChevronRight />
        </button>
      </div>
      <div className="pl-cal-grid">
        {WD_SHORT.map((w, i) => (
          <div key={w} className={`pl-cal-wd${i >= 5 ? ' we' : ''}`}>
            {w}
          </div>
        ))}
        {cells.map((ymd) => {
          const d = fromYmd(ymd);
          const out = d.getMonth() !== view.m;
          const mk = marks[ymd];
          return (
            <button
              key={ymd}
              className={`pl-cal-day${out ? ' out' : ''}${ymd === today ? ' today' : ''}${ymd === selected ? ' sel' : ''}`}
              onClick={() => onPick(ymd)}
            >
              <span className="pl-cal-num">{d.getDate()}</span>
              <span className="pl-dots">
                {mk?.t && <i className="pl-dot-t" />}
                {mk?.j && <i className="pl-dot-j" />}
                {mk?.m && <i className="pl-dot-m" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CalendarLegend() {
  return (
    <div className="pl-legend tiny muted">
      <span>
        <i className="pl-dot-t" /> Задачи
      </span>
      <span>
        <i className="pl-dot-j" /> Дневник
      </span>
      <span>
        <i className="pl-dot-m" /> Сроки в картах
      </span>
    </div>
  );
}

function WeekStrip({
  selected,
  today,
  marks,
  onPick,
}: {
  selected: string;
  today: string;
  marks: Record<string, DayMarks>;
  onPick: (ymd: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = addDaysYmd(mondayOf(selected), -14);
  const days = Array.from({ length: 35 }, (_, i) => addDaysYmd(start, i));
  const firstScroll = useRef(true);
  useEffect(() => {
    const strip = ref.current;
    const el = strip?.querySelector<HTMLElement>('.pl-week-day.sel');
    if (!strip || !el) return;
    const sr = strip.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const left = strip.scrollLeft + (er.left - sr.left) - strip.clientWidth / 2 + er.width / 2;
    strip.scrollTo({ left, behavior: firstScroll.current ? 'auto' : 'smooth' });
    firstScroll.current = false;
  }, [selected]);
  return (
    <div className="pl-week pl-mobile-only" ref={ref}>
      {days.map((ymd) => {
        const d = fromYmd(ymd);
        const mk = marks[ymd];
        const wd = d.getDay();
        return (
          <button
            key={ymd}
            className={`pl-week-day${ymd === selected ? ' sel' : ''}${ymd === today ? ' today' : ''}${wd === 0 || wd === 6 ? ' we' : ''}`}
            onClick={() => onPick(ymd)}
          >
            <span className="pl-week-wd">{WD_SHORT_BY_DAY[wd]}</span>
            <span className="pl-week-num">{d.getDate()}</span>
            <span className="pl-dots">
              {mk?.t && <i className="pl-dot-t" />}
              {mk?.j && <i className="pl-dot-j" />}
              {mk?.m && <i className="pl-dot-m" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Задачи ----------

function AddTaskInput({ onAdd }: { onAdd: (t: string) => void }) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text);
    setText('');
  };
  return (
    <div className="pl-add">
      <Plus size={18} className="pl-add-icon" />
      <input
        className="pl-add-input"
        placeholder="Новая задача, напр. «Созвон в 9:30»"
        value={text}
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      {text.trim() && (
        <button className="btn btn-primary btn-sm" onClick={submit}>
          Добавить
        </button>
      )}
    </div>
  );
}

function MapTaskRow({ task, overdue, onToggle }: { task: MapTask; overdue?: boolean; onToggle: () => void }) {
  const done = task.task.status === 'done';
  const pc = task.task.priority ? PRIORITY_META[task.task.priority] : undefined;
  const d = task.task.due ? fromYmd(task.task.due) : null;
  return (
    <div className={`pl-task pl-map-task${done ? ' is-done' : ''}`}>
      <button className={`pl-check${done ? ' on' : ''}`} onClick={onToggle} aria-label={done ? 'Отметить невыполненной' : 'Отметить выполненной'}>
        {done && <Check size={14} strokeWidth={3} />}
      </button>
      {pc && <span className="pl-prio static" style={{ background: pc.color, borderColor: pc.color }} title={`Приоритет: ${pc.label}`} />}
      <button className="pl-map-body" onClick={() => openDoc(task.docId, task.topicId)} title="Открыть в карте">
        <span className="pl-map-text">{task.text || 'Без названия'}</span>
        <span className="pl-map-src ellipsis">
          {overdue && d && (
            <span className="pl-overdue">
              <CircleAlert size={12} /> Просрочено · {d.getDate()} {MONTHS_GEN[d.getMonth()]}
            </span>
          )}
          <span className="ellipsis">
            {task.docTitle || 'Без названия'}
            {task.path.length > 0 && ` › ${task.path.slice(-2).join(' › ')}`}
          </span>
        </span>
      </button>
      <ExternalLink size={15} className="pl-map-open" />
    </div>
  );
}

// ---------- Дневник ----------

function Journal({ date, initial, onSave }: { date: string; initial: string; onSave: (ymd: string, text: string) => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; text: string } | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(120, el.scrollHeight)}px`;
  };
  useEffect(resize, [text]);

  useEffect(
    () => () => {
      // сохранить несохранённое при смене дня / уходе со страницы
      const p = pending.current;
      if (p) {
        clearTimeout(p.timer);
        saveRef.current(date, p.text);
      }
    },
    [date],
  );

  const change = (v: string) => {
    setText(v);
    if (pending.current) clearTimeout(pending.current.timer);
    const timer = setTimeout(() => {
      pending.current = null;
      saveRef.current(date, v);
    }, 500);
    pending.current = { timer, text: v };
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="pl-journal">
      <textarea
        ref={ref}
        className="pl-journal-text"
        placeholder="Как прошёл день? Мысли, идеи, благодарности…"
        value={text}
        onChange={(e) => change(e.target.value)}
      />
      {words > 0 && <div className="tiny faint pl-journal-count">{words} сл.</div>}
    </div>
  );
}

// ---------- Управление привычками ----------

function HabitsModal({
  habits,
  onAdd,
  onRemind,
  onDelete,
  onClose,
}: {
  habits: Habit[];
  onAdd: (name: string, color: string) => void;
  onRemind: (h: Habit, time: string | undefined) => void;
  onDelete: (h: Habit) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(HABIT_COLORS[habits.length % HABIT_COLORS.length]);
  const submit = () => {
    const v = name.trim();
    if (!v) return;
    onAdd(v, color);
    setName('');
    setColor(HABIT_COLORS[(habits.length + 1) % HABIT_COLORS.length]);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row">
          <h2 className="grow">Привычки</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X />
          </button>
        </div>
        <p className="muted small" style={{ margin: '2px 0 10px' }}>
          Отмечайте привычки каждый день и следите за сериями. Укажите время — придёт ежедневное напоминание.
        </p>
        {habits.length > 0 && (
          <div className="pl-habit-list">
            {habits.map((h) => (
              <div key={h.id} className="pl-habit-item">
                <span className="pl-habit-swatch" style={{ background: h.color }} />
                <span className="grow ellipsis">{h.name}</span>
                <input
                  type="time"
                  className="pl-time"
                  title="Напоминать каждый день"
                  aria-label="Время напоминания"
                  value={h.remind ?? ''}
                  onChange={(e) => onRemind(h, e.target.value || undefined)}
                />
                <button className="icon-btn" onClick={() => onDelete(h)} aria-label="Удалить привычку">
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="label">Новая привычка</label>
        <div className="row">
          <input
            className="input"
            placeholder="Напр. «Зарядка», «Читать 20 минут»"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>
            <Plus size={16} /> Добавить
          </button>
        </div>
        <div className="pl-colors">
          {HABIT_COLORS.map((c) => (
            <button key={c} className={`kb-swatch${c === color ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
