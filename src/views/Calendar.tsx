import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as RMouseEvent, PointerEvent as RPointerEvent, RefObject, TouchEvent as RTouchEvent } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Download, MoreHorizontal, Network, Plus, Repeat } from 'lucide-react';
import { ensureTasks, openQuickAdd, openTask, updateTask, useTasks } from '../tasks/store';
import { dayLabel, isActive, isOverdue, longDate, minutesOf, mondayOf, MONTHS, occurrences, pad2, timeOf, WD_SHORT } from '../tasks/model';
import type { TasksData, TaskItem } from '../tasks/model';
import { exportTasksIcs, phoneEvents } from '../tasks/sync';
import type { PhoneEvent } from '../tasks/sync';
import { addDaysYmd, collectMapTasks, fromYmd, PRIORITY_META, todayYmd, toYmd } from '../utils/mapTasks';
import type { MapTask } from '../utils/mapTasks';
import { loadAllDocs, loadPlanner } from '../store/db';
import { openDoc } from '../actions';
import { toast, useApp } from '../store/appStore';
import type { Habit, PlannerData } from '../types';
import type { GoalDue, GoalsData } from '../goals/model';
import { activeHabits, doneOn, dueOn, isCounter } from '../habits/model';
import { toggleHabitOn } from '../habits/store';
import { useTaskActions } from '../tasks/ui/TaskRow';
import './calendar.css';
import { IconTile } from '../ui/icons';

// ---------- Константы ----------

type CalView = 'month' | 'week' | '3day' | 'day' | 'agenda';

const VIEWS: { id: CalView; label: string }[] = [
  { id: 'month', label: 'Месяц' },
  { id: 'week', label: 'Неделя' },
  { id: '3day', label: '3 дня' },
  { id: 'day', label: 'День' },
  { id: 'agenda', label: 'Список' },
];
/** шаг навигации ‹ › в днях (месяц листается отдельно) */
const STEP: Record<CalView, number> = { month: 0, week: 7, '3day': 3, day: 1, agenda: 30 };
const VIEW_KEY = 'sm-cal-view';
/** высота часа в сетке времени, px (как --cv-hour в calendar.css) */
const HOUR = 52;
const SNAP = 15;
const AGENDA_DAYS = 30;
const WD_MON = [1, 2, 3, 4, 5, 6, 0].map((i) => WD_SHORT[i]);
const NARROW = '(max-width: 760px)';

function loadView(): CalView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v && VIEWS.some((x) => x.id === v)) return v as CalView;
  } catch {
    /* хранилище недоступно */
  }
  return 'month';
}

function useNarrow(): boolean {
  const [n, setN] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const m = window.matchMedia(NARROW);
    const h = () => setN(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return n;
}

const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const shortMonth = (d: Date) => MONTHS[d.getMonth()].slice(0, 3);
const utcYmd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

// ---------- Элементы календаря ----------

/** Одна запись в календаре: задача (или её повтор), событие телефона, задача из карты, привычка или срок цели */
interface Item {
  key: string;
  kind: 'task' | 'phone' | 'map' | 'habit' | 'goal';
  date: string;
  title: string;
  /** минуты от полуночи; нет — на весь день */
  start?: number;
  dur: number;
  color: string;
  listColor?: string;
  done: boolean;
  overdue: boolean;
  /** это «основная» дата задачи (не будущий повтор) */
  base: boolean;
  /** можно перетаскивать */
  movable: boolean;
  task?: TaskItem;
  ev?: PhoneEvent;
  map?: MapTask;
  habit?: Habit;
  goal?: GoalDue;
}

type ByDay = Record<string, Item[]>;

type GoalsDueFn = (data: GoalsData, from: string, to: string) => GoalDue[];

const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

function buildItems(
  data: TasksData,
  maps: MapTask[],
  events: PhoneEvent[],
  from: string,
  to: string,
  today: string,
  now: number,
  planner: PlannerData | null,
  goals: GoalDue[],
): ByDay {
  const by: ByDay = {};
  const push = (it: Item) => (by[it.date] ??= []).push(it);
  const listColor = new Map(data.lists.map((l) => [l.id, l.color]));
  const linked = new Set<string>();

  for (const t of data.tasks) {
    if (t.source) linked.add(t.source.topicId);
    if (t.deleted || !t.date) continue;
    const lc = listColor.get(t.listId) ?? '#64748b';
    for (const d of occurrences(t, from, to, 100)) {
      const base = d === t.date;
      const overdue = base && isOverdue(t, today, now);
      push({
        key: `t:${t.id}:${d}`,
        kind: 'task',
        date: d,
        title: t.title || 'Без названия',
        start: t.time ? minutesOf(t.time) : undefined,
        dur: t.duration || 30,
        color: overdue ? 'var(--danger)' : (PRIORITY_META[t.priority]?.color ?? lc),
        listColor: lc,
        done: t.done || !!t.wontDo,
        overdue,
        base,
        movable: base && isActive(t),
        task: t,
      });
    }
  }

  // задачи тем карт (кроме уже перенесённых в список задач)
  for (const m of maps) {
    const due = m.task.due;
    if (!due || due < from || due > to || linked.has(m.topicId)) continue;
    push({
      key: `m:${m.docId}:${m.topicId}`,
      kind: 'map',
      date: due,
      title: m.text || 'Без названия',
      dur: 0,
      color: PRIORITY_META[m.task.priority ?? 0]?.color ?? '#8b5cf6',
      done: m.task.status === 'done',
      overdue: m.task.status !== 'done' && due < today,
      base: true,
      movable: false,
      map: m,
    });
  }

  // события телефона; многодневные — на каждый день
  for (const e of events) {
    const color = e.color || '#64748b';
    const common = { kind: 'phone' as const, title: e.title || 'Событие', color, done: false, overdue: false, base: true, movable: false, ev: e };
    if (e.allDay) {
      // события «на весь день» хранятся в полночь UTC
      const last = utcYmd(Math.max(e.begin, e.end - 1));
      for (let d = utcYmd(e.begin), i = 0; d <= last && i < 62; d = addDaysYmd(d, 1), i++) {
        if (d >= from && d <= to) push({ ...common, key: `p:${e.eventId}:${d}`, date: d, dur: 0 });
      }
      continue;
    }
    const last = toYmd(new Date(Math.max(e.begin, e.end - 1)));
    for (let d = toYmd(new Date(e.begin)), i = 0; d <= last && i < 62; d = addDaysYmd(d, 1), i++) {
      if (d < from || d > to) continue;
      const day0 = fromYmd(d).getTime();
      const s = Math.max(e.begin, day0);
      const en = Math.min(e.end, fromYmd(addDaysYmd(d, 1)).getTime());
      push({ ...common, key: `p:${e.eventId}:${d}`, date: d, start: Math.round((s - day0) / 60000), dur: Math.max(SNAP, Math.round((en - s) / 60000)) });
    }
  }

  // привычки со временем — в запланированные дни (N раз в неделю — пока цель недели не набрана)
  if (planner) {
    const pdays = planner.days ?? {};
    for (const h of activeHabits(planner.habits)) {
      if (!h.time) continue;
      const born = h.createdAt ? toYmd(new Date(h.createdAt)) : '';
      for (let d = from; d <= to; d = addDaysYmd(d, 1)) {
        const done = doneOn(pdays, h, d);
        if (!done && (d < born || !dueOn(pdays, h, d))) continue;
        push({
          key: `h:${h.id}:${d}`,
          kind: 'habit',
          date: d,
          title: `${h.icon ? `${h.icon} ` : ''}${h.name}`,
          start: minutes(h.time),
          dur: h.duration || 15,
          color: h.color,
          done,
          overdue: false,
          base: true,
          movable: false,
          habit: h,
        });
      }
    }
  }

  // сроки целей и этапов — на весь день
  for (const g of goals) {
    if (g.date < from || g.date > to) continue;
    push({
      key: `g:${g.id}`,
      kind: 'goal',
      date: g.date,
      title: `${g.kind === 'goal' ? '🎯' : '🚩'} ${g.title}`,
      dur: 0,
      color: '#a855f7',
      done: false,
      overdue: g.date < today,
      base: true,
      movable: false,
      goal: g,
    });
  }

  for (const k of Object.keys(by)) {
    by[k].sort((a, b) => (a.start ?? -1) - (b.start ?? -1) || Number(a.done) - Number(b.done) || a.title.localeCompare(b.title, 'ru'));
  }
  return by;
}

function rangeOf(view: CalView, cursor: string): string[] {
  let from = cursor;
  let n = 1;
  if (view === 'month') {
    const d = fromYmd(cursor);
    from = mondayOf(toYmd(new Date(d.getFullYear(), d.getMonth(), 1)));
    // только недели этого месяца (4–6), без пустой строки следующего
    const last = toYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    n = 7;
    while (addDaysYmd(from, n) <= last) n += 7;
  } else if (view === 'week') {
    from = mondayOf(cursor);
    n = 7;
  } else if (view === '3day') n = 3;
  else if (view === 'agenda') n = AGENDA_DAYS;
  return Array.from({ length: n }, (_, i) => addDaysYmd(from, i));
}

function periodTitle(view: CalView, days: string[], cursor: string): string {
  if (view === 'day') return longDate(cursor);
  if (view === 'month') {
    const d = fromYmd(cursor);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  const a = fromYmd(days[0]);
  const b = fromYmd(days[days.length - 1]);
  if (view === 'agenda') return `${a.getDate()} ${shortMonth(a).toLowerCase()} – ${b.getDate()} ${shortMonth(b).toLowerCase()}`;
  if (a.getMonth() === b.getMonth()) return `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  return `${shortMonth(a)} – ${shortMonth(b)} ${b.getFullYear()}`;
}

function timeLabel(it: Item): string {
  if (it.goal) return it.goal.kind === 'goal' ? 'Срок цели' : 'Срок этапа';
  if (it.start == null) return 'Весь день';
  if (it.task && !it.task.duration) return timeOf(it.start);
  if (it.habit && !it.habit.duration) return timeOf(it.start);
  return `${timeOf(it.start)}–${timeOf(it.start + it.dur)}`;
}

/** Привычка: отметить / снять отметку (будущие дни и счётчики — открыть Ежедневник) */
async function tapHabit(it: Item) {
  const h = it.habit!;
  const today = todayYmd();
  if (it.date > today) {
    toast(`${it.title} — ${dayLabel(it.date, today).toLowerCase()} в ${timeOf(it.start ?? 0)}`);
    return;
  }
  if (isCounter(h)) {
    useApp.getState().go('habits');
    return;
  }
  try {
    const done = await toggleHabitOn(h, it.date);
    toast(done ? `✓ ${h.name} — выполнено` : `${h.name} — отметка снята`);
  } catch {
    toast('Не удалось отметить привычку');
  }
}

/** Цель: открыть раздел «Цели» и карточку цели */
function openGoalDue(g: GoalDue) {
  useApp.getState().go('goals');
  // карточку открываем, когда раздел уже показан (при первом показе раздел сбрасывает открытую цель)
  void import('../goals/store')
    .then((m) => setTimeout(() => m.openGoal(g.goalId), 300))
    .catch(() => undefined);
}

/** Нажатие на запись: задача — карточка, карта — тема, событие телефона — подсказка */
function activate(it: Item) {
  if (it.habit) void tapHabit(it);
  else if (it.goal) openGoalDue(it.goal);
  else if (it.task) openTask(it.task.id);
  else if (it.map) void openDoc(it.map.docId, it.map.topicId);
  else if (it.ev) toast(`${it.title} · ${dayLabel(it.date)}, ${timeLabel(it).toLowerCase()} · ${it.ev.calendar || 'Календарь телефона'}`);
}

const kindIcon = (it: Item, size = 11) =>
  it.kind === 'phone' ? <CalendarDays size={size} /> : it.kind === 'map' ? <Network size={size} /> : it.kind === 'habit' ? <Repeat size={size} /> : null;

/** Привычки в месяце и списке не показываются (каждый день — слишком много); только в днях/неделе */
const noHabits = (list: Item[] | undefined) => (list ?? []).filter((it) => it.kind !== 'habit');

// ---------- Календарь ----------

export default function Calendar() {
  const data = useTasks((s) => s.data);
  const [view, setViewState] = useState<CalView>(loadView);
  const [cursor, setCursor] = useState(todayYmd);
  const [maps, setMaps] = useState<MapTask[]>([]);
  const [events, setEvents] = useState<PhoneEvent[]>([]);
  const [planner, setPlanner] = useState<PlannerData | null>(null);
  /** цели (только чтение): данные и функция выборки сроков из модуля целей */
  const [goalsSrc, setGoalsSrc] = useState<{ data: GoalsData | null; due: GoalsDueFn } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const narrow = useNarrow();
  /** идёт перетаскивание — свайп и нажатия игнорируются */
  const busy = useRef(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const today = toYmd(new Date(now));

  useEffect(() => {
    void ensureTasks();
    let alive = true;
    loadAllDocs()
      .then((docs) => alive && setMaps(collectMapTasks(docs)))
      .catch(() => undefined);
    const timer = setInterval(() => setNow(Date.now()), 60000);
    // привычки (ежедневник) — и перечитать, когда их отметили здесь, из уведомления или на другом устройстве
    const reloadPlanner = () =>
      void loadPlanner()
        .then((p) => alive && setPlanner(p))
        .catch(() => undefined);
    reloadPlanner();
    window.addEventListener('sm-planner-changed', reloadPlanner);
    // цели — только чтение сроков
    let unsub: (() => void) | undefined;
    import('../goals/store')
      .then(async (m) => {
        const d = await m.ensureGoals();
        if (!alive) return;
        setGoalsSrc({ data: d, due: m.goalsDueBetween });
        unsub = m.useGoals.subscribe((st) => setGoalsSrc({ data: st.data, due: m.goalsDueBetween }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('sm-planner-changed', reloadPlanner);
      unsub?.();
    };
  }, []);

  const days = useMemo(() => rangeOf(view, cursor), [view, cursor]);
  const from = days[0];
  const to = days[days.length - 1];
  const showPhone = data?.prefs.showPhoneEvents;

  // события телефона за видимый период
  useEffect(() => {
    let alive = true;
    phoneEvents(fromYmd(from).getTime(), fromYmd(addDaysYmd(to, 1)).getTime())
      .then((e) => alive && setEvents(e))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [from, to, showPhone]);

  const goals = useMemo(() => (goalsSrc?.data ? goalsSrc.due(goalsSrc.data, from, to) : []), [goalsSrc, from, to]);
  const items = useMemo(
    () => (data ? buildItems(data, maps, events, from, to, today, now, planner, goals) : {}),
    [data, maps, events, from, to, today, now, planner, goals],
  );

  const setView = (v: CalView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* не страшно */
    }
  };

  const shift = (dir: number) => {
    if (view !== 'month') return setCursor((c) => addDaysYmd(c, dir * STEP[view]));
    setCursor((c) => {
      const d = fromYmd(c);
      const t = new Date(d.getFullYear(), d.getMonth() + dir, 1);
      t.setDate(Math.min(d.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
      return toYmd(t);
    });
  };

  const goDay = (d: string) => {
    setCursor(d);
    setView('day');
  };

  // свайп влево/вправо — следующий/предыдущий период
  const onTouchStart = (e: RTouchEvent) => {
    const t = e.touches[0];
    // строки со свайпом (задачи) листают сами себя, а не период
    const own = (e.target as HTMLElement).closest('.sw-wrap');
    swipe.current = e.touches.length === 1 && !own ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: RTouchEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || busy.current || view === 'agenda') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
  };

  return (
    <div className="page cv-page">
      <div className="page-header cv-header">
        <IconTile section="calendar" size="sm" className="ph-tile cv-h1" />
        <h1 className="cv-h1">Календарь</h1>
        <div className="cv-nav">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Назад">
            <ChevronLeft />
          </button>
          <div className="cv-period ellipsis">{periodTitle(view, days, cursor)}</div>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Вперёд">
            <ChevronRight />
          </button>
        </div>
        <button className="btn btn-sm cv-today" onClick={() => setCursor(today)}>
          Сегодня
        </button>
        <div className="grow cv-spacer" />
        <div className="segmented cv-views">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <button className="icon-btn cv-more-btn" onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())} aria-label="Ещё">
          <MoreHorizontal />
        </button>
      </div>

      <div className="cv-body" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {!data ? (
          <div className="empty">Загрузка…</div>
        ) : view === 'month' ? (
          <MonthView days={days} items={items} cursor={cursor} today={today} narrow={narrow} onSelect={setCursor} onMore={goDay} />
        ) : view === 'agenda' ? (
          <Agenda days={days} items={items} today={today} />
        ) : (
          <TimeGrid key={view} days={days} items={items} today={today} now={now} busy={busy} onDay={goDay} />
        )}
      </div>

      <button className="cv-fab" onClick={() => openQuickAdd({ date: cursor })} aria-label="Новая задача">
        <Plus size={26} />
      </button>

      {menu && (
        <>
          <div className="cv-menu-back" onClick={() => setMenu(null)} />
          <div className="menu" style={{ top: menu.bottom + 6, right: Math.max(8, window.innerWidth - menu.right) }}>
            <button
              onClick={() => {
                setMenu(null);
                if (data) void exportTasksIcs(data.tasks);
              }}
            >
              <Download size={16} /> Экспорт .ics
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Общие элементы ----------

function Chip({ it, onDown, onOpen }: { it: Item; onDown?: (e: RPointerEvent, it: Item) => void; onOpen: (it: Item) => void }) {
  const cls = `cv-chip cv-${it.kind}${it.done ? ' done' : ''}${it.overdue ? ' overdue' : ''}${it.movable && onDown ? ' movable' : ''}`;
  return (
    <div
      className={cls}
      style={{ '--c': it.color } as CSSProperties}
      title={`${it.title} · ${timeLabel(it)}`}
      onPointerDown={onDown && ((e) => onDown(e, it))}
      onClick={() => onOpen(it)}
    >
      {kindIcon(it)}
      {it.start != null && <span className="cv-chip-time">{timeOf(it.start)}</span>}
      <span className="ellipsis">{it.title}</span>
    </div>
  );
}

/** Строка списка: флажок, название, цвет списка, время */
function Row({ it }: { it: Item }) {
  if (it.task) return <TaskLine it={it} t={it.task} />;
  // строка привычки открывает раздел «Привычки» (отметка — кружком)
  const open = () => (it.habit ? useApp.getState().go('habits') : activate(it));
  return (
    <div className={`cv-row cv-row-${it.kind}${it.done ? ' done' : ''}${it.overdue ? ' overdue' : ''}`} onClick={open}>
      {it.habit ? (
        <button
          className={`cv-check cv-check-habit${it.done ? ' on' : ''}`}
          style={{ '--c': it.color } as CSSProperties}
          onClick={(e) => {
            e.stopPropagation();
            void tapHabit(it);
          }}
          aria-label={it.done ? 'Снять отметку' : 'Отметить привычку'}
        >
          {it.done && <Check size={13} strokeWidth={3} />}
        </button>
      ) : (
        <span className="cv-row-icon" style={{ color: it.color }}>
          {kindIcon(it, 16)}
        </span>
      )}
      <span className="grow ellipsis cv-row-title">{it.title}</span>
      {it.listColor && <i className="cv-row-dot" style={{ background: it.listColor }} />}
      <span className="cv-row-time">{timeLabel(it)}</span>
    </div>
  );
}

/** Задача: свайп вправо — выполнить, влево — удалить, долгое нажатие — меню (как в «Задачах») */
function TaskLine({ it, t }: { it: Item; t: TaskItem }) {
  const { swipe, handlers, bg, overlays, done, completing } = useTaskActions(t, it.date);
  const on = it.done || completing;
  return (
    <div ref={swipe.wrap} className={`cv-row-wrap ${swipe.wrapClass}`}>
      {bg}
      <div
        className={`cv-row cv-row-task sw-row${on ? ' done' : ''}${it.overdue ? ' overdue' : ''}`}
        style={swipe.style}
        onClick={() => openTask(t.id)}
        {...handlers}
      >
        <button
          className={`cv-check${on ? ' on' : ''}`}
          style={{ '--c': t.priority ? it.color : 'var(--text-3)' } as CSSProperties}
          disabled={!it.base}
          title={it.base ? undefined : 'Будущий повтор'}
          onClick={(e) => {
            e.stopPropagation();
            done();
          }}
          aria-label="Выполнено"
        >
          {on && <Check size={13} strokeWidth={3} />}
        </button>
        <span className="grow ellipsis cv-row-title">{it.title}</span>
        {it.listColor && <i className="cv-row-dot" style={{ background: it.listColor }} />}
        <span className="cv-row-time">{timeLabel(it)}</span>
      </div>
      {overlays}
    </div>
  );
}

function DayHead({ date, today }: { date: string; today: string }) {
  return (
    <div className={`cv-list-head${date === today ? ' today' : ''}`}>
      <b>{dayLabel(date, today)}</b>
      <span className="faint small">{longDate(date)}</span>
    </div>
  );
}

// ---------- Месяц ----------

function MonthView({
  days,
  items,
  cursor,
  today,
  narrow,
  onSelect,
  onMore,
}: {
  days: string[];
  items: ByDay;
  cursor: string;
  today: string;
  narrow: boolean;
  onSelect: (d: string) => void;
  onMore: (d: string) => void;
}) {
  const month = fromYmd(cursor).getMonth();
  const [drag, setDrag] = useState<{ it: Item; x: number; y: number; over?: string } | null>(null);
  const suppress = useRef(false);

  const cellClick = (e: RMouseEvent, d: string) => {
    if (suppress.current || (e.target as HTMLElement).closest('.cv-chip, .cv-more')) return;
    if (d === cursor) openQuickAdd({ date: d });
    else onSelect(d);
  };

  const openChip = (it: Item) => {
    if (!suppress.current) activate(it);
  };

  // перетаскивание задачи мышью на другой день
  const chipDown = (e: RPointerEvent, it: Item) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !it.movable || !it.task) return;
    e.preventDefault();
    const id = it.task.id;
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    const dayAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-date]')?.dataset.date;
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      active = true;
      setDrag({ it, x: ev.clientX, y: ev.clientY, over: dayAt(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!active) return;
      suppress.current = true;
      setTimeout(() => (suppress.current = false), 0);
      setDrag(null);
      const over = dayAt(ev.clientX, ev.clientY);
      if (over && over !== it.date) updateTask(id, { date: over });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const sel = items[cursor] ?? [];

  return (
    <div className={`cv-month${narrow ? ' narrow' : ''}`}>
      <div className="cv-mgrid">
        {WD_MON.map((w, i) => (
          <div key={w} className={`cv-wd${i >= 5 ? ' we' : ''}`}>
            {w}
          </div>
        ))}
        {days.map((d) => {
          const list = noHabits(items[d]);
          const cls = `cv-cell${fromYmd(d).getMonth() !== month ? ' out' : ''}${d === today ? ' today' : ''}${d === cursor ? ' sel' : ''}${
            drag?.over === d ? ' over' : ''
          }`;
          return (
            <div key={d} data-date={d} className={cls} onClick={(e) => cellClick(e, d)}>
              <span className="cv-num">{fromYmd(d).getDate()}</span>
              {narrow ? (
                <span className="cv-dots">
                  {list.slice(0, 4).map((it) => (
                    <i key={it.key} className={it.done ? 'done' : ''} style={{ background: it.color }} />
                  ))}
                </span>
              ) : (
                <>
                  {list.slice(0, 3).map((it) => (
                    <Chip key={it.key} it={it} onDown={chipDown} onOpen={openChip} />
                  ))}
                  {list.length > 3 && (
                    <button className="cv-more" onClick={() => onMore(d)}>
                      +{list.length - 3}
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {narrow && (
        <div className="cv-daylist">
          <DayHead date={cursor} today={today} />
          {sel.length ? (
            <div className="card cv-list">
              {sel.map((it) => (
                <Row key={it.key} it={it} />
              ))}
            </div>
          ) : (
            <button className="cv-none" onClick={() => openQuickAdd({ date: cursor })}>
              Нет задач — нажмите, чтобы добавить
            </button>
          )}
        </div>
      )}

      {drag && (
        <div className="cv-ghost" style={{ left: drag.x + 10, top: drag.y + 10, borderLeftColor: drag.it.color }}>
          {drag.it.title}
        </div>
      )}
    </div>
  );
}

// ---------- Список (повестка) ----------

function Agenda({ days, items, today }: { days: string[]; items: ByDay; today: string }) {
  const filled = days.filter((d) => noHabits(items[d]).length);
  if (!filled.length) {
    return (
      <div className="empty cv-agenda-empty">
        <CalendarDays size={36} />
        <div>Нет задач</div>
        <div className="small">на ближайшие {AGENDA_DAYS} дней</div>
      </div>
    );
  }
  return (
    <div className="cv-agenda">
      {filled.map((d) => (
        <section key={d} className="cv-ag-day">
          <DayHead date={d} today={today} />
          <div className="card cv-list">
            {noHabits(items[d]).map((it) => (
              <Row key={it.key} it={it} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------- Сетка времени (неделя / 3 дня / день) ----------

interface Placed {
  it: Item;
  col: number;
  cols: number;
}

/** Раскладка пересекающихся блоков по колонкам */
function layoutDay(list: Item[]): Placed[] {
  const sorted = [...list].sort((a, b) => a.start! - b.start! || b.dur - a.dur);
  const out: Placed[] = [];
  let group: Placed[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    for (const p of group) p.cols = ends.length;
    group = [];
    ends = [];
  };
  for (const it of sorted) {
    const s = it.start!;
    // короткие блоки визуально не меньше ~25 минут
    const e = s + Math.max(it.dur, 25);
    if (s >= groupEnd) flush();
    let col = ends.findIndex((x) => x <= s);
    if (col < 0) {
      col = ends.length;
      ends.push(e);
    } else ends[col] = e;
    groupEnd = Math.max(groupEnd, e);
    const p = { it, col, cols: 1 };
    group.push(p);
    out.push(p);
  }
  flush();
  return out;
}

interface TgDrag {
  it: Item;
  date: string;
  start: number;
  dur: number;
}

function TimeGrid({
  days,
  items,
  today,
  now,
  busy,
  onDay,
}: {
  days: string[];
  items: ByDay;
  today: string;
  now: number;
  busy: RefObject<boolean>;
  onDay: (d: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const initialDays = useRef(days);
  const suppress = useRef(false);
  const [drag, setDrag] = useState<TgDrag | null>(null);
  const nd = new Date(now);
  const nowMin = nd.getHours() * 60 + nd.getMinutes();

  // при открытии — к 7:00 или к текущему времени минус час
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const n = new Date();
    const h = initialDays.current.includes(toYmd(n)) ? Math.max(0, n.getHours() + n.getMinutes() / 60 - 1) : 7;
    el.scrollTop = h * HOUR;
  }, []);

  // во время перетаскивания пальцем страница не прокручивается
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (busy.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [busy]);

  const colAt = (x: number): string | undefined => {
    const cols = bodyRef.current?.querySelectorAll<HTMLElement>('[data-col]');
    if (!cols?.length) return undefined;
    let best = cols[0].dataset.col;
    for (let i = 0; i < cols.length; i++) if (x >= cols[i].getBoundingClientRect().left) best = cols[i].dataset.col;
    return best;
  };

  // перемещение блока (мышь — сразу, палец — после долгого нажатия) и изменение длительности
  const down = (e: RPointerEvent, it: Item, mode: 'move' | 'resize') => {
    const el = scrollRef.current;
    if (!el || !it.movable || !it.task || it.start == null || e.button !== 0) return;
    e.stopPropagation();
    const touch = e.pointerType !== 'mouse';
    const wait = touch && mode === 'move';
    if (!touch) e.preventDefault();
    const id = it.task.id;
    const start0 = it.start;
    const sx = e.clientX;
    const sy = e.clientY;
    const top0 = el.scrollTop;
    let x = sx;
    let y = sy;
    let active = false;
    let timer = 0;

    const calc = (): TgDrag => {
      const dm = ((y - sy + el.scrollTop - top0) / HOUR) * 60;
      if (mode === 'resize') return { it, date: it.date, start: start0, dur: Math.max(SNAP, snap(it.dur + dm)) };
      return { it, date: colAt(x) ?? it.date, start: clamp(snap(start0 + dm), 0, 1440 - SNAP), dur: it.dur };
    };
    const begin = () => {
      active = true;
      busy.current = true;
      if (touch) navigator.vibrate?.(12);
      setDrag(calc());
    };
    const move = (ev: PointerEvent) => {
      x = ev.clientX;
      y = ev.clientY;
      if (!active) {
        if (Math.hypot(x - sx, y - sy) < (touch ? 8 : 4)) return;
        // палец сдвинулся до долгого нажатия — это прокрутка
        if (wait) return stop();
        begin();
      }
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const headH = headRef.current?.offsetHeight ?? 0;
      if (y < r.top + headH + 24) el.scrollTop -= 12;
      else if (y > r.bottom - 24) el.scrollTop += 12;
      setDrag(calc());
    };
    const finish = (commit: boolean) => {
      stop();
      if (!active) return;
      const p = calc();
      setDrag(null);
      suppress.current = true;
      setTimeout(() => {
        suppress.current = false;
        busy.current = false;
      }, 60);
      if (!commit) return;
      if (mode === 'resize') {
        if (p.dur !== it.dur) updateTask(id, { duration: p.dur });
      } else if (p.date !== it.date || p.start !== start0) updateTask(id, { date: p.date, time: timeOf(p.start) });
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    function stop() {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    }
    if (wait) timer = window.setTimeout(begin, 350);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  const slotClick = (e: RMouseEvent<HTMLDivElement>, d: string) => {
    if (suppress.current || (e.target as HTMLElement).closest('.cv-block')) return;
    const r = e.currentTarget.getBoundingClientRect();
    const min = Math.floor(((e.clientY - r.top) / HOUR) * 2) * 30;
    openQuickAdd({ date: d, time: timeOf(clamp(min, 0, 1410)) });
  };

  const block = (it: Item, start: number, dur: number, col: number, cols: number, ghost = false) => {
    // блок не вылезает за полночь (ниже сетки времени)
    const h = Math.max(22, (Math.min(dur, 1440 - start) / 60) * HOUR - 2);
    const style = {
      '--c': it.color,
      top: (start / 60) * HOUR + 1,
      height: h,
      left: `calc(${(col / cols) * 100}% + 1px)`,
      width: `calc(${100 / cols}% - 3px)`,
    } as CSSProperties;
    const cls = `cv-block cv-${it.kind}${it.done ? ' done' : ''}${it.overdue ? ' overdue' : ''}${it.movable ? ' movable' : ''}${
      ghost ? ' ghost' : drag?.it.key === it.key ? ' src' : ''
    }`;
    const tall = h >= 36;
    return (
      <div
        key={ghost ? 'ghost' : it.key}
        className={cls}
        style={style}
        title={`${it.title} · ${timeLabel(it)}`}
        onPointerDown={ghost ? undefined : (e) => down(e, it, 'move')}
        onClick={() => !suppress.current && activate(it)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="cv-block-title ellipsis">
          {it.habit && it.done ? <Check size={11} strokeWidth={3} /> : kindIcon(it)}
          {!tall && <span className="cv-block-time">{timeOf(start)}</span>}
          {it.title}
        </div>
        {tall && (
          <div className="cv-block-time">
            {timeOf(start)}–{timeOf(start + dur)}
          </div>
        )}
        {!ghost && it.movable && h >= 34 && <div className="cv-block-resize" onPointerDown={(e) => down(e, it, 'resize')} />}
      </div>
    );
  };

  const cols = `var(--cv-gutter) repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className={`cv-tg cv-tg-${days.length}`} ref={scrollRef} style={{ '--cols': cols } as CSSProperties}>
      <div className="cv-tg-sticky" ref={headRef}>
        <div className="cv-tg-row">
          <div />
          {days.map((d) => {
            const dt = fromYmd(d);
            const we = dt.getDay() === 0 || dt.getDay() === 6;
            return (
              <button key={d} className={`cv-tg-head${d === today ? ' today' : ''}${we ? ' we' : ''}`} onClick={() => onDay(d)}>
                <span className="cv-tg-wd">{WD_SHORT[dt.getDay()]}</span>
                <span className="cv-tg-date">{dt.getDate()}</span>
              </button>
            );
          })}
        </div>
        <div className="cv-tg-row cv-tg-allday">
          <div className="cv-tg-gut">весь день</div>
          {days.map((d) => (
            <div
              key={d}
              className="cv-tg-adcell"
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest('.cv-chip')) openQuickAdd({ date: d });
              }}
            >
              {(items[d] ?? [])
                .filter((it) => it.start == null)
                .map((it) => (
                  <Chip key={it.key} it={it} onOpen={activate} />
                ))}
            </div>
          ))}
        </div>
      </div>

      <div className="cv-tg-row cv-tg-body" ref={bodyRef} style={{ height: 24 * HOUR }}>
        <div className="cv-tg-hours">
          {Array.from({ length: 23 }, (_, i) => (
            <span key={i} style={{ top: (i + 1) * HOUR }}>
              {pad2(i + 1)}:00
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} data-col={d} className={`cv-tg-col${d === today ? ' today' : ''}`} onClick={(e) => slotClick(e, d)}>
            {layoutDay((items[d] ?? []).filter((it) => it.start != null)).map((p) => block(p.it, p.it.start!, p.it.dur, p.col, p.cols))}
            {drag && drag.date === d && block(drag.it, drag.start, drag.dur, 0, 1, true)}
            {d === today && <div className="cv-now" style={{ top: (nowMin / 60) * HOUR }} />}
          </div>
        ))}
      </div>
    </div>
  );
}
