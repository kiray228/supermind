/**
 * «Сегодня» — главный экран телефона: неделя, «Сейчас» с фокусом, привычки дня, деньги за день и план дня.
 * Каждый блок открывает свой раздел целиком (календарь, привычки, финансы, задачи, прогресс).
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { CaretRight, Flame, MagnifyingGlass, Play, Plus, Wallet } from '@phosphor-icons/react';
import { useApp } from '../store/appStore';
import { ensureTasks, openQuickAdd, openTask, toggleDone, useTasks } from '../tasks/store';
import { isActive, minutesOf, mondayOf, WEEKDAYS, type TaskItem } from '../tasks/model';
import { addDaysYmd, fromYmd, todayYmd, toYmd } from '../utils/mapTasks';
import { loadPlanner } from '../store/db';
import type { Habit, PlannerData } from '../types';
import { habitsForDay, type BriefHabit } from '../assistant/briefing';
import { bumpHabitOn, toggleHabitOn } from '../habits/store';
import { ensureFinance, useFinance } from '../finance/store';
import { fmtMoney, MONTHS_GEN, MONTHS_SHORT, summarize } from '../finance/model';
import { openTxSheet } from '../finance/ui/state';
import { openSearch } from '../search/state';
import { LevelRing } from '../progress/LevelBadge';
import { useProgress } from '../progress/hooks';
import { plural } from '../tasks/model';
import { toast } from '../store/appStore';
import { haptic } from '../editor/touch';
import './today.css';
import './finance.css';

const TxSheet = lazy(() => import('../finance/ui/TxSheet').then((m) => ({ default: m.TxSheet })));

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

/** Сегодняшняя дата, обновляется после полуночи */
function useTodayYmd(): string {
  const [t, setT] = useState(todayYmd);
  useEffect(() => {
    const id = setInterval(() => setT(todayYmd()), 60_000);
    return () => clearInterval(id);
  }, []);
  return t;
}

/** Данные привычек (Ежедневник): читаются заново после любой отметки */
function usePlanner(): PlannerData | null {
  const [p, setP] = useState<PlannerData | null>(null);
  useEffect(() => {
    const load = () => void loadPlanner().then(setP).catch(() => undefined);
    load();
    window.addEventListener('sm-planner-changed', load);
    return () => window.removeEventListener('sm-planner-changed', load);
  }, []);
  return p;
}

export default function Today() {
  const today = useTodayYmd();
  const go = useApp((s) => s.go);
  const data = useTasks((s) => s.data);
  const planner = usePlanner();
  const fin = useFinance((s) => s.data);
  useEffect(() => {
    void ensureTasks();
    void ensureFinance().catch(() => undefined);
  }, []);

  const tasks = useMemo(() => (data ? data.tasks.filter(isActive) : []), [data]);
  const overdue = useMemo(() => tasks.filter((t) => t.date && t.date < today), [tasks, today]);
  const todays = useMemo(() => tasks.filter((t) => t.date === today), [tasks, today]);
  const timed = useMemo(() => todays.filter((t) => t.time).sort((a, b) => minutesOf(a.time!) - minutesOf(b.time!)), [todays]);
  const allDay = useMemo(() => todays.filter((t) => !t.time).sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.order - b.order), [todays]);
  const doneToday = useMemo(
    () => (data ? data.tasks.filter((t) => t.done && !t.deleted && t.completedAt && toYmd(new Date(t.completedAt)) === today).length : 0),
    [data, today],
  );
  const now = useMemo(() => pickNow(timed, allDay, overdue), [timed, allDay, overdue]);
  const habits = useMemo(() => habitsForDay(planner, today), [planner, today]);
  const spent = useMemo(() => (fin ? summarize(fin, { from: today, to: today }).expense : 0), [fin, today]);

  const d = fromYmd(today);
  return (
    <div className="page td-page">
      <div className="page-header">
        <h1 className="grow">Сегодня</h1>
        <button className="icon-btn" onClick={() => openSearch()} aria-label="Поиск по всему" title="Поиск по всему">
          <MagnifyingGlass size={20} weight="bold" />
        </button>
      </div>
      <div className="page-body">
        <div className="td-wrap">
          <p className="td-date">
            {WEEKDAYS[d.getDay()]}, {d.getDate()} {MONTHS_GEN[d.getMonth()]}
          </p>
          <Week today={today} tasks={tasks} />
          {now && <NowCard task={now} />}
          {habits.length > 0 && <HabitsRow habits={habits} planner={planner} today={today} />}
          <button className="td-money" onClick={() => go('finance')}>
            <span className="td-money-ico">
              <Wallet size={20} weight="fill" />
            </span>
            <span className="td-money-x">
              <small>Деньги · сегодня</small>
              <b>{fin ? (spent ? '−' + fmtMoney(spent, fin.prefs.mainCurrency) : 'Трат нет') : '…'}</b>
            </span>
            <span
              className="td-add"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                openTxSheet({ preset: { type: 'expense' } });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  openTxSheet({ preset: { type: 'expense' } });
                }
              }}
            >
              + трата
            </span>
            <CaretRight size={16} weight="bold" className="td-chev" />
          </button>
          <Plan timed={timed} allDay={allDay} overdue={overdue} doneToday={doneToday} today={today} />
          <ProgressCard />
        </div>
      </div>
      {fin && (
        <Suspense fallback={null}>
          <TxSheet data={fin} />
        </Suspense>
      )}
    </div>
  );
}

/** Что делать сейчас: ближайшая по времени задача (началась или начнётся в течение часа), иначе самая важная */
function pickNow(timed: TaskItem[], allDay: TaskItem[], overdue: TaskItem[]): TaskItem | null {
  const m = nowMin();
  const soon = timed.find((t) => minutesOf(t.time!) + (t.duration ?? 30) >= m && minutesOf(t.time!) <= m + 60);
  if (soon) return soon;
  const pool = [...overdue, ...allDay];
  if (!pool.length) return timed.find((t) => minutesOf(t.time!) >= m) ?? null;
  return pool.reduce((a, b) => ((b.priority || 0) > (a.priority || 0) ? b : a));
}

function Week({ today, tasks }: { today: string; tasks: TaskItem[] }) {
  const start = mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
  const busy = new Set(tasks.map((t) => t.date).filter(Boolean));
  const open = (day: string) => void import('./Calendar').then((m) => m.openCalendarAt(day, 'day'));
  return (
    <div className="td-card td-week-card">
      <div className="td-week" role="list" aria-label="Неделя">
        {days.map((day, i) => (
          <button key={day} role="listitem" className={`td-day${day === today ? ' is-today' : ''}`} onClick={() => open(day)} aria-label={`Открыть ${fromYmd(day).getDate()} число в календаре`}>
            <span>{WD[i]}</span>
            <b>{fromYmd(day).getDate()}</b>
            <i className={busy.has(day) ? 'on' : ''} />
          </button>
        ))}
      </div>
    </div>
  );
}

function NowCard({ task }: { task: TaskItem }) {
  const start = async () => {
    try {
      const { useFocus } = await import('../tasks/focusTimer');
      const f = useFocus.getState();
      f.setTask(task.id);
      f.start();
      useApp.getState().go('focus');
    } catch {
      toast('Таймер фокуса недоступен');
    }
  };
  return (
    <div className="td-now">
      <button className="td-now-x" onClick={() => openTask(task.id)}>
        <small>Сейчас{task.time ? ' · ' + task.time : ''} · фокус 25 мин</small>
        <b>{task.title || 'Без названия'}</b>
      </button>
      <button className="td-play" onClick={() => void start()} aria-label="Начать фокус">
        <Play size={18} weight="fill" />
      </button>
    </div>
  );
}

function HabitsRow({ habits, planner, today }: { habits: BriefHabit[]; planner: PlannerData | null; today: string }) {
  const go = useApp((s) => s.go);
  const done = habits.filter((h) => h.done).length;
  const tap = async (b: BriefHabit) => {
    const h = (planner?.habits as Habit[] | undefined)?.find((x) => x.id === b.id);
    if (!h) return;
    haptic(10);
    try {
      if (b.target && b.target > 1) {
        // счётчик: +1 до цели; дошли до цели — сбросить можно только в разделе
        if ((b.count ?? 0) >= b.target) return go('habits');
        await bumpHabitOn(h, today, 1);
      } else await toggleHabitOn(h, today);
    } catch {
      toast('Не удалось отметить привычку');
    }
  };
  return (
    <section className="td-card">
      <div className="td-card-h">
        <span>
          Привычки · {done} из {habits.length}
        </span>
        <button className="td-link" onClick={() => go('habits')}>
          Все
        </button>
      </div>
      <div className="td-habits">
        {habits.slice(0, 8).map((h) => {
          const pct = h.target && h.target > 1 ? Math.min(1, (h.count ?? 0) / h.target) : h.done ? 1 : 0;
          return (
            <button key={h.id} className={`td-habit${h.done ? ' is-done' : ''}`} onClick={() => void tap(h)} aria-pressed={h.done} aria-label={`${h.name}${h.done ? ', выполнено' : ''}`}>
              <span className="td-ring" style={{ ['--c' as string]: h.color }}>
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <circle cx="22" cy="22" r="19" className="td-ring-track" />
                  <circle cx="22" cy="22" r="19" className="td-ring-bar" strokeDasharray={`${(pct * 119.4).toFixed(1)} 200`} />
                </svg>
                <span className="td-ring-ico">{h.done ? '✓' : h.icon || h.name.slice(0, 1).toUpperCase()}</span>
              </span>
              <span className="td-habit-name">{h.name}</span>
              {h.target && h.target > 1 && (
                <small>
                  {h.count ?? 0}/{h.target}
                </small>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TaskRow({ t, time, late }: { t: TaskItem; time?: string; late?: boolean }) {
  return (
    <div className={`td-task${late ? ' is-late' : ''}`}>
      {time !== undefined && <span className="td-time">{time}</span>}
      <button
        className="td-check"
        onClick={() => {
          haptic(10);
          toggleDone(t.id);
        }}
        aria-label={`Выполнено: ${t.title}`}
      />
      <button className="td-task-x" onClick={() => openTask(t.id)}>
        <span className="ellipsis">{t.title || 'Без названия'}</span>
        {late && t.date && <small>просрочено · {fromYmd(t.date).getDate()} {MONTHS_SHORT[fromYmd(t.date).getMonth()]}</small>}
      </button>
    </div>
  );
}

function Plan({ timed, allDay, overdue, doneToday, today }: { timed: TaskItem[]; allDay: TaskItem[]; overdue: TaskItem[]; doneToday: number; today: string }) {
  const go = useApp((s) => s.go);
  const total = timed.length + allDay.length;
  const openDay = () => void import('./Calendar').then((m) => m.openCalendarAt(today, 'day'));
  return (
    <section className="td-card td-plan">
      <div className="td-card-h">
        <span>
          План дня{total + doneToday > 0 ? ` · ${doneToday} из ${total + doneToday}` : ''}
        </span>
        <button className="td-link" onClick={openDay}>
          Календарь
        </button>
      </div>
      {overdue.length > 0 && (
        <div className="td-group">
          {overdue.slice(0, 3).map((t) => (
            <TaskRow key={t.id} t={t} late />
          ))}
          {overdue.length > 3 && (
            <button className="td-more" onClick={() => go('tasks')}>
              Ещё просроченных: {overdue.length - 3}
            </button>
          )}
        </div>
      )}
      {timed.length > 0 && (
        <div className="td-group td-timeline">
          {timed.map((t) => (
            <TaskRow key={t.id} t={t} time={t.time} />
          ))}
        </div>
      )}
      {allDay.length > 0 && (
        <div className="td-group">
          {timed.length > 0 && <div className="td-sub">Без времени</div>}
          {allDay.map((t) => (
            <TaskRow key={t.id} t={t} />
          ))}
        </div>
      )}
      {total === 0 && overdue.length === 0 && <p className="td-empty">{doneToday ? 'Всё на сегодня сделано 🎉' : 'На сегодня задач нет'}</p>}
      <div className="td-plan-foot">
        <button className="td-link" onClick={() => openQuickAdd({ date: today })}>
          <Plus size={14} weight="bold" /> Задача на сегодня
        </button>
        <button className="td-link" onClick={() => go('tasks')}>
          Все задачи <CaretRight size={13} weight="bold" />
        </button>
      </div>
    </section>
  );
}

/** Уровень и серия дней — нажатие открывает «Прогресс» */
function ProgressCard() {
  const p = useProgress();
  const go = useApp((s) => s.go);
  if (!p) return null;
  const lv = p.level;
  const streak = p.counters.streak;
  return (
    <button className="td-card td-prog" onClick={() => go('progress')}>
      <LevelRing pct={lv.pct} size={44} stroke={4}>
        <b>{lv.level}</b>
      </LevelRing>
      <span className="td-prog-x">
        <b>
          Уровень {lv.level} · {lv.title}
        </b>
        <small>
          {lv.cur.toLocaleString('ru-RU')} из {lv.need.toLocaleString('ru-RU')} XP
          {streak > 0 ? ` · серия ${streak} ${plural(streak, 'день', 'дня', 'дней')}` : ''}
        </small>
      </span>
      {streak > 0 && (
        <span className="td-streak">
          <Flame size={15} weight="fill" />
          {streak}
        </span>
      )}
      <CaretRight size={16} weight="bold" className="td-chev" />
    </button>
  );
}
