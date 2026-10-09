/**
 * Раздел «Привычки» — главный экран дня вместо Ежедневника:
 * крупные карточки привычек по частям дня, неделя с кольцами выполнения,
 * серии, и внизу «Как прошёл день» (настроение + дневник).
 * Данные — те же, что у Ежедневника (IDB 'planner').
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, TouchEvent as ReactTouchEvent } from 'react';
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  Clock,
  Fire,
  Minus,
  MoonStars,
  NotePencil,
  Pause,
  Plant,
  Plus,
  SlidersHorizontal,
  Snowflake,
  Sparkle,
  Sun,
  SunHorizon,
  Trophy,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { Habit, HabitPart, PlannerData, PlannerDay } from '../types';
import { loadPlanner, savePlanner } from '../store/db';
import { toast } from '../store/appStore';
import { askNotifyIfNeeded, syncSoon } from '../tasks/sync';
import { celebrate } from '../ui/celebrate';
import { confirmDialog } from '../ui/dialogs';
import { addDaysYmd, fromYmd, todayYmd, toYmd } from '../utils/mapTasks';
import {
  activeHabits,
  cleanHabit,
  compareByTime,
  countOn,
  currentStreak,
  doneOn,
  dueOn,
  durationLabel,
  freqLabel,
  freqOf,
  frozenOn,
  isCounter,
  mondayOf,
  nextSlot,
  partNow,
  timesOf,
  PARTS,
  plural,
  reminderTimeOf,
  streakText,
  targetOf,
  timeRangeLabel,
  weekCount,
  weekGoal,
  withCount,
  withDone,
  withoutHabit,
} from '../habits/model';
import type { Streak } from '../habits/model';
import { HABIT_LIBRARY, habitFromPreset } from '../habits/library';
import { HabitDetail, HabitEditor, HabitsManager } from '../habits/ui';
import { FreezeSheet } from '../habits/freeze';
import { freezeHandlers, freezeStatus, hasPauseAhead } from '../habits/freezeActions';
import { mergeHandlers, useLongPress, useSwipeActions } from '../ui/gestures';
import { SwipeBg } from '../ui/SwipeBg';
import './habits-page.css';

type Days = PlannerData['days'];

// ---------- Константы ----------

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MOODS: { e: string; name: string }[] = [
  { e: '🤩', name: 'Восторг' },
  { e: '😄', name: 'Отлично' },
  { e: '🙂', name: 'Хорошо' },
  { e: '😐', name: 'Нормально' },
  { e: '😕', name: 'Так себе' },
  { e: '😴', name: 'Устал' },
  { e: '😢', name: 'Грустно' },
  { e: '😡', name: 'Злость' },
];
const PART_ICONS: Record<HabitPart, Icon> = { morning: SunHorizon, day: Sun, evening: MoonStars, any: Clock };
/** быстрый старт в пустом разделе */
const QUICK = ['Пить воду', 'Зарядка', 'Чтение', 'Медитация', 'Прогулка', 'Лечь спать до 23:00'];

const emptyDay = (): PlannerDay => ({ journal: '', tasks: [] });

function dateLine(ymd: string): string {
  const d = fromYmd(ymd);
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${y}`;
}

function relLabel(ymd: string, today: string): string {
  if (ymd === today) return 'Сегодня';
  if (ymd === addDaysYmd(today, -1)) return 'Вчера';
  if (ymd === addDaysYmd(today, 1)) return 'Завтра';
  const n = Math.round((fromYmd(today).getTime() - fromYmd(ymd).getTime()) / 86400000);
  return n > 0 ? `${n} ${plural(n, ['день', 'дня', 'дней'])} назад` : `Через ${-n} ${plural(-n, ['день', 'дня', 'дней'])}`;
}

function weekLabel(mon: string, today: string): string {
  const cur = mondayOf(today);
  if (mon === cur) return 'Эта неделя';
  if (mon === addDaysYmd(cur, -7)) return 'Прошлая неделя';
  const a = fromYmd(mon);
  const b = fromYmd(addDaysYmd(mon, 6));
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
}

/** Привычка уже существовала в этот день (до создания — не входит в план и в счёт дня) */
const existedOn = (h: Habit, ymd: string) => !h.createdAt || toYmd(new Date(h.createdAt)) <= ymd;

const isDue = (days: Days, h: Habit, ymd: string) => existedOn(h, ymd) && dueOn(days, h, ymd);

/** Заморожена в этот день (пропуск или пауза) — среди тех, что уже существовали */
const isFrozen = (days: Days, h: Habit, ymd: string) => existedOn(h, ymd) && !!frozenOn(days, h, ymd);

/** Выполнено / запланировано / заморожено за день */
function dayScore(days: Days, habits: Habit[], ymd: string): { done: number; due: number; frozen: number } {
  let done = 0;
  let due = 0;
  let frozen = 0;
  for (const h of habits) {
    if (isFrozen(days, h, ymd)) frozen++;
    if (!isDue(days, h, ymd)) continue;
    due++;
    if (doneOn(days, h, ymd)) done++;
  }
  return { done, due, frozen };
}

const haptic = () => {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* нет вибрации */
  }
};

// ---------- Данные: ежедневник из IDB ----------

/** своё событие об изменении — чтобы не перечитывать то, что только что записали сами */
let selfEvent = false;
function announce() {
  selfEvent = true;
  try {
    window.dispatchEvent(new Event('sm-planner-changed'));
  } finally {
    selfEvent = false;
  }
}

function usePlannerData() {
  const [data, setData] = useState<PlannerData | null>(null);
  const ref = useRef<PlannerData | null>(null);
  /** сколько сохранений ещё в пути; внешнее изменение в это время — перечитать после них */
  const pending = useRef(0);
  const reloadAfter = useRef(false);
  const loadRef = useRef<() => void>(() => undefined);

  const adopt = useCallback((p: PlannerData) => {
    ref.current = p;
    setData(p);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void loadPlanner()
        .then((p) => {
          if (alive) adopt({ days: p.days ?? {}, habits: p.habits ?? [] });
        })
        .catch(() => alive && !ref.current && adopt({ days: {}, habits: [] }));
    loadRef.current = load;
    load();
    const onChange = () => {
      if (selfEvent) return;
      if (pending.current > 0) reloadAfter.current = true;
      else load();
    };
    window.addEventListener('sm-planner-changed', onChange);
    return () => {
      alive = false;
      window.removeEventListener('sm-planner-changed', onChange);
    };
  }, [adopt]);

  const commit = useCallback(
    (p: PlannerData) => {
      adopt(p);
      pending.current++;
      savePlanner(p)
        .then((saved) => {
          // в сохранённом могут быть дни и привычки с другого устройства — взять те, что здесь не трогали
          const cur = ref.current;
          if (!cur) return;
          const sig = (d: PlannerDay | undefined) => (d ? JSON.stringify({ ...d, updatedAt: 0 }) : '');
          let changed = false;
          const days = { ...cur.days };
          for (const [k, d] of Object.entries(saved.days)) {
            if (cur.days[k] === p.days[k] && sig(d) !== sig(cur.days[k])) {
              days[k] = d;
              changed = true;
            }
          }
          let habits = cur.habits;
          if (cur.habits === p.habits && JSON.stringify(saved.habits) !== JSON.stringify(cur.habits)) {
            habits = saved.habits;
            changed = true;
          }
          if (changed) adopt({ ...cur, days, habits });
          // календарь, виджет, брифинг — пусть обновятся
          announce();
        })
        .catch(() => toast('Не удалось сохранить привычки'))
        .finally(() => {
          pending.current--;
          if (pending.current === 0 && reloadAfter.current) {
            reloadAfter.current = false;
            loadRef.current();
          }
        });
    },
    [adopt],
  );

  const updateDay = useCallback(
    (ymd: string, fn: (d: PlannerDay) => PlannerDay) => {
      const p = ref.current;
      if (!p) return;
      // пустой день не удаляем: отсутствие дня синхронизация не считает удалением
      commit({ ...p, days: { ...p.days, [ymd]: fn({ ...(p.days[ymd] ?? emptyDay()) }) } });
    },
    [commit],
  );

  /** изменить список привычек на свежих данных */
  const updateHabits = useCallback(
    (fn: (list: Habit[]) => Habit[]) => {
      const p = ref.current;
      if (p) commit({ ...p, habits: fn(p.habits) });
    },
    [commit],
  );

  return { data, ref, commit, updateDay, updateHabits };
}

/** Сегодняшняя дата, которая сама меняется после полуночи */
function useToday(): string {
  const [today, setToday] = useState(todayYmd);
  useEffect(() => {
    const check = () => setToday(todayYmd());
    const t = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  return today;
}

// ---------- Раздел ----------

export default function Habits() {
  const { data, ref, commit, updateDay, updateHabits } = usePlannerData();
  const today = useToday();
  /** выбранный день; null — всегда «сегодня» */
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;
  /** показанная неделя; null — та, где выбранный день */
  const [weekPin, setWeekPin] = useState<string | null>(null);
  const weekStart = weekPin ?? mondayOf(date);
  const [weekDir, setWeekDir] = useState<'l' | 'r' | ''>('');
  const [showOff, setShowOff] = useState(false);
  const [manager, setManager] = useState<false | 'mine' | 'library'>(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Habit | 'new' | null>(null);
  const [burst, setBurst] = useState<string | null>(null);
  /** лист заморозки: меню привычки или сразу «Пауза…» */
  const [sheet, setSheet] = useState<{ id: string; stage: 'menu' | 'pause' } | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(burstTimer.current), []);

  const habits = useMemo(() => activeHabits(data?.habits), [data]);
  const days = useMemo(() => data?.days ?? {}, [data]);

  const pick = (ymd: string) => {
    setPicked(ymd === today ? null : ymd);
    setWeekPin(null);
  };
  const shiftWeek = (n: number) => {
    const next = addDaysYmd(weekStart, n * 7);
    if (next > mondayOf(today)) return;
    setWeekDir(n > 0 ? 'r' : 'l');
    setWeekPin(next === mondayOf(date) ? null : next);
  };

  // ----- сводка -----
  const due = useMemo(() => {
    // «несколько раз в день» — по времени следующего приёма
    const at = (h: Habit) => nextSlot(h, countOn(days[date], h)) ?? h.time;
    return habits.filter((h) => isDue(days, h, date)).sort((a, b) => compareByTime({ ...a, time: at(a) }, { ...b, time: at(b) }));
  }, [habits, days, date]);
  const frozen = useMemo(() => habits.filter((h) => isFrozen(days, h, date)), [habits, days, date]);
  const off = useMemo(() => habits.filter((h) => !isDue(days, h, date) && !isFrozen(days, h, date)), [habits, days, date]);
  const doneCount = due.filter((h) => doneOn(days, h, date)).length;
  const bestNow = useMemo(() => {
    let best: { h: Habit; s: Streak } | null = null;
    for (const h of habits) {
      const s = currentStreak(days, h, today);
      if (s.n === 0) continue;
      // дни сравниваем с днями; недели — только если серий по дням нет
      const score = s.unit === 'week' ? s.n * 7 - 0.5 : s.n;
      const bScore = best ? (best.s.unit === 'week' ? best.s.n * 7 - 0.5 : best.s.n) : -1;
      if (score > bScore) best = { h, s };
    }
    return best;
  }, [habits, days, today]);
  const weekRate = useMemo(() => {
    let done = 0;
    let all = 0;
    const mon = mondayOf(today);
    for (let i = 0; i < 7; i++) {
      const d = addDaysYmd(mon, i);
      if (d > today) break;
      const s = dayScore(days, habits, d);
      done += s.done;
      all += s.due;
    }
    return all ? done / all : null;
  }, [habits, days, today]);

  // ----- действия -----
  const tap = (h: Habit, delta?: -1) => {
    if (date > today) {
      toast('Отметить привычку заранее нельзя');
      return;
    }
    const before = ref.current;
    if (!before) return;
    let nowDone = false;
    updateDay(date, (d) => {
      const on = doneOn({ [date]: d }, h, date);
      const next = isCounter(h) ? withCount(d, h, countOn(d, h) + (delta ?? (on ? -1 : 1))) : withDone(d, h, !on);
      nowDone = !on && doneOn({ [date]: next }, h, date);
      return next;
    });
    if (date === today) syncSoon(1500);
    if (nowDone) {
      haptic();
      clearTimeout(burstTimer.current);
      setBurst(h.id);
      burstTimer.current = setTimeout(() => setBurst(null), 750);
      const after = ref.current!;
      const list = habits.filter((x) => isDue(after.days, x, date));
      const allNow = list.length > 0 && list.every((x) => doneOn(after.days, x, date));
      const allBefore = list.every((x) => doneOn(before.days, x, date));
      if (allNow && !allBefore) {
        toast(date === today ? '🎉 Все привычки на сегодня выполнены!' : '🎉 Все привычки за этот день выполнены');
        celebrate();
      }
    }
  };
  /** отметка дня из карточки привычки (тепловая карта) */
  const toggleHabitDay = (h: Habit, ymd: string) => {
    if (ymd > today) return;
    updateDay(ymd, (d) => withDone(d, h, !doneOn({ [ymd]: d }, h, ymd)));
    if (ymd === today) syncSoon(1500);
  };
  const saveHabit = (h: Habit) => {
    const p = ref.current;
    if (!p) return;
    const exists = p.habits.some((x) => x.id === h.id);
    commit({ ...p, habits: exists ? p.habits.map((x) => (x.id === h.id ? h : x)) : [...p.habits, h] });
    if (reminderTimeOf(h) && !h.archived) void askNotifyIfNeeded();
    syncSoon(300);
  };
  // ----- заморозка серии -----
  const freeze = freezeHandlers(() => ({ updateHabits, updateDay, today, feedback: haptic }));

  const addPreset = (h: Habit) => {
    saveHabit(h);
    toast(`${h.icon ?? ''} «${h.name}» добавлена`.trim());
  };
  const archiveHabit = (h: Habit, archived: boolean) => {
    saveHabit(cleanHabit({ ...h, archived }));
    toast(archived ? 'Привычка в архиве — история сохранена' : 'Привычка снова активна');
    if (archived) setDetailId(null);
  };
  const deleteHabit = async (h: Habit) => {
    const ok = await confirmDialog(`Удалить привычку «${h.name}»?`, 'История отметок этой привычки тоже будет удалена. Чтобы сохранить историю, отправьте привычку в архив.', {
      okText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    const p = ref.current;
    if (!p) return;
    const nextDays: Record<string, PlannerDay> = {};
    for (const [k, d] of Object.entries(p.days)) nextDays[k] = withoutHabit(d, h.id);
    // отметка об удалении остаётся в списке — чтобы привычка не вернулась при синхронизации с другого устройства
    const tomb: Habit = { id: h.id, name: h.name, color: h.color, deleted: true, archived: true, updatedAt: Date.now() };
    commit({ habits: p.habits.map((x) => (x.id === h.id ? tomb : x)), days: nextDays });
    setDetailId(null);
    setEditing(null);
    syncSoon(300);
  };

  /** Удалить сразу (свайп, меню) — с возможностью вернуть в течение нескольких секунд */
  const removeHabit = (h: Habit) => {
    const p = ref.current;
    const orig = p?.habits.find((x) => x.id === h.id);
    if (!p || !orig) return;
    const touched: Record<string, PlannerDay> = {};
    const nextDays = { ...p.days };
    for (const [k, d] of Object.entries(p.days)) {
      if (!d.habits?.includes(h.id) && !d.skipped?.includes(h.id) && d.habitCounts?.[h.id] == null) continue;
      touched[k] = d;
      nextDays[k] = withoutHabit(d, h.id);
    }
    const tomb: Habit = { id: h.id, name: h.name, color: h.color, deleted: true, archived: true, updatedAt: Date.now() };
    commit({ ...p, habits: p.habits.map((x) => (x.id === h.id ? tomb : x)), days: nextDays });
    if (detailId === h.id) setDetailId(null);
    haptic();
    syncSoon(300);
    toast(`«${h.name}» удалена`, {
      label: 'Вернуть',
      run: () => {
        const c = ref.current;
        if (!c) return;
        const days = { ...c.days };
        for (const [k, old] of Object.entries(touched)) days[k] = withHabitMarks(days[k] ?? emptyDay(), old, h.id);
        // свежая отметка времени — восстановленная привычка побеждает удаление и на других устройствах
        commit({ ...c, habits: c.habits.map((x) => (x.id === h.id ? { ...orig, updatedAt: Date.now() } : x)), days });
        syncSoon(300);
      },
    });
  };

  if (!data) {
    return (
      <div className="page hp-page">
        <div className="page-body hp-body">
          <div className="hp-wrap">
            <div className="hp-hero hp-skel" />
            <div className="hp-week hp-skel" />
            <div className="hp-card hp-skel" />
            <div className="hp-card hp-skel" />
          </div>
        </div>
      </div>
    );
  }

  const day = data.days[date] ?? emptyDay();
  const detail = detailId ? data.habits.find((h) => h.id === detailId && !h.deleted) : undefined;
  const sheetHabit = sheet ? data.habits.find((h) => h.id === sheet.id && !h.deleted) : undefined;
  const pausedNow = habits.filter((h) => hasPauseAhead(h, today));
  const groups = PARTS.map((p) => ({ ...p, list: due.filter((h) => partNow(h, countOn(days[date], h)) === p.id) })).filter((g) => g.list.length);
  const isToday = date === today;
  const future = date > today;
  const card = (h: Habit, isOff?: boolean) => (
    <HabitCard
      key={h.id}
      h={h}
      days={days}
      date={date}
      off={isOff}
      burst={burst === h.id}
      onTap={() => tap(h)}
      onMinus={() => tap(h, -1)}
      onOpen={() => setDetailId(h.id)}
      onMenu={() => setSheet({ id: h.id, stage: 'menu' })}
      onDelete={() => removeHabit(h)}
    />
  );

  return (
    <div className="page hp-page">
      {/* компактная стеклянная панель — появляется при прокрутке (src/ui/navbar.ts) */}
      <div className="page-header hp-navbar" aria-hidden="true">
        <h1>Привычки</h1>
      </div>
      <div className="page-body hp-body">
        <div className="hp-wrap">
          {/* ----- шапка: заголовок и кнопки ----- */}
          <header className="hp-top">
            <h1 className="hp-title">Привычки</h1>
            <div className="hp-hero-actions">
              <button className="hp-round" onClick={() => setManager('library')} aria-label="Библиотека привычек" title="Библиотека привычек">
                <Sparkle size={20} weight="duotone" />
              </button>
              <button className="hp-round" onClick={() => setManager('mine')} aria-label="Мои привычки и архив" title="Мои привычки и архив">
                <SlidersHorizontal size={20} weight="duotone" />
              </button>
              <button className="hp-round hp-round-accent" onClick={() => setEditing('new')} aria-label="Новая привычка" title="Новая привычка">
                <Plus size={20} weight="bold" />
              </button>
            </div>
          </header>

          {habits.length === 0 ? (
            <EmptyState
              names={new Set(data.habits.filter((h) => !h.deleted && !h.archived).map((h) => h.name.toLowerCase()))}
              onLibrary={() => setManager('library')}
              onCreate={() => setEditing('new')}
              onQuick={addPreset}
            />
          ) : (
            <>
              {/* ----- сводка дня и неделя — одна компактная карточка ----- */}
              <section className={`hp-sum${due.length > 0 && doneCount === due.length ? ' full' : ''}`}>
                <div className="hp-sum-row">
                  <BigRing done={doneCount} total={due.length} size={58} />
                  <div className="hp-sum-text">
                    <div className="hp-sum-big">
                      {due.length === 0 ? (
                        frozen.length > 0 ? (
                          'Пауза ❄️'
                        ) : (
                          'Свободный день'
                        )
                      ) : (
                        <>
                          {doneCount} из {due.length} {isToday ? 'сегодня' : future ? 'по плану' : 'за день'}
                        </>
                      )}
                      {!isToday && <span className="hp-sum-date"> · {relLabel(date, today).toLowerCase()}</span>}
                    </div>
                    <div className="hp-sum-chips">
                      {bestNow && (
                        <span className="hp-chip fire" title={`Лучшая текущая серия: «${bestNow.h.name}»`}>
                          <Fire size={14} weight="fill" />
                          <b>{streakText(bestNow.s)}</b>
                        </span>
                      )}
                      {weekRate !== null && (bestNow || weekRate > 0) && (
                        <span className="hp-chip" title="Выполнено за эту неделю">
                          <Trophy size={14} weight="duotone" />
                          <b>{Math.round(weekRate * 100)}%</b>
                          <span className="hp-chip-dim">за неделю</span>
                        </span>
                      )}
                      {pausedNow.length > 0 && (
                        <button
                          className="hp-chip hp-chip-pause"
                          onClick={() => (pausedNow.length === 1 ? setSheet({ id: pausedNow[0].id, stage: 'menu' }) : freeze.resume('all'))}
                          title={pausedNow.length === 1 ? 'Пауза: возобновить или продлить' : 'Снять паузу со всех привычек'}
                        >
                          <Pause size={14} weight="fill" />
                          <b className="ellipsis">
                            {pausedNow.length === 1
                              ? pausedNow[0].name
                              : pausedNow.length === habits.length
                                ? 'Все на паузе'
                                : `${pausedNow.length} на паузе`}
                          </b>
                        </button>
                      )}
                      {!bestNow && !(weekRate !== null && weekRate > 0) && pausedNow.length === 0 && (
                        <span className="hp-sum-hint">
                          {due.length === 0 && frozen.length > 0 ? 'Серии заморожены — они не прервутся' : heroHint(doneCount, due.length, isToday, future)}
                        </span>
                      )}
                    </div>
                  </div>
                  {(date !== today || weekStart < mondayOf(today)) && (
                    <button className="hp-today-btn" onClick={() => pick(today)}>
                      Сегодня
                    </button>
                  )}
                </div>
                <WeekStrip
                  weekStart={weekStart}
                  dir={weekDir}
                  date={date}
                  today={today}
                  score={(ymd) => dayScore(days, habits, ymd)}
                  onPick={pick}
                  onShift={shiftWeek}
                />
              </section>

              <div className="hp-layout">
                <main className="hp-main">
                  {future && <div className="hp-note">Это будущий день — здесь видно, что запланировано. Отмечать можно в сам день.</div>}
                  {due.length === 0 && frozen.length === 0 && (
                    <div className="hp-free">
                      <span className="hp-free-ic">
                        <Sun size={30} weight="duotone" />
                      </span>
                      <div>
                        <div className="hp-free-title">На этот день привычек нет по плану</div>
                        <div className="hp-free-sub">Можно отметить любую из списка ниже — это бонус к статистике.</div>
                      </div>
                    </div>
                  )}
                  {groups.map((g) => {
                    const PartIcon = PART_ICONS[g.id];
                    const done = g.list.filter((h) => doneOn(days, h, date)).length;
                    return (
                      <section key={g.id} className={`hp-group part-${g.id}`}>
                        <div className="hp-group-head">
                          <span className="hp-part-ic">
                            <PartIcon size={22} weight="duotone" />
                          </span>
                          <h2>{g.label}</h2>
                          <span className={`hp-count${done === g.list.length ? ' full' : ''}`}>
                            {done === g.list.length && <Check size={14} weight="bold" />}
                            {done}/{g.list.length}
                          </span>
                        </div>
                        <div className="hp-list">{g.list.map((h) => card(h))}</div>
                      </section>
                    );
                  })}
                  {frozen.length > 0 && (
                    <section className="hp-group hp-frozen">
                      <div className="hp-group-head">
                        <span className="hp-part-ic">
                          <Snowflake size={22} weight="duotone" />
                        </span>
                        <h2>Пауза и пропуски</h2>
                        <span className="hp-count">{frozen.length}</span>
                      </div>
                      <div className="hp-list">{frozen.map((h) => card(h, true))}</div>
                    </section>
                  )}
                  {off.length > 0 && (
                    <section className="hp-group hp-off">
                      <button className={`hp-off-toggle${showOff ? ' open' : ''}`} onClick={() => setShowOff((v) => !v)} aria-expanded={showOff}>
                        <CaretDown size={20} weight="bold" className="hp-off-caret" />
                        <span className="grow">{isToday ? 'Не по плану сегодня' : 'Не по плану в этот день'}</span>
                        <span className="hp-count">{off.length}</span>
                      </button>
                      {showOff && <div className="hp-list">{off.map((h) => card(h, true))}</div>}
                    </section>
                  )}
                </main>

                <aside className="hp-aside">
                  <DayCard
                    key={date}
                    date={date}
                    today={today}
                    day={day}
                    onMood={(m) => updateDay(date, (d) => ({ ...d, mood: d.mood === m ? undefined : m }))}
                    onJournal={(ymd, text) => updateDay(ymd, (d) => ({ ...d, journal: text }))}
                  />
                </aside>
              </div>
            </>
          )}
        </div>
      </div>

      {manager && (
        <HabitsManager
          key={manager}
          habits={data.habits}
          initialTab={manager}
          onEdit={(h) => setDetailId(h.id)}
          onCreate={() => setEditing('new')}
          onAddPreset={addPreset}
          onRestore={(h) => archiveHabit(h, false)}
          onClose={() => setManager(false)}
        />
      )}
      {detail && (
        <HabitDetail
          h={detail}
          days={data.days}
          today={today}
          onClose={() => setDetailId(null)}
          onEdit={() => setEditing(detail)}
          onArchive={(a) => archiveHabit(detail, a)}
          onDelete={() => void deleteHabit(detail)}
          onToggleDay={(ymd) => toggleHabitDay(detail, ymd)}
          freeze={{
            onSkip: (on) => freeze.skip(detail, today, on),
            onPause: () => setSheet({ id: detail.id, stage: 'pause' }),
            onResume: () => freeze.resume(detail),
          }}
        />
      )}
      {sheet && sheetHabit && (
        <FreezeSheet
          key={`${sheet.id}|${sheet.stage}`}
          h={sheetHabit}
          days={data.days}
          date={detail ? today : date}
          today={today}
          initial={sheet.stage}
          handlers={freeze}
          onOpen={detail ? undefined : () => setDetailId(sheetHabit.id)}
          onDelete={detail ? undefined : () => removeHabit(sheetHabit)}
          onDone={() => {
            const ymd = detail ? today : date;
            updateDay(ymd, (d) => withDone(d, sheetHabit, true));
            if (ymd === today) syncSoon(1500);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {editing && (
        <HabitEditor
          key={editing === 'new' ? 'new' : editing.id}
          habit={editing === 'new' ? undefined : editing}
          colorIndex={data.habits.length}
          onSave={(h) => {
            saveHabit(h);
            setEditing(null);
            if (editing === 'new') toast(`Привычка «${h.name}» добавлена`);
          }}
          onDelete={editing === 'new' ? undefined : () => void deleteHabit(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Вернуть отметки привычки из старой версии дня в текущую */
function withHabitMarks(cur: PlannerDay, old: PlannerDay, id: string): PlannerDay {
  const out: PlannerDay = { ...cur };
  if (old.habits?.includes(id)) out.habits = [...new Set([...(cur.habits ?? []), id])];
  if (old.skipped?.includes(id)) out.skipped = [...new Set([...(cur.skipped ?? []), id])];
  const n = old.habitCounts?.[id];
  if (n != null) out.habitCounts = { ...cur.habitCounts, [id]: n };
  return out;
}

function heroHint(done: number, total: number, isToday: boolean, future: boolean): string {
  if (total === 0) return 'По плану ничего нет — отдыхайте или отметьте что-то сверх плана';
  if (future) return 'Запланировано на этот день';
  const left = total - done;
  if (left === 0) return isToday ? 'Всё выполнено — отличный день! 🎉' : 'Всё выполнено 🎉';
  if (done === 0) return isToday ? 'Начните с самой простой привычки' : `Не отмечено ${total} ${plural(total, ['привычка', 'привычки', 'привычек'])}`;
  return `Осталось ${left} ${plural(left, ['привычка', 'привычки', 'привычек'])}${isToday ? ' — вы справитесь' : ''}`;
}

// ---------- Кольца ----------

function Ring({ size, stroke, value, className, children }: { size: number; stroke: number; value: number; className?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className={`hp-ring ${className ?? ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="hp-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        {v > 0 && (
          <circle
            className="hp-ring-bar"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      {children != null && <span className="hp-ring-in">{children}</span>}
    </span>
  );
}

function BigRing({ done, total, size = 96 }: { done: number; total: number; size?: number }) {
  const gid = `hpg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const stroke = Math.max(6, Math.round(size / 9.6));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = total ? done / total : 0;
  const full = total > 0 && done === total;
  return (
    <span className={`hp-big-ring${full ? ' full' : ''}`} style={{ width: size, height: size }} role="img" aria-label={`Выполнено ${done} из ${total}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" className="hp-g1" />
            <stop offset="100%" className="hp-g2" />
          </linearGradient>
        </defs>
        <circle className="hp-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        {v > 0 && (
          <circle
            className="hp-ring-bar"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            fill="none"
            stroke={`url(#${gid})`}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <span className="hp-big-ring-in">
        {full ? (
          <Check size={Math.round(size * 0.42)} weight="bold" />
        ) : (
          <>
            <b>{done}</b>
            <small>/{total}</small>
          </>
        )}
      </span>
    </span>
  );
}

// ---------- Неделя ----------

function WeekStrip({
  weekStart,
  dir,
  date,
  today,
  score,
  onPick,
  onShift,
}: {
  weekStart: string;
  dir: 'l' | 'r' | '';
  date: string;
  today: string;
  score: (ymd: string) => { done: number; due: number; frozen: number };
  onPick: (ymd: string) => void;
  onShift: (n: number) => void;
}) {
  const touch = useRef<{ x: number; y: number } | null>(null);
  const atCurrent = weekStart >= mondayOf(today);
  const onStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onEnd = (e: ReactTouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) onShift(dx > 0 ? -1 : 1);
  };
  return (
    <div className="hp-week" aria-label="Неделя">
      {!atCurrent && <div className="hp-week-title">{weekLabel(weekStart, today)}</div>}
      <div className="hp-week-row">
        <button className="hp-week-nav" onClick={() => onShift(-1)} aria-label="Предыдущая неделя">
          <CaretLeft size={16} weight="bold" />
        </button>
      <div key={weekStart} className={`hp-week-days${dir ? ` slide-${dir}` : ''}`} onTouchStart={onStart} onTouchEnd={onEnd}>
        {Array.from({ length: 7 }, (_, i) => {
          const ymd = addDaysYmd(weekStart, i);
          const d = fromYmd(ymd);
          const fut = ymd > today;
          const s = score(ymd);
          const v = s.due ? s.done / s.due : 0;
          const full = !fut && s.due > 0 && s.done === s.due;
          // все привычки дня заморожены — кольцо «ледяное»
          const iced = s.due === 0 && s.frozen > 0;
          return (
            <button
              key={ymd}
              className={`hp-day${ymd === date ? ' sel' : ''}${ymd === today ? ' today' : ''}${fut ? ' future' : ''}${full ? ' full' : ''}${iced ? ' iced' : ''}`}
              onClick={() => onPick(ymd)}
              aria-pressed={ymd === date}
              aria-label={`${dateLine(ymd)}${s.due && !fut ? `: ${s.done} из ${s.due}` : ''}${iced ? ' — пауза' : s.frozen ? ` (на паузе: ${s.frozen})` : ''}`}
            >
              <span className="hp-day-wd">{WD_SHORT[d.getDay()]}</span>
              <Ring size={36} stroke={3.5} value={fut ? 0 : v} className="hp-day-ring">
                {full ? <Check size={15} weight="bold" /> : d.getDate()}
              </Ring>
              {s.frozen > 0 && (
                <span className="hp-day-ice" aria-hidden>
                  <Snowflake size={11} weight="bold" />
                </span>
              )}
            </button>
          );
        })}
      </div>
        <button className="hp-week-nav" onClick={() => onShift(1)} disabled={atCurrent} aria-label="Следующая неделя">
          <CaretRight size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}

// ---------- Карточка привычки ----------

function HabitCard({
  h,
  days,
  date,
  off,
  burst,
  onTap,
  onMinus,
  onOpen,
  onMenu,
  onDelete,
}: {
  h: Habit;
  days: Days;
  date: string;
  off?: boolean;
  burst?: boolean;
  onTap: () => void;
  onMinus: () => void;
  onOpen: () => void;
  /** долгое нажатие / правая кнопка: пропуск, пауза, удаление */
  onMenu: () => void;
  /** свайп влево — «Удалить» */
  onDelete: () => void;
}) {
  const press = useLongPress(onMenu);
  const on0 = doneOn(days, h, date);
  // свайп вправо — отметить (как «Выполнить» у задач); уже отмеченную и замороженную — не трогаем
  const swipe = useSwipeActions({ onDelete, onRight: on0 || frozenOn(days, h, date) ? undefined : onTap });
  const g = mergeHandlers(press, swipe.bind);
  const ice = freezeStatus(days, h, date);
  const fz = frozenOn(days, h, date);
  const on = on0;
  const t = targetOf(h);
  const count = countOn(days[date], h);
  const counter = t > 1;
  const streak = currentStreak(days, h, date);
  const f = freqOf(h);
  const slots = timesOf(h);
  const time = slots.length ? (h.duration ? durationLabel(h.duration) : '') : timeRangeLabel(h) || (h.duration ? durationLabel(h.duration) : '');
  const freq = f === 'weekly' ? `${weekCount(days, h, date)} из ${weekGoal(days, h, date)} за неделю` : f === 'weekdays' ? freqLabel(h) : '';
  return (
    <div ref={swipe.wrap} className={`hp-swipe ${swipe.wrapClass}`}>
      <SwipeBg dx={swipe.dx} armed={swipe.armed} onDelete={swipe.confirmDelete} rightLabel={counter && !slots.length ? '+1' : 'Отметить'} deleteLabel="Удалить" />
    <div
      className={`hp-card sw-row${on ? ' on' : ''}${off ? ' off' : ''}${fz ? ` frozen ${fz}` : ''}${burst ? ' burst' : ''}`}
      style={{ '--hc': h.color, ...swipe.style } as CSSProperties}
      {...g}
    >
      <button className="hp-card-main" onClick={onOpen} aria-label={`${h.name}: статистика и настройки`}>
        <span className="hp-tile" aria-hidden>
          {h.icon ?? '🔥'}
        </span>
        <span className="hp-card-body">
          <span className="hp-name">{h.name}</span>
          <span className="hp-meta">
            {slots.length > 0 && (
              <span className="hp-slots" aria-label={`Отмечено ${Math.min(count, slots.length)} из ${slots.length}`}>
                {slots.map((tm, i) => (
                  <span key={i} className={`hp-slot${count > i ? ' on' : ''}`}>
                    {count > i ? <Check size={12} weight="bold" /> : <Clock size={12} weight="bold" />}
                    {tm}
                  </span>
                ))}
              </span>
            )}
            {counter && !slots.length && (
              <span className="hp-meta-count">
                {count} / {t}
                {h.unit ? ` ${h.unit}` : ''}
              </span>
            )}
            {time && (
              <span className="hp-meta-item">
                <Clock size={15} weight="duotone" />
                {time}
              </span>
            )}
            {ice && (
              <span className="hp-meta-ice">
                {fz === 'skip' ? <Snowflake size={15} weight="bold" /> : <Pause size={15} weight="fill" />}
                {ice}
              </span>
            )}
            {!ice && freq && <span className="hp-meta-item">{freq}</span>}
            {!ice && !counter && !time && !freq && <span className="hp-meta-item">Каждый день</span>}
            {streak.n > 0 && (
              <span className="hp-streak" title={`Серия: ${streakText(streak)}`}>
                <Fire size={15} weight="fill" />
                {streak.n}
                {streak.unit === 'week' ? ' нед' : ''}
              </span>
            )}
          </span>
        </span>
      </button>
      {counter && count > 0 && !on && !fz && (
        <button className="hp-minus" onClick={onMinus} aria-label={`${h.name}: −1`}>
          <Minus size={18} weight="bold" />
        </button>
      )}
      {fz ? (
        <button className="hp-check hp-check-ice" onClick={onMenu} aria-label={`${h.name}: ${ice ?? ''} — изменить`}>
          {fz === 'skip' ? <Snowflake size={26} weight="bold" /> : <Pause size={24} weight="fill" />}
        </button>
      ) : (
      <button
        className={`hp-check${counter && !on ? ' is-counter' : ''}`}
        onClick={onTap}
        aria-pressed={on}
        aria-label={counter && !on ? `${h.name}: +1` : on ? `${h.name}: снять отметку` : `${h.name}: отметить`}
      >
        {counter && !on ? (
          <Ring size={56} stroke={5} value={count / t} className="hp-check-ring">
            <span className="hp-check-num">{count > 0 ? count : <Plus size={22} weight="bold" />}</span>
          </Ring>
        ) : (
          <Check size={28} weight="bold" className="hp-check-ic" />
        )}
      </button>
      )}
    </div>
    </div>
  );
}

// ---------- Пусто ----------

function EmptyState({ names, onLibrary, onCreate, onQuick }: { names: Set<string>; onLibrary: () => void; onCreate: () => void; onQuick: (h: Habit) => void }) {
  const quick = QUICK.map((n) => HABIT_LIBRARY.find((p) => p.name === n)).filter((p) => p !== undefined);
  return (
    <section className="hp-empty">
      <span className="hp-empty-art">
        <Plant size={64} weight="duotone" />
      </span>
      <h2>Начните с одной привычки</h2>
      <p>Маленькие шаги каждый день дают большой результат. Отмечайте выполнение одним касанием и следите за сериями 🔥</p>
      <div className="hp-empty-actions">
        <button className="hp-btn hp-btn-primary" onClick={onLibrary}>
          <Sparkle size={22} weight="fill" /> Из библиотеки
        </button>
        <button className="hp-btn" onClick={onCreate}>
          <Plus size={22} weight="bold" /> Своя привычка
        </button>
      </div>
      <div className="hp-quick-title">Быстрый старт — одно касание</div>
      <div className="hp-quick">
        {quick.map((p) => {
          const added = names.has(p.name.toLowerCase());
          return (
            <button
              key={p.name}
              className={`hp-quick-item${added ? ' added' : ''}`}
              style={{ '--hc': p.color ?? 'var(--accent)' } as CSSProperties}
              disabled={added}
              onClick={() => onQuick(habitFromPreset(p))}
            >
              <span className="hp-quick-ic">{p.icon}</span>
              <span className="hp-quick-name">{p.name}</span>
              {added ? <Check size={18} weight="bold" /> : <Plus size={18} weight="bold" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Как прошёл день ----------

function DayCard({
  date,
  today,
  day,
  onMood,
  onJournal,
}: {
  date: string;
  today: string;
  day: PlannerDay;
  onMood: (m: string) => void;
  onJournal: (ymd: string, text: string) => void;
}) {
  const mood = MOODS.find((m) => m.e === day.mood);
  return (
    <section className="hp-daycard">
      <div className="hp-daycard-head">
        <span className="hp-daycard-ic">
          <NotePencil size={22} weight="duotone" />
        </span>
        <div className="grow">
          <h2>Как прошёл день</h2>
          <div className="hp-daycard-sub">{date === today ? 'Сегодня' : dateLine(date)}</div>
        </div>
        {mood && <span className="hp-mood-name">{mood.name}</span>}
      </div>
      <div className="hp-moods" role="group" aria-label="Настроение">
        {MOODS.map((m) => (
          <button key={m.e} className={`hp-mood${day.mood === m.e ? ' active' : ''}`} aria-pressed={day.mood === m.e} title={m.name} aria-label={m.name} onClick={() => onMood(m.e)}>
            <span>{m.e}</span>
          </button>
        ))}
      </div>
      <Journal date={date} initial={day.journal} onSave={onJournal} />
    </section>
  );
}

function Journal({ date, initial, onSave }: { date: string; initial: string; onSave: (ymd: string, text: string) => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; text: string } | null>(null);
  const saveRef = useRef(onSave);
  useLayoutEffect(() => {
    saveRef.current = onSave;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(112, el.scrollHeight)}px`;
  }, [text]);

  // несохранённое — сохранить при уходе со страницы / смене дня (компонент пересоздаётся по ключу дня)
  useEffect(
    () => () => {
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
    <div className="hp-journal">
      <textarea ref={ref} className="hp-journal-text" placeholder="Мысли, победы дня, за что благодарны…" value={text} onChange={(e) => change(e.target.value)} />
      {words > 0 && (
        <div className="hp-journal-count">
          {words} {plural(words, ['слово', 'слова', 'слов'])}
        </div>
      )}
    </div>
  );
}
