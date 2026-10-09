import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Archive, ArchiveRestore, Bell, BellOff, Check, ChevronDown, ChevronRight, Flame, Minus, Pause, Pencil, Plus, Snowflake, Trash2, Trophy, X } from 'lucide-react';
import type { Habit, HabitFreq, HabitPart, PlannerData } from '../types';
import { addDaysYmd, fromYmd } from '../utils/mapTasks';
import { uid } from '../utils/tree';
import {
  activeHabits,
  bestStreak,
  cleanHabit,
  completion,
  countOn,
  currentStreak,
  doneOn,
  durationLabel,
  freqLabel,
  freqOf,
  frozenOn,
  HABIT_COLORS,
  HABIT_EMOJIS,
  heatmap,
  partOf,
  plural,
  PARTS,
  pausedOn,
  perWeekOf,
  pauseUntilLabel,
  reminderTimeOf,
  scheduledOn,
  streakText,
  targetOf,
  timeRangeLabel,
  totalDone,
  WD_SHORT_BY_DAY,
  WEEK_ORDER,
  weekCount,
  weekGoal,
} from './model';
import { HABIT_CATEGORIES, HABIT_LIBRARY, habitFromPreset } from './library';
import type { HabitCategory, HabitPreset } from './library';
import '../views/habits.css';
import './freeze.css';

type Days = PlannerData['days'];

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayTitle = (ymd: string) => {
  const d = fromYmd(ymd);
  return `${WD_SHORT_BY_DAY[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
};

/** Мелкие подписи под названием: время, длительность, частота, счётчик */
function metaParts(h: Habit, days: Days, date: string): string[] {
  const out: string[] = [];
  const t = targetOf(h);
  if (t > 1) out.push(`${h.unit ? `${h.unit}: ` : ''}${countOn(days[date], h)} / ${t}`);
  const tr = timeRangeLabel(h);
  if (tr) out.push(tr);
  else if (h.duration) out.push(durationLabel(h.duration));
  const f = freqOf(h);
  if (f === 'weekly') out.push(`${weekCount(days, h, date)} из ${weekGoal(days, h, date)} за неделю`);
  else if (f === 'weekdays') out.push(freqLabel(h));
  const fz = frozenOn(days, h, date);
  if (fz) out.unshift(fz === 'skip' ? '❄️ пропуск' : `⏸ на паузе ${pauseUntilLabel(h, date) ?? ''}`.trim());
  return out;
}

// ---------- Строка привычки в Ежедневнике ----------

export function HabitRow({
  h,
  days,
  date,
  off,
  onTap,
  onMinus,
  onOpen,
}: {
  h: Habit;
  days: Days;
  date: string;
  /** не по плану на этот день */
  off?: boolean;
  /** нажатие на кружок: отметка или +1 */
  onTap: () => void;
  /** −1 для счётчика */
  onMinus: () => void;
  onOpen: () => void;
}) {
  const on = doneOn(days, h, date);
  const t = targetOf(h);
  const count = countOn(days[date], h);
  const streak = currentStreak(days, h, date);
  const ring = t > 1 && !on;
  const meta = metaParts(h, days, date);
  return (
    <div className={`pl-habit${on ? ' on' : ''}${off ? ' off' : ''}${frozenOn(days, h, date) ? ' frozen' : ''}`} style={{ '--hc': h.color, '--p': Math.min(1, count / t) } as CSSProperties}>
      <button
        className={`pl-habit-toggle${ring ? ' ring' : ''}`}
        onClick={onTap}
        aria-pressed={on}
        aria-label={t > 1 && !on ? `${h.name}: +1` : on ? `${h.name}: снять отметку` : `${h.name}: отметить`}
        title={t > 1 && !on ? 'Нажмите, чтобы добавить +1' : undefined}
      >
        {on ? (
          <Check size={18} strokeWidth={3} />
        ) : (
          <span className="pl-habit-emoji">{h.icon ?? (t > 1 ? count : '')}</span>
        )}
      </button>
      <button className="grow pl-habit-body" onClick={onOpen} title="Статистика и настройки">
        <span className="pl-habit-name ellipsis">{h.name}</span>
        {meta.length > 0 && <span className="pl-habit-meta ellipsis">{meta.join(' · ')}</span>}
        <span className="pl-habit-week" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDaysYmd(date, i - 6);
            const sc = scheduledOn(h, d);
            const fz = frozenOn(days, h, d);
            return (
              <span
                key={d}
                className={`pl-habit-cell${doneOn(days, h, d) ? ' on' : ''}${!sc ? ' skip' : ''}${fz ? ' frozen' : ''}${d === date ? ' cur' : ''}`}
                title={`${dayTitle(d)}${fz === 'skip' ? ' — пропуск' : fz === 'pause' ? ' — пауза' : ''}`}
              />
            );
          })}
        </span>
      </button>
      {t > 1 && count > 0 && !on && (
        <button className="pl-habit-minus" onClick={onMinus} aria-label="Убавить на 1">
          <Minus size={15} />
        </button>
      )}
      <span className={`pl-streak${streak.n > 0 ? ' active' : ''}`} title={`Серия: ${streakText(streak)}`}>
        <Flame size={14} />
        {streak.n}
        {streak.unit === 'week' && <small>нед</small>}
      </span>
    </div>
  );
}

// ---------- Привычки дня, по частям дня ----------

export function HabitsToday({
  habits,
  days,
  date,
  dueIds,
  onTap,
  onMinus,
  onOpen,
}: {
  habits: Habit[];
  days: Days;
  date: string;
  dueIds: Set<string>;
  onTap: (h: Habit) => void;
  onMinus: (h: Habit) => void;
  onOpen: (h: Habit) => void;
}) {
  const [showOff, setShowOff] = useState(false);
  const due = habits.filter((h) => dueIds.has(h.id));
  const rest = habits.filter((h) => !dueIds.has(h.id));
  const groups = PARTS.map((p) => ({
    ...p,
    list: due.filter((h) => partOf(h) === p.id).sort((a, b) => (a.time && b.time ? (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) : a.time ? -1 : b.time ? 1 : 0)),
  })).filter((g) => g.list.length);
  const single = groups.length === 1 && groups[0].id === 'any';
  const row = (h: Habit, off?: boolean) => (
    <HabitRow key={h.id} h={h} days={days} date={date} off={off} onTap={() => onTap(h)} onMinus={() => onMinus(h)} onOpen={() => onOpen(h)} />
  );
  return (
    <div className="pl-habits">
      {due.length === 0 && <div className="pl-empty-line">На этот день привычек нет по плану</div>}
      {groups.map((g) => {
        const done = g.list.filter((h) => doneOn(days, h, date)).length;
        return (
          <div key={g.id} className="pl-habit-group">
            {!single && (
              <div className="pl-habit-ghead">
                <span className="pl-habit-gicon">{g.icon}</span>
                <span className="grow">{g.label}</span>
                <span className={`pl-habit-gcount${done === g.list.length ? ' full' : ''}`}>
                  {done}/{g.list.length}
                </span>
              </div>
            )}
            {g.list.map((h) => row(h))}
          </div>
        );
      })}
      {rest.length > 0 && (
        <div className="pl-habit-group">
          <button className="pl-habit-offbtn" onClick={() => setShowOff((v) => !v)} aria-expanded={showOff}>
            {showOff ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="grow">Не по плану сегодня</span>
            <span className="pl-habit-gcount">{rest.length}</span>
          </button>
          {showOff && rest.map((h) => row(h, true))}
        </div>
      )}
    </div>
  );
}

// ---------- Карточка привычки: статистика ----------

export function HabitDetail({
  h,
  days,
  today,
  onClose,
  onEdit,
  onArchive,
  onDelete,
  onToggleDay,
  freeze,
}: {
  h: Habit;
  days: Days;
  today: string;
  onClose: () => void;
  onEdit: () => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
  onToggleDay: (ymd: string) => void;
  /** заморозка серии: пропуск сегодня, пауза, возобновление */
  freeze?: { onSkip: (on: boolean) => void; onPause: () => void; onResume: () => void };
}) {
  const fzToday = frozenOn(days, h, today);
  const pauseAhead = !!h.pauses?.some((p) => p.to >= today);
  const cur = currentStreak(days, h, today);
  const best = bestStreak(days, h, today);
  const c30 = completion(days, h, today, 30);
  const total = totalDone(days, h);
  const cols = heatmap(days, h, today, 12);
  const remind = reminderTimeOf(h);
  const t = targetOf(h);
  const info = [freqLabel(h), timeRangeLabel(h) || (h.duration ? durationLabel(h.duration) : ''), t > 1 ? `цель ×${t}${h.unit ? ` (${h.unit})` : ''}` : '']
    .filter(Boolean)
    .join(' · ');
  // подписи месяцев над столбцами — там, где месяц сменился
  const monthMarks = cols.map((col, i) => {
    const m = fromYmd(col[0].ymd).getMonth();
    return i === 0 || fromYmd(cols[i - 1][0].ymd).getMonth() !== m ? MONTHS_GEN[m].slice(0, 3) : '';
  });
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal hb-modal" style={{ '--hc': h.color } as CSSProperties} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="hb-detail-head">
          <span className="hb-big-icon">{h.icon ?? '🔥'}</span>
          <div className="grow">
            <h2 className="hb-title">{h.name}</h2>
            <div className="small muted">{info}</div>
            <div className="tiny faint hb-remind">
              {remind ? <Bell size={12} /> : <BellOff size={12} />}
              {remind ? `Напоминание в ${remind}` : 'Без напоминания'}
              {h.archived && <span className="hb-tag">В архиве</span>}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X />
          </button>
        </div>

        {freeze && !h.archived && (fzToday || pauseAhead) && (
          <div className="hb-freeze">
            <span className="hb-freeze-ic" aria-hidden>
              {fzToday === 'skip' ? '❄️' : '⏸'}
            </span>
            <span className="grow">
              {fzToday === 'skip'
                ? 'Сегодня пропуск — серия не прервётся'
                : pausedOn(h, today)
                  ? `На паузе ${pauseUntilLabel(h, today) ?? ''}`
                  : `Пауза с ${dayTitle(h.pauses!.find((p) => p.to >= today)!.from).toLowerCase()}`}
            </span>
            {fzToday === 'skip' ? (
              <button className="btn btn-sm" onClick={() => freeze.onSkip(false)}>
                Отменить
              </button>
            ) : (
              <button className="btn btn-sm" onClick={freeze.onResume}>
                Возобновить
              </button>
            )}
          </div>
        )}

        <div className="hb-stats">
          <div className="hb-stat">
            <Flame size={16} className="hb-stat-ic fire" />
            <b>{cur.n}</b>
            <span>{cur.unit === 'week' ? 'нед. серия' : 'дн. серия'}</span>
          </div>
          <div className="hb-stat">
            <Trophy size={16} className="hb-stat-ic gold" />
            <b>{best.n}</b>
            <span>лучшая</span>
          </div>
          <div className="hb-stat">
            <span className="hb-pct" style={{ '--v': c30.rate } as CSSProperties} />
            <b>{Math.round(c30.rate * 100)}%</b>
            <span>за 30 дней</span>
          </div>
          <div className="hb-stat">
            <Check size={16} className="hb-stat-ic ok" />
            <b>{total}</b>
            <span>всего</span>
          </div>
        </div>

        <div className="hb-sec-title">
          <span>12 недель</span>
          <span className="tiny faint">нажмите на день, чтобы изменить отметку</span>
        </div>
        <div className="hb-heat" style={{ gridTemplateColumns: `22px repeat(${cols.length}, minmax(0, 1fr))` }}>
          <span />
          {monthMarks.map((m, i) => (
            <span key={i} className="hb-heat-month">
              {m}
            </span>
          ))}
          {Array.from({ length: 7 }, (_, r) => (
            <HeatRow key={r} r={r} cols={cols} onToggle={onToggleDay} />
          ))}
        </div>
        <div className="hb-legend tiny faint">
          <span>меньше</span>
          {[0, 0.34, 0.67, 1].map((v) => (
            <i key={v} style={{ '--lv': v } as CSSProperties} className={v === 0 ? 'zero' : ''} />
          ))}
          <span>больше</span>
          <span className="grow" />
          <i className="skip" /> <span>не по плану</span>
          {freeze && (
            <>
              <i className="frozen" /> <span>пропуск</span>
            </>
          )}
        </div>

        {freeze && !h.archived && (
          <div className="hb-actions hb-freeze-actions">
            {!fzToday && !doneOn(days, h, today) && (
              <button className="btn" onClick={() => freeze.onSkip(true)} title="Пропуск по уважительной причине — серия не прервётся">
                <Snowflake size={15} /> Пропустить сегодня
              </button>
            )}
            <button className="btn" onClick={freeze.onPause} title="Больничный, отпуск: не по плану, без напоминаний, серия не прерывается">
              <Pause size={15} /> {pausedOn(h, today) ? 'Продлить паузу…' : 'Пауза…'}
            </button>
          </div>
        )}

        <div className="hb-actions">
          <button className="btn" onClick={onEdit}>
            <Pencil size={15} /> Изменить
          </button>
          <button className="btn" onClick={() => onArchive(!h.archived)}>
            {h.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            {h.archived ? 'Вернуть' : 'В архив'}
          </button>
          <div className="grow" />
          <button className="icon-btn hb-del" onClick={onDelete} aria-label="Удалить привычку" title="Удалить">
            <Trash2 />
          </button>
        </div>
      </div>
    </div>
  );
}

function HeatRow({ r, cols, onToggle }: { r: number; cols: ReturnType<typeof heatmap>; onToggle: (ymd: string) => void }) {
  const wd = WEEK_ORDER[r];
  return (
    <>
      <span className="hb-heat-wd">{r % 2 === 0 ? WD_SHORT_BY_DAY[wd] : ''}</span>
      {cols.map((col) => {
        const c = col[r];
        const fz = c.frozen ? ` frozen ${c.frozen}` : '';
        const fzTitle = c.frozen === 'skip' ? ' — пропуск, серия сохранена' : c.frozen === 'pause' ? ' — пауза' : '';
        if (c.level === null) return <span key={c.ymd} className={`hb-cell future${fz}`} title={fz ? `${dayTitle(c.ymd)}${fzTitle}` : undefined} />;
        const cls = `hb-cell${c.level === -1 ? ' skip' : c.level === 0 ? ' zero' : ''}${fz}`;
        return (
          <button
            key={c.ymd}
            className={cls}
            style={{ '--lv': Math.max(0, c.level) } as CSSProperties}
            title={`${dayTitle(c.ymd)}${c.level === 1 ? ' — выполнено' : c.level > 0 ? ` — ${Math.round(c.level * 100)}%` : fzTitle}`}
            onClick={() => onToggle(c.ymd)}
          />
        );
      })}
    </>
  );
}

// ---------- Редактор привычки ----------

const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90];
const FREQS: { id: HabitFreq; label: string }[] = [
  { id: 'daily', label: 'Каждый день' },
  { id: 'weekdays', label: 'По дням' },
  { id: 'weekly', label: 'N в неделю' },
];

export function HabitEditor({
  habit,
  colorIndex = 0,
  onSave,
  onClose,
  onDelete,
}: {
  /** нет — новая привычка */
  habit?: Habit;
  colorIndex?: number;
  onSave: (h: Habit) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const isNew = !habit;
  const [d, setD] = useState<Habit>(
    () => habit ?? { id: uid(), name: '', color: HABIT_COLORS[colorIndex % HABIT_COLORS.length], icon: '🔥', createdAt: Date.now() },
  );
  const [partTouched, setPartTouched] = useState(!!habit?.part);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const up = (patch: Partial<Habit>) => setD((x) => ({ ...x, ...patch }));
  const freq: HabitFreq = d.freq ?? 'daily';
  const t = targetOf(d);
  /** несколько раз в день: список времён (в редакторе может быть и одно — при сохранении станет обычным временем) */
  const multi = d.times !== undefined;
  const times = d.times ?? [];
  const remindMode = d.remindOff ? 'off' : multi ? 'each' : d.remind ? 'custom' : d.time ? 'time' : 'off';
  // несколько раз в день без ручного выбора — часть дня меняется сама, ни один вариант не выделен
  const part = partTouched ? (d.part ?? 'any') : multi ? null : partOf({ time: d.time });

  const setTime = (time: string) => {
    const patch: Partial<Habit> = { time: time || undefined };
    if (!time) patch.duration = undefined;
    if (!partTouched) patch.part = undefined;
    up(patch);
  };
  const toggleDay = (wd: number) => {
    const cur = d.days ?? [];
    up({ days: cur.includes(wd) ? cur.filter((x) => x !== wd) : [...cur, wd] });
  };
  const setMulti = (on: boolean) => {
    if (on) {
      // утро и вечер — самый частый случай («таблетки утром и вечером»)
      const first = d.time || '08:00';
      up({ times: [first, first < '20:00' ? '20:00' : '22:00'], remind: undefined, remindOff: d.remindOff ?? false, unit: undefined });
    } else up({ times: undefined, target: undefined, time: times[0] || d.time });
  };
  const setSlot = (i: number, v: string) => up({ times: times.map((x, k) => (k === i ? v : x)) });
  const addSlot = () => {
    const last = times[times.length - 1] ?? '08:00';
    const [hh, mm] = last.split(':').map(Number);
    const next = `${String(Math.min(23, (hh || 0) + 4)).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}`;
    up({ times: [...times, next] });
  };
  const canSave = d.name.trim().length > 0 && !(freq === 'weekdays' && !d.days?.length);
  const save = () => {
    if (!canSave) return;
    const filled = times.filter(Boolean);
    const out: Habit = multi ? { ...d, times: filled, target: Math.max(1, filled.length), time: filled[0] } : d;
    onSave(cleanHabit({ ...out, part: partTouched ? d.part : undefined }));
  };

  return (
    <div className="modal-backdrop hb-top" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal hb-modal hb-editor" style={{ '--hc': d.color } as CSSProperties} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row">
          <h2 className="grow">{isNew ? 'Новая привычка' : 'Привычка'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X />
          </button>
        </div>

        <div className="hb-name-row">
          <button className={`hb-emoji-btn${emojiOpen ? ' open' : ''}`} onClick={() => setEmojiOpen((v) => !v)} aria-label="Выбрать иконку" title="Иконка">
            {d.icon || '🔥'}
          </button>
          <input
            className="input"
            placeholder="Название, напр. «Зарядка»"
            value={d.name}
            autoFocus={isNew}
            maxLength={80}
            onChange={(e) => up({ name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
        {emojiOpen && (
          <div className="hb-emojis">
            {HABIT_EMOJIS.map((e) => (
              <button
                key={e}
                className={e === d.icon ? 'active' : ''}
                onClick={() => {
                  up({ icon: e });
                  setEmojiOpen(false);
                }}
              >
                {e}
              </button>
            ))}
            <input
              className="hb-emoji-own"
              placeholder="Свой"
              aria-label="Свой эмодзи"
              maxLength={4}
              onChange={(e) => {
                const v = [...e.target.value.trim()].slice(0, 2).join('');
                if (v) up({ icon: v });
              }}
            />
          </div>
        )}
        <div className="pl-colors hb-colors">
          {HABIT_COLORS.map((c) => (
            <button key={c} className={`kb-swatch${c === d.color ? ' active' : ''}`} style={{ background: c }} onClick={() => up({ color: c })} aria-label={c} />
          ))}
        </div>

        <label className="label">Как часто</label>
        <div className="segmented hb-seg">
          {FREQS.map((o) => (
            <button
              key={o.id}
              className={freq === o.id ? 'active' : ''}
              onClick={() =>
                up({
                  freq: o.id === 'daily' ? undefined : o.id,
                  days: o.id === 'weekdays' ? (d.days?.length ? d.days : [1, 3, 5]) : d.days,
                  perWeek: o.id === 'weekly' ? (d.perWeek ?? 3) : d.perWeek,
                })
              }
            >
              {o.label}
            </button>
          ))}
        </div>
        {freq === 'weekdays' && (
          <div className="hb-days">
            {WEEK_ORDER.map((wd) => (
              <button key={wd} className={`hb-day${d.days?.includes(wd) ? ' active' : ''}${wd === 0 || wd === 6 ? ' we' : ''}`} onClick={() => toggleDay(wd)}>
                {WD_SHORT_BY_DAY[wd]}
              </button>
            ))}
          </div>
        )}
        {freq === 'weekly' && (
          <div className="hb-stepper-row">
            <Stepper value={perWeekOf(d)} min={1} max={6} onChange={(v) => up({ perWeek: v })} />
            <span className="muted small">{freqLabel({ ...d, freq: 'weekly', perWeek: perWeekOf(d) }).replace(/^\d+ /, '')} — в любые дни</span>
          </div>
        )}

        {!multi && <label className="label">Цель на день</label>}
        {!multi && (
        <div className="hb-stepper-row">
          <Stepper value={t} min={1} max={50} onChange={(v) => up({ target: v })} />
          {t > 1 ? (
            <input className="input hb-unit" placeholder="ед., напр. «стакан»" value={d.unit ?? ''} maxLength={20} onChange={(e) => up({ unit: e.target.value })} />
          ) : (
            <span className="muted small">простая отметка «сделано»</span>
          )}
        </div>
        )}
        {!multi && t > 1 && <div className="tiny faint hb-hint">Каждое нажатие на кружок — +1. Привычка выполнена, когда счётчик дойдёт до {t}.</div>}

        <label className="label">Время и длительность</label>
        <div className="segmented hb-seg">
          <button className={!multi ? 'active' : ''} onClick={() => multi && setMulti(false)}>
            Один раз в день
          </button>
          <button className={multi ? 'active' : ''} onClick={() => !multi && setMulti(true)}>
            Несколько раз
          </button>
        </div>
        {multi ? (
          <>
            <div className="hb-times">
              {times.map((tm, i) => (
                <span key={i} className="hb-time">
                  <input type="time" className="pl-time" aria-label={`Время ${i + 1}`} value={tm} onChange={(e) => setSlot(i, e.target.value)} />
                  {times.length > 1 && (
                    <button className="hb-clear" onClick={() => up({ times: times.filter((_, k) => k !== i) })} aria-label="Убрать время">
                      <X size={14} />
                    </button>
                  )}
                </span>
              ))}
              {times.length < 8 && (
                <button className="chip hb-add-time" onClick={addSlot}>
                  <Plus size={14} /> Ещё время
                </button>
              )}
            </div>
            <div className="tiny faint hb-hint">
              {times.filter(Boolean).length > 1
                ? `${times.filter(Boolean).length} ${plural(times.filter(Boolean).length, ['раз', 'раза', 'раз'])} в день — каждый приём отмечается отдельно, напоминание на каждое время.`
                : 'Добавьте второе время — например, утром и вечером.'}
            </div>
          </>
        ) : (
        <div className="hb-time-row">
          <span className="hb-time">
            <input type="time" className="pl-time" aria-label="Время" value={d.time ?? ''} onChange={(e) => setTime(e.target.value)} />
            {d.time && (
              <button className="hb-clear" onClick={() => setTime('')} aria-label="Без времени">
                <X size={14} />
              </button>
            )}
          </span>
          {!d.time && <span className="tiny faint">не обязательно</span>}
        </div>
        )}
        <div className="hb-chips">
          {DURATIONS.map((m) => (
            <button key={m} className={`chip${d.duration === m ? ' active' : ''}`} onClick={() => up({ duration: d.duration === m ? undefined : m })}>
              {durationLabel(m)}
            </button>
          ))}
        </div>

        <label className="label">Часть дня</label>
        <div className="hb-chips">
          {PARTS.map((p) => (
            <button
              key={p.id}
              className={`chip${part === p.id ? ' active' : ''}`}
              onClick={() => {
                setPartTouched(true);
                up({ part: p.id as HabitPart });
              }}
            >
              {p.icon} {p.label}
            </button>
          ))}
        </div>
        {!partTouched && multi && times.length > 1 && <div className="tiny faint hb-hint">Привычка будет в той части дня, когда пора следующий раз: утром — в «Утро», после отметки — в «Вечер».</div>}
        {!partTouched && !multi && d.time && <div className="tiny faint hb-hint">Определяется по времени — можно выбрать вручную.</div>}

        <label className="label">Напоминание</label>
        {multi ? (
          <div className="segmented hb-seg">
            <button className={remindMode === 'off' ? 'active' : ''} onClick={() => up({ remindOff: true })}>
              Нет
            </button>
            <button className={remindMode === 'each' ? 'active' : ''} onClick={() => up({ remindOff: false })}>
              В каждое время
            </button>
          </div>
        ) : (
        <div className="segmented hb-seg">
          <button className={remindMode === 'off' ? 'active' : ''} onClick={() => up({ remindOff: true, remind: undefined })}>
            Нет
          </button>
          <button
            className={remindMode === 'time' ? 'active' : ''}
            disabled={!d.time}
            title={d.time ? undefined : 'Сначала укажите время привычки'}
            onClick={() => up({ remindOff: false, remind: undefined })}
          >
            {d.time ? `В ${d.time}` : 'Во время'}
          </button>
          <button className={remindMode === 'custom' ? 'active' : ''} onClick={() => up({ remindOff: false, remind: d.remind || (d.time ?? '09:00') })}>
            Своё время
          </button>
        </div>
        )}
        {remindMode === 'custom' && (
          <div className="hb-time-row">
            <span className="hb-time">
              <input type="time" className="pl-time" aria-label="Время напоминания" value={d.remind ?? ''} onChange={(e) => up({ remind: e.target.value || undefined })} />
            </span>
          </div>
        )}
        <div className="tiny faint hb-hint">
          {remindMode === 'off'
            ? 'Напоминаний не будет.'
            : remindMode === 'each'
              ? `Напомним в ${times.filter(Boolean).join(', ') || '…'}, если этот приём ещё не отмечен.`
              : `Напомним в ${d.remind || d.time}${freq === 'daily' ? ' каждый день' : freq === 'weekdays' ? ' в выбранные дни' : ', пока цель недели не выполнена'}, если привычка ещё не отмечена.`}
        </div>

        <div className="modal-actions hb-editor-actions">
          {onDelete && (
            <button className="btn btn-ghost btn-danger" onClick={onDelete}>
              <Trash2 size={15} /> Удалить
            </button>
          )}
          <div className="grow" />
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!canSave}>
            {isNew ? 'Добавить' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="hb-stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Меньше">
        <Minus size={16} />
      </button>
      <b>{value}</b>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Больше">
        <Plus size={16} />
      </button>
    </span>
  );
}

// ---------- Мои привычки и библиотека ----------

export function HabitsManager({
  habits,
  initialTab = 'mine',
  onEdit,
  onCreate,
  onAddPreset,
  onRestore,
  onClose,
}: {
  habits: Habit[];
  initialTab?: 'mine' | 'library';
  onEdit: (h: Habit) => void;
  onCreate: () => void;
  onAddPreset: (h: Habit) => void;
  onRestore: (h: Habit) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'mine' | 'library'>(initialTab);
  const [cat, setCat] = useState<HabitCategory | 'all'>('all');
  const [archOpen, setArchOpen] = useState(false);
  const active = activeHabits(habits);
  const archived = habits.filter((h) => h.archived && !h.deleted);
  const names = useMemo(() => new Set(active.map((h) => h.name.trim().toLowerCase())), [active]);
  const presets = HABIT_LIBRARY.filter((p) => cat === 'all' || p.cat === cat);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal hb-modal hb-manager" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row">
          <h2 className="grow">Привычки</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X />
          </button>
        </div>
        <div className="segmented hb-seg hb-tabs">
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
            Мои{active.length ? ` · ${active.length}` : ''}
          </button>
          <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
            Библиотека привычек
          </button>
        </div>

        {tab === 'mine' ? (
          <>
            {active.length === 0 ? (
              <div className="hb-empty">
                <div className="hb-empty-ic">🌱</div>
                <div>Пока нет привычек</div>
                <div className="small faint">Создайте свою или выберите готовую в библиотеке</div>
                <button className="btn btn-sm" onClick={() => setTab('library')}>
                  Открыть библиотеку
                </button>
              </div>
            ) : (
              <div className="hb-list">
                {active.map((h) => (
                  <button key={h.id} className="hb-item" style={{ '--hc': h.color } as CSSProperties} onClick={() => onEdit(h)}>
                    <span className="hb-item-ic">{h.icon ?? '🔥'}</span>
                    <span className="grow hb-item-body">
                      <span className="hb-item-name ellipsis">{h.name}</span>
                      <span className="hb-item-meta ellipsis">
                        {[freqLabel(h), timeRangeLabel(h), targetOf(h) > 1 ? `×${targetOf(h)}${h.unit ? ` (${h.unit})` : ''}` : ''].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {reminderTimeOf(h) && <Bell size={14} className="faint" />}
                    <ChevronRight size={18} className="faint" />
                  </button>
                ))}
              </div>
            )}
            <button className="btn btn-primary btn-block hb-new" onClick={onCreate}>
              <Plus size={16} /> Новая привычка
            </button>
            {archived.length > 0 && (
              <div className="hb-arch">
                <button className="pl-habit-offbtn" onClick={() => setArchOpen((v) => !v)} aria-expanded={archOpen}>
                  {archOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Archive size={15} />
                  <span className="grow">Архив</span>
                  <span className="pl-habit-gcount">{archived.length}</span>
                </button>
                {archOpen &&
                  archived.map((h) => (
                    <div key={h.id} className="hb-item hb-item-arch">
                      <span className="hb-item-ic">{h.icon ?? '🔥'}</span>
                      <button className="grow hb-item-body hb-plain" onClick={() => onEdit(h)}>
                        <span className="hb-item-name ellipsis">{h.name}</span>
                        <span className="hb-item-meta">история сохранена</span>
                      </button>
                      <button className="btn btn-sm" onClick={() => onRestore(h)}>
                        <ArchiveRestore size={14} /> Вернуть
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="hb-cats">
              <button className={`chip${cat === 'all' ? ' active' : ''}`} onClick={() => setCat('all')}>
                Все
              </button>
              {HABIT_CATEGORIES.map((c) => (
                <button key={c.id} className={`chip${cat === c.id ? ' active' : ''}`} onClick={() => setCat(c.id)}>
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
            <div className="hb-lib">
              {(cat === 'all' ? HABIT_CATEGORIES : HABIT_CATEGORIES.filter((c) => c.id === cat)).map((c) => (
                <div key={c.id} className="hb-lib-group">
                  {cat === 'all' && (
                    <div className="hb-lib-cat">
                      {c.icon} {c.label}
                    </div>
                  )}
                  {presets
                    .filter((p) => p.cat === c.id)
                    .map((p) => (
                      <PresetRow key={p.name} p={p} added={names.has(p.name.toLowerCase())} onAdd={() => onAddPreset(habitFromPreset(p))} />
                    ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PresetRow({ p, added, onAdd }: { p: HabitPreset; added: boolean; onAdd: () => void }) {
  const h = { ...p, id: '', color: '' } as Habit;
  const meta = [freqLabel(h), timeRangeLabel(h) || (p.duration ? durationLabel(p.duration) : ''), p.target ? `×${p.target}` : ''].filter(Boolean).join(' · ');
  return (
    <div className={`hb-preset${added ? ' added' : ''}`}>
      <span className="hb-item-ic">{p.icon}</span>
      <span className="grow hb-item-body">
        <span className="hb-item-name ellipsis">{p.name}</span>
        <span className="hb-item-meta">{p.why}</span>
        <span className="hb-item-meta faint ellipsis">{meta}</span>
      </span>
      <button className={`hb-add${added ? ' done' : ''}`} onClick={onAdd} disabled={added} aria-label={added ? 'Уже добавлена' : `Добавить «${p.name}»`}>
        {added ? <Check size={18} strokeWidth={3} /> : <Plus size={18} />}
      </button>
    </div>
  );
}
