import { LOCALE, t, tn } from '../i18n/index';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Check, Clock, Flame, Hourglass, ListChecks, MagnifyingGlass, Pause, Play, Plus, SkipForward, SlidersHorizontal, SpeakerHigh, Stop, Target, Timer, Trash, Trophy, WarningCircle, Watch, X } from '@phosphor-icons/react';
import type { Countdown, TasksData } from '../tasks/model';
import { daysBetween, durationLabel, isActive, isOverdue, LIST_COLORS, shortDate, WEEKDAYS, whenLabel } from '../tasks/model';
import { deleteCountdown, ensureTasks, saveCountdown, setPrefs, toggleDone, useTasks } from '../tasks/store';
import type { NoiseKind } from '../tasks/focusTimer';
import {
  elapsedMs,
  focusProgress,
  formatMs,
  isFocusActive,
  pause,
  PHASE_LABEL,
  remainingMs,
  resume,
  setMode,
  setNoise,
  setTask,
  setVolume,
  skip,
  start,
  stop,
  useFocus,
} from '../tasks/focusTimer';
import { addDaysYmd, fromYmd, todayYmd, toYmd } from '../utils/mapTasks';
import { uid } from '../utils/tree';
import { toast } from '../store/appStore';
import { confirmDialog } from '../ui/dialogs';
import './focus.css';
import { IconTile } from '../ui/icons';

type Tab = 'pomo' | 'stats' | 'countdown';
const TAB_KEY = 'sm-focus-tab';

const NOISES: { v: NoiseKind; label: string }[] = [
  { v: 'none', label: t('Нет') },
  { v: 'white', label: t('Белый шум') },
  { v: 'pink', label: t('Розовый шум') },
  { v: 'brown', label: t('Коричневый шум') },
  { v: 'rain', label: t('Дождь') },
];

const EMOJIS = ['🎂', '🎉', '❤️', '💍', '✈️', '🏖️', '🎓', '💼', '🏠', '👶', '🎄', '🎁', '⭐', '🏆', '📅', '⏳'];
const WD_SHORT = [t('Вс'), t('Пн'), t('Вт'), t('Ср'), t('Чт'), t('Пт'), t('Сб')];

const dayOf = (ms: number) => toYmd(new Date(ms));
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
const lastDays = (today: string, n: number) => Array.from({ length: n }, (_, i) => addDaysYmd(today, i - (n - 1)));

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'stats' || t === 'countdown' ? t : 'pomo';
  } catch {
    return 'pomo';
  }
}

// ================= Страница =================

export default function Focus() {
  const data = useTasks((s) => s.data);
  const [tab, setTabState] = useState<Tab>(readTab);

  useEffect(() => {
    void ensureTasks();
  }, []);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* без сохранения */
    }
  };

  return (
    <div className="page fx-page">
      <div className="page-header">
        <IconTile section="focus" size="sm" className="ph-tile" />
        <h1>{t('Фокус')}</h1>
        <div className="grow" />
        <div className="segmented fx-tabs">
          <button className={tab === 'pomo' ? 'active' : ''} onClick={() => setTab('pomo')}>
            {t('Таймер')}
          </button>
          <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
            {t('Статистика')}
          </button>
          <button className={tab === 'countdown' ? 'active' : ''} onClick={() => setTab('countdown')}>
            {t('Отсчёт')}
          </button>
        </div>
      </div>
      <div className="page-body">
        {!data ? (
          <div className="empty">{t('Загрузка…')}</div>
        ) : tab === 'pomo' ? (
          <PomodoroTab data={data} />
        ) : tab === 'stats' ? (
          <StatsTab data={data} />
        ) : (
          <CountdownsTab data={data} />
        )}
      </div>
    </div>
  );
}

// ================= Помодоро =================

function PomodoroTab({ data }: { data: TasksData }) {
  const f = useFocus();
  const [picker, setPicker] = useState(false);
  const [settings, setSettings] = useState(false);
  const now = Math.max(f.now, Date.now());
  const active = isFocusActive(f);
  const pomo = data.prefs.pomo;
  const isWatch = f.mode === 'stopwatch';
  const isBreak = !isWatch && f.phase !== 'work';
  const progress = focusProgress(f, now);
  const timeText = isWatch ? formatMs(elapsedMs(f, now)) : formatMs(remainingMs(f, now) + 999);
  const task = f.taskId ? data.tasks.find((t) => t.id === f.taskId && !t.deleted) : undefined;

  const R = 116;
  const C = 2 * Math.PI * R;

  const today = todayYmd();
  const todaySessions = useMemo(() => data.focus.filter((s) => dayOf(s.start) === today).sort((a, b) => b.start - a.start), [data.focus, today]);
  const todayPomos = todaySessions.filter((s) => s.kind === 'pomo').length;
  const todayMin = todaySessions.reduce((a, s) => a + s.minutes, 0);
  const titleOf = (id?: string) => (id ? data.tasks.find((t) => t.id === id)?.title || t('Без названия') : '');

  const completeTask = () => {
    if (!task) return;
    // toggleDone сам показывает уведомление с кнопкой «Отменить» (и дату следующего повтора)
    toggleDone(task.id);
  };

  return (
    <div className="fx-pomo">
      <div className="fx-pomo-top">
        <div className="segmented fx-mode-seg">
          <button className={!isWatch ? 'active' : ''} onClick={() => setMode('pomo')}>
            <Timer size={15} weight="bold" /> {t('Помодоро')}
          </button>
          <button className={isWatch ? 'active' : ''} onClick={() => setMode('stopwatch')}>
            <Watch size={15} weight="bold" /> {t('Секундомер')}
          </button>
        </div>
        <button className="icon-btn" onClick={() => setSettings(true)} aria-label={t('Настройки помодоро')} title={t('Настройки помодоро')}>
          <SlidersHorizontal weight="bold" />
        </button>
      </div>

      <button className="fx-task-pick" onClick={() => setPicker(true)}>
        <Target size={17} weight="bold" />
        <span className={'ellipsis' + (task && !isActive(task) ? ' fx-done-text' : '')}>{task ? task.title || t('Без названия') : t('Выбрать задачу')}</span>
      </button>

      <div className={'fx-ring' + (isBreak ? ' is-break' : '') + (f.running ? ' is-running' : '')}>
        <svg viewBox="0 0 260 260" aria-hidden="true">
          <circle className="fx-ring-bg" cx="130" cy="130" r={R} />
          <circle
            className="fx-ring-fg"
            cx="130"
            cy="130"
            r={R}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            transform="rotate(-90 130 130)"
          />
        </svg>
        <div className="fx-ring-center">
          <div className="fx-time">{timeText}</div>
          <div className="fx-phase">{isWatch ? t('Секундомер') : PHASE_LABEL[f.phase]}</div>
          {!isWatch && (
            <div className="fx-dots" title={t('Помодоро в цикле: {done} из {total}', { done: Math.min(f.completedPomos, pomo.longEvery), total: pomo.longEvery })}>
              {Array.from({ length: Math.max(1, pomo.longEvery) }, (_, i) => (
                <span key={i} className={i < Math.min(f.completedPomos, pomo.longEvery) ? 'on' : ''} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="fx-controls">
        {!active ? (
          <>
            <button className="btn btn-primary fx-main-btn" onClick={start}>
              <Play size={22} weight="fill" />
              <span>{isBreak ? t('Перерыв') : t('Старт')}</span>
            </button>
            {isBreak && (
              <button className="btn fx-side-btn fx-skip" onClick={skip}>
                <SkipForward size={20} weight="fill" />
                <span>{t('Пропуск')}</span>
              </button>
            )}
          </>
        ) : (
          <>
            {f.running ? (
              <button className="btn btn-primary fx-main-btn" onClick={pause}>
                <Pause size={22} weight="fill" />
                <span>{t('Пауза')}</span>
              </button>
            ) : (
              <button className="btn btn-primary fx-main-btn" onClick={resume}>
                <Play size={22} weight="fill" />
                <span>{t('Дальше')}</span>
              </button>
            )}
            <button className="btn fx-side-btn fx-stop" onClick={stop}>
              <Stop size={20} weight="fill" />
              <span>{t('Стоп')}</span>
            </button>
            {!isWatch && (
              <button className="btn fx-side-btn fx-skip" onClick={skip}>
                <SkipForward size={20} weight="fill" />
                <span>{t('Пропуск')}</span>
              </button>
            )}
          </>
        )}
      </div>

      {task && isActive(task) && (
        <button className="btn btn-sm btn-ghost fx-complete" onClick={completeTask}>
          <Check size={15} weight="bold" /> {t('Выполнить задачу')}
        </button>
      )}

      <div className="fx-noise">
        <div className="row fx-noise-head">
          <SpeakerHigh size={17} weight="fill" className="fx-noise-ic" />
          <span className="small bold">{t('Фоновый звук')}</span>
        </div>
        <div className="fx-chips">
          {NOISES.map((n) => (
            <button key={n.v} className={'chip' + (f.noise === n.v ? ' active' : '')} onClick={() => setNoise(n.v)}>
              {n.label}
            </button>
          ))}
        </div>
        {f.noise !== 'none' && (
          <div className="row fx-volume">
            <span className="tiny faint">{t('Громкость')}</span>
            <input type="range" min={0} max={1} step={0.01} value={f.volume} onChange={(e) => setVolume(Number(e.target.value))} className="grow" />
          </div>
        )}
        {f.noise !== 'none' && !f.running && <div className="tiny faint">{t('Звук играет, пока идёт таймер')}</div>}
      </div>

      <div className="fx-today">
        <div className="fx-today-head">
          {t('Сегодня:')} <b>{todayPomos}</b> {tn(todayPomos, 'помодоро', 'помодоро', 'помодоро')} · <b>{durationLabel(todayMin)}</b>
        </div>
        {todaySessions.length === 0 ? (
          <div className="faint small fx-today-empty">{t('Сессий фокуса сегодня ещё не было')}</div>
        ) : (
          <div className="fx-sessions">
            {todaySessions.map((s) => (
              <div key={s.id} className="fx-session">
                {s.kind === 'pomo' ? <Timer size={17} weight="fill" className="fx-session-ic" /> : <Watch size={17} weight="fill" className="fx-session-ic" />}
                <span className="fx-session-time">
                  {hhmm(s.start)}–{hhmm(s.start + s.minutes * 60000)}
                </span>
                <span className="grow ellipsis muted small">{titleOf(s.taskId) || (s.kind === 'pomo' ? t('Помодоро') : t('Секундомер'))}</span>
                <span className="small bold">{durationLabel(s.minutes)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {picker && <TaskPicker data={data} selected={f.taskId} onClose={() => setPicker(false)} />}
      {settings && <PomoSettings data={data} onClose={() => setSettings(false)} />}
    </div>
  );
}

function TaskPicker({ data, selected, onClose }: { data: TasksData; selected?: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const lists = useMemo(() => new Map(data.lists.map((l) => [l.id, l])), [data.lists]);
  const tasks = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.tasks
      .filter((t) => isActive(t) && (!s || t.title.toLowerCase().includes(s)))
      .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.order - b.order)
      .slice(0, 200);
  }, [data.tasks, q]);
  const pick = (id: string | undefined) => {
    setTask(id);
    onClose();
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal fx-picker" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row">
          <h2 className="grow">{t('Задача для фокуса')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Закрыть')}>
            <X />
          </button>
        </div>
        <div className="fx-search">
          <MagnifyingGlass size={16} />
          <input className="input" placeholder={t('Поиск задачи')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="fx-pick-list">
          <button className={'fx-pick-item' + (!selected ? ' active' : '')} onClick={() => pick(undefined)}>
            <span className="fx-pick-dot" style={{ background: 'var(--text-3)' }} />
            <span className="grow">{t('Без задачи')}</span>
            {!selected && <Check size={16} />}
          </button>
          {tasks.map((tk) => {
            const l = lists.get(tk.listId);
            return (
              <button key={tk.id} className={'fx-pick-item' + (selected === tk.id ? ' active' : '')} onClick={() => pick(tk.id)}>
                <span className="fx-pick-dot" style={{ background: l?.color ?? 'var(--text-3)' }} />
                <span className="grow fx-pick-main">
                  <span className="ellipsis">{tk.title || t('Без названия')}</span>
                  <span className="tiny faint ellipsis">
                    {[l?.name, whenLabel(tk), tk.focusMinutes ? t('фокус {time}', { time: durationLabel(tk.focusMinutes) }) : ''].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {selected === tk.id && <Check size={16} />}
              </button>
            );
          })}
          {tasks.length === 0 && <div className="faint small fx-today-empty">{q ? t('Ничего не найдено') : t('Нет активных задач')}</div>}
        </div>
      </div>
    </div>
  );
}

function PomoSettings({ data, onClose }: { data: TasksData; onClose: () => void }) {
  const [p, setP] = useState(() => ({ ...data.prefs.pomo }));
  const num = (k: 'work' | 'short' | 'long' | 'longEvery', max: number) => (
    <input
      className="input"
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      value={p[k] || ''}
      onChange={(e) => setP({ ...p, [k]: Math.min(max, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
    />
  );
  const save = () => {
    setPrefs({
      pomo: {
        work: Math.max(1, p.work),
        short: Math.max(1, p.short),
        long: Math.max(1, p.long),
        longEvery: Math.max(1, p.longEvery),
        autoNext: p.autoNext,
      },
    });
    onClose();
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row">
          <h2 className="grow">{t('Настройки помодоро')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Закрыть')}>
            <X />
          </button>
        </div>
        <div className="fx-grid2">
          <div>
            <label className="label">{t('Фокус, мин')}</label>
            {num('work', 180)}
          </div>
          <div>
            <label className="label">{t('Короткий перерыв, мин')}</label>
            {num('short', 60)}
          </div>
          <div>
            <label className="label">{t('Длинный перерыв, мин')}</label>
            {num('long', 90)}
          </div>
          <div>
            <label className="label">{t('Длинный перерыв каждые')}</label>
            {num('longEvery', 12)}
          </div>
        </div>
        <label className="row fx-check">
          <input type="checkbox" checked={p.autoNext} onChange={(e) => setP({ ...p, autoNext: e.target.checked })} />
          <span>{t('Автоматически начинать следующий этап')}</span>
        </label>
        <p className="tiny faint">{t('Новые длительности применятся со следующего запуска таймера.')}</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn btn-primary" onClick={save}>
            {t('Сохранить')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ================= Статистика =================

function StatsTab({ data }: { data: TasksData }) {
  const [range, setRange] = useState<7 | 30>(7);
  const today = todayYmd();

  const st = useMemo(() => {
    const byDay = new Map<string, number>();
    const byWd = [0, 0, 0, 0, 0, 0, 0];
    for (const l of data.log) {
      const d = dayOf(l.at);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
      byWd[new Date(l.at).getDay()]++;
    }
    const days7 = lastDays(today, 7);
    const week = days7.reduce((a, d) => a + (byDay.get(d) ?? 0), 0);
    const since7 = days7[0];
    const pending = data.tasks.filter((t) => isActive(t) && t.date && t.date >= since7 && t.date <= today).length;
    const rate = week + pending ? Math.round((week / (week + pending)) * 100) : 0;
    const overdue = data.tasks.filter((t) => isOverdue(t, today)).length;

    // серия: подряд дни с выполненными задачами (сегодня может быть ещё пустым)
    let streak = 0;
    let d = byDay.get(today) ? today : addDaysYmd(today, -1);
    while (byDay.get(d)) {
      streak++;
      d = addDaysYmd(d, -1);
    }
    let best = 0;
    let run = 0;
    let prev = '';
    for (const day of [...byDay.keys()].sort()) {
      run = prev && daysBetween(prev, day) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = day;
    }
    const maxWd = Math.max(...byWd);
    const bestWd = maxWd > 0 ? byWd.indexOf(maxWd) : -1;

    const focusByDay = new Map<string, number>();
    let focusTotal = 0;
    for (const s of data.focus) {
      const k = dayOf(s.start);
      focusByDay.set(k, (focusByDay.get(k) ?? 0) + s.minutes);
      focusTotal += s.minutes;
    }
    return { byDay, week, rate, overdue, streak, best, bestWd, maxWd, focusByDay, focusTotal, pending };
  }, [data.log, data.tasks, data.focus, today]);

  const doneBars = lastDays(today, range).map((d, i) => ({
    key: d,
    label: range === 7 ? WD_SHORT[fromYmd(d).getDay()] : i % 5 === range % 5 || d === today ? String(fromYmd(d).getDate()) : '',
    value: st.byDay.get(d) ?? 0,
    title: `${shortDate(d)}: ${st.byDay.get(d) ?? 0}`,
  }));
  const focusBars = lastDays(today, 7).map((d) => ({
    key: d,
    label: WD_SHORT[fromYmd(d).getDay()],
    value: st.focusByDay.get(d) ?? 0,
    title: `${shortDate(d)}: ${durationLabel(st.focusByDay.get(d) ?? 0)}`,
  }));
  const focusWeek = focusBars.reduce((a, b) => a + b.value, 0);

  const byList = useMemo(() => {
    const from = addDaysYmd(today, -(range - 1));
    const m = new Map<string, number>();
    for (const l of data.log) if (dayOf(l.at) >= from) m.set(l.listId, (m.get(l.listId) ?? 0) + 1);
    return [...m.entries()]
      .map(([id, n]) => {
        const l = data.lists.find((x) => x.id === id);
        return { id, n, name: l ? `${l.emoji ? l.emoji + ' ' : ''}${l.name}` : t('Удалённый список'), color: l?.color ?? 'var(--text-3)' };
      })
      .sort((a, b) => b.n - a.n);
  }, [data.log, data.lists, range, today]);
  const listMax = Math.max(1, ...byList.map((x) => x.n));

  return (
    <div className="fx-stats">
      <div className="card fx-cards">
        <StatCard icon={<Check size={15} weight="bold" />} value={st.byDay.get(today) ?? 0} label={t('Выполнено сегодня')} />
        <StatCard icon={<ListChecks size={15} weight="bold" />} value={st.week} label={t('За 7 дней')} />
        <StatCard icon={<Trophy size={15} weight="bold" />} value={data.log.length} label={t('Всего выполнено')} />
        <StatCard icon={<WarningCircle size={15} weight="bold" />} value={st.overdue} label={t('Просрочено сейчас')} tone={st.overdue ? 'danger' : undefined} />
        <StatCard icon={<Target size={15} weight="bold" />} value={`${st.rate}%`} label={t('Выполнение за 7 дней')} />
        <StatCard icon={<Flame size={15} weight="bold" />} value={st.streak} label={t('{days} подряд · рекорд {best}', { days: tn(st.streak, 'день', 'дня', 'дней'), best: st.best })} tone="warn" />
        <StatCard icon={<Clock size={15} weight="bold" />} value={durationLabel(st.focusByDay.get(today) ?? 0)} label={t('Фокус сегодня')} />
        <StatCard icon={<Timer size={15} weight="bold" />} value={durationLabel(st.focusTotal)} label={t('Фокус всего')} />
      </div>

      <div className="card fx-panel">
        <div className="row fx-panel-head">
          <h3 className="grow">{t('Выполненные задачи')}</h3>
          <div className="segmented">
            <button className={range === 7 ? 'active' : ''} onClick={() => setRange(7)}>
              {t('7 дней')}
            </button>
            <button className={range === 30 ? 'active' : ''} onClick={() => setRange(30)}>
              {t('30 дней')}
            </button>
          </div>
        </div>
        <Bars items={doneBars} showValues={range === 7} />
        <div className="tiny faint">
          {t('{rate}% выполнено за неделю · {done} {tasks} готово, {pending} ещё {wait}', { rate: st.rate, done: st.week, tasks: tn(st.week, 'задача', 'задачи', 'задач'), pending: st.pending, wait: tn(st.pending, 'ждёт', 'ждут', 'ждут') })}
        </div>
      </div>

      <div className="card fx-panel">
        <div className="row fx-panel-head">
          <h3 className="grow">{t('Фокус за неделю')}</h3>
          <span className="small muted">{durationLabel(focusWeek)}</span>
        </div>
        <Bars items={focusBars} showValues fmt={(v) => (v >= 60 ? t('{h}ч{m}', { h: Math.floor(v / 60), m: v % 60 ? v % 60 : '' }) : String(v))} tone="ok" />
      </div>

      <div className="card fx-panel">
        <div className="row fx-panel-head">
          <h3 className="grow">{t('По спискам')}</h3>
          <span className="small muted">{t('за {n} {days}', { n: range, days: tn(range, 'день', 'дня', 'дней') })}</span>
        </div>
        {byList.length === 0 ? (
          <div className="faint small">{t('Пока нет выполненных задач')}</div>
        ) : (
          <div className="fx-hbars">
            {byList.map((x) => (
              <div key={x.id} className="fx-hbar">
                <span className="fx-hbar-name ellipsis small">{x.name}</span>
                <span className="fx-hbar-track">
                  <span className="fx-hbar-fill" style={{ width: `${(x.n / listMax) * 100}%`, background: x.color }} />
                </span>
                <span className="fx-hbar-n small bold">{x.n}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card fx-panel fx-bestday">
        <Trophy size={22} weight="fill" />
        <div className="grow">
          <div className="small muted">{t('Лучший день недели')}</div>
          <div className="bold">
            {st.bestWd >= 0 ? `${WEEKDAYS[st.bestWd]} — ${st.maxWd} ${tn(st.maxWd, 'задача', 'задачи', 'задач')}` : t('Пока недостаточно данных')}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, value, label, tone }: { icon: ReactNode; value: number | string; label: string; tone?: 'danger' | 'warn' }) {
  return (
    <div className={'fx-stat' + (tone ? ' is-' + tone : '')}>
      <div className="fx-stat-label">
        <span className="fx-stat-ic">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="fx-stat-val">{value}</div>
    </div>
  );
}

function Bars({
  items,
  showValues,
  fmt = String,
  tone,
}: {
  items: { key: string; label: string; value: number; title: string }[];
  showValues?: boolean;
  fmt?: (v: number) => string;
  tone?: 'ok';
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className={'fx-bars' + (items.length > 10 ? ' is-dense' : '') + (tone ? ' is-' + tone : '')}>
      {items.map((i) => (
        <div key={i.key} className="fx-bar-col" title={i.title}>
          <span className="fx-bar-val">{showValues && i.value ? fmt(i.value) : ''}</span>
          <span className="fx-bar-track">
            <span className="fx-bar" style={{ height: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="fx-bar-label">{i.label}</span>
        </div>
      ))}
    </div>
  );
}

// ================= Обратный отсчёт =================

/** Ближайшая дата отсчёта: для ежегодных — следующая годовщина */
function cdInfo(c: Countdown, today: string): { target: string; diff: number; years: number } {
  if (!c.yearly || c.date >= today) return { target: c.date, diff: daysBetween(today, c.date), years: 0 };
  const o = fromYmd(c.date);
  const mk = (y: number) => {
    const last = new Date(y, o.getMonth() + 1, 0).getDate();
    return toYmd(new Date(y, o.getMonth(), Math.min(o.getDate(), last)));
  };
  let y = fromYmd(today).getFullYear();
  let target = mk(y);
  if (target < today) target = mk(++y);
  return { target, diff: daysBetween(today, target), years: y - o.getFullYear() };
}

function CountdownsTab({ data }: { data: TasksData }) {
  const [edit, setEdit] = useState<Countdown | 'new' | null>(null);
  const today = todayYmd();
  const items = useMemo(
    () =>
      data.countdowns
        .map((c) => ({ c, ...cdInfo(c, today) }))
        .sort((a, b) => (a.diff >= 0 ? a.diff : 1e6 - a.diff) - (b.diff >= 0 ? b.diff : 1e6 - b.diff)),
    [data.countdowns, today],
  );

  return (
    <div className="fx-cd">
      <div className="row fx-cd-head">
        <div className="grow muted small">{t('Дни рождения, праздники, поездки и важные даты')}</div>
        <button className="btn btn-sm btn-primary" onClick={() => setEdit('new')}>
          <Plus size={16} weight="bold" /> {t('Добавить')}
        </button>
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <IconTile icon={Hourglass} tone="indigo" size="lg" />
          <div>{t('Добавьте событие, чтобы видеть, сколько дней до него осталось')}</div>
        </div>
      ) : (
        <div className="fx-cd-grid">
          {items.map(({ c, diff, target, years }) => (
            <button key={c.id} className="fx-cd-card" style={{ '--c': c.color } as CSSProperties} onClick={() => setEdit(c)}>
              <span className="fx-cd-emoji">{c.emoji || '📅'}</span>
              <span className="fx-cd-main">
                <span className="fx-cd-title ellipsis">{c.title}</span>
                <span className="tiny faint">
                  {shortDate(target)} {fromYmd(target).getFullYear()}
                  {c.yearly ? t(' · каждый год') + (years > 0 ? ` · ${years} ${tn(years, 'год', 'года', 'лет')}` : '') : ''}
                </span>
              </span>
              <span className="fx-cd-days">
                {diff === 0 ? (
                  <span className="fx-cd-today">{t('Сегодня!')}</span>
                ) : (
                  <>
                    <span className="tiny faint">{diff > 0 ? t('через') : t('прошло')}</span>
                    <span className="fx-cd-num">{Math.abs(diff)}</span>
                    <span className="tiny faint">{tn(diff < 0 ? -diff : diff, 'день', 'дня', 'дней')}</span>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      {edit && <CountdownModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CountdownModal({ item, onClose }: { item: Countdown | null; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [date, setDate] = useState(item?.date ?? addDaysYmd(todayYmd(), 7));
  const [emoji, setEmoji] = useState(item?.emoji ?? '🎉');
  const [color, setColor] = useState(item?.color ?? LIST_COLORS[0]);
  const [yearly, setYearly] = useState(!!item?.yearly);

  const save = () => {
    if (!title.trim()) return toast(t('Введите название'));
    if (!date) return toast(t('Выберите дату'));
    const c: Countdown = { id: item?.id ?? uid(), title: title.trim(), date, emoji, color };
    if (yearly) c.yearly = true;
    saveCountdown(c);
    onClose();
  };
  const remove = async () => {
    if (!item) return;
    if (await confirmDialog(t('Удалить отсчёт?'), t('«{name}» будет удалён.', { name: item.title }), { okText: t('Удалить'), danger: true })) {
      deleteCountdown(item.id);
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row">
          <h2 className="grow">{item ? t('Отсчёт') : t('Новый отсчёт')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Закрыть')}>
            <X />
          </button>
        </div>
        <label className="label">{t('Название')}</label>
        <input
          className="input"
          value={title}
          placeholder={t('Например, День рождения мамы')}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          autoFocus={!item}
        />
        <label className="label">{t('Дата')}</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="row fx-check">
          <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} />
          <span>{t('Каждый год (дни рождения, годовщины)')}</span>
        </label>
        <label className="label">{t('Значок')}</label>
        <div className="fx-emojis">
          {EMOJIS.map((e) => (
            <button key={e} className={'fx-emoji' + (emoji === e ? ' active' : '')} onClick={() => setEmoji(e)}>
              {e}
            </button>
          ))}
        </div>
        <label className="label">{t('Цвет')}</label>
        <div className="fx-swatches">
          {LIST_COLORS.map((c) => (
            <button key={c} className={'fx-swatch' + (color === c ? ' active' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        <div className="modal-actions">
          {item && (
            <button className="btn btn-ghost fx-danger" onClick={() => void remove()}>
              <Trash size={16} /> {t('Удалить')}
            </button>
          )}
          <div className="grow" />
          <button className="btn btn-ghost" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn btn-primary" onClick={save}>
            {t('Сохранить')}
          </button>
        </div>
      </div>
    </div>
  );
}
