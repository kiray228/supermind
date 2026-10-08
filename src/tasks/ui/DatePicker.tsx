import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CalendarClock, ChevronLeft, ChevronRight, Clock, Plus, Repeat, Sun, Sunrise, CalendarX2, X, CalendarRange } from 'lucide-react';
import { addDaysYmd, fromYmd, todayYmd, toYmd } from '../../utils/mapTasks';
import {
  ALLDAY_REMINDER_OPTIONS,
  allDayOffset,
  durationLabel,
  MONTHS,
  mondayOf,
  pinRule,
  repeatLabel,
  reminderLabel,
  TIMED_REMINDER_OPTIONS,
  WD_SHORT,
  type RepeatRule,
  type TaskItem,
} from '../model';
import { tasksData } from '../store';

export type When = Pick<TaskItem, 'date' | 'time' | 'duration' | 'reminders' | 'repeat'>;

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

/** Выбор даты, времени, длительности, напоминаний и повтора (как в TickTick) */
export function DatePicker({ value, onDone, onClose }: { value: When; onDone: (v: When) => void; onClose: () => void }) {
  const [v, setV] = useState<When>(() => ({ ...value, reminders: [...(value.reminders ?? [])] }));
  const [customRepeat, setCustomRepeat] = useState(false);
  const [addRem, setAddRem] = useState(false);
  const today = todayYmd();
  const prefs = tasksData()?.prefs;

  const setDate = (date: string | undefined) =>
    setV((x) => {
      const n = { ...x, date };
      if (date && !x.date && !x.reminders.length) n.reminders = [...((x.time ? prefs?.timedReminders : prefs?.allDayReminders) ?? [])];
      if (!date) n.repeat = undefined;
      return n;
    });
  const setTime = (time: string | undefined) =>
    setV((x) => {
      const n: When = { ...x, time, date: x.date ?? today };
      // при смене «весь день» ↔ «со временем» напоминания меняются на подходящие по умолчанию
      if (!!time !== !!x.time) n.reminders = [...((time ? prefs?.timedReminders : prefs?.allDayReminders) ?? [])];
      if (!time) n.duration = undefined;
      return n;
    });

  const timed = !!v.time;
  const remOptions = timed ? TIMED_REMINDER_OPTIONS : ALLDAY_REMINDER_OPTIONS;
  const toggleRem = (off: number) => setV((x) => ({ ...x, reminders: x.reminders.includes(off) ? x.reminders.filter((r) => r !== off) : [...x.reminders, off].sort((a, b) => a - b) }));

  const base = v.date ?? today;
  const wd = fromYmd(base).getDay();
  const presets: { label: string; rule: RepeatRule | undefined }[] = [
    { label: 'Не повторять', rule: undefined },
    { label: 'Каждый день', rule: { freq: 'daily', interval: 1 } },
    { label: 'По будням', rule: { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] } },
    { label: `Каждую неделю (${WD_SHORT[wd].toLowerCase()})`, rule: { freq: 'weekly', interval: 1, weekdays: [wd] } },
    { label: `Каждый месяц (${fromYmd(base).getDate()} число)`, rule: { freq: 'monthly', interval: 1 } },
    { label: 'Каждый год', rule: { freq: 'yearly', interval: 1 } },
  ];
  // сохранённое правило «закреплено» (число, месяц) — сравниваем закреплённые версии, порядок полей не важен
  const sig = (r: RepeatRule | undefined) => (r ? JSON.stringify(Object.entries(pinRule(r, base)).sort(([a], [b]) => a.localeCompare(b))) : 'null');
  const presetIdx = presets.findIndex((p) => sig(p.rule) === sig(v.repeat));

  // в body: окно не должно зависеть от родителя (стекло и анимации «запирают» position: fixed)
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal dp-modal">
        <div className="dp-quick">
          <button className={`dp-q${v.date === today ? ' on' : ''}`} onClick={() => setDate(today)}>
            <Sun /> Сегодня
          </button>
          <button className={`dp-q${v.date === addDaysYmd(today, 1) ? ' on' : ''}`} onClick={() => setDate(addDaysYmd(today, 1))}>
            <Sunrise /> Завтра
          </button>
          <button className={`dp-q${v.date === addDaysYmd(mondayOf(today), 7) ? ' on' : ''}`} onClick={() => setDate(addDaysYmd(mondayOf(today), 7))}>
            <CalendarRange /> След. пн
          </button>
          <button className={`dp-q${!v.date ? ' on' : ''}`} onClick={() => setDate(undefined)}>
            <CalendarX2 /> Без даты
          </button>
        </div>

        <MiniMonth selected={v.date} onPick={setDate} />

        <div className="dp-rows">
          <div className="dp-row">
            <Clock className="dp-ico" />
            <span className="grow">Время</span>
            {v.time ? (
              <>
                <input type="time" className="dp-time" value={v.time} onChange={(e) => setTime(e.target.value || undefined)} />
                <button className="icon-btn dp-x" onClick={() => setTime(undefined)} aria-label="Без времени">
                  <X />
                </button>
              </>
            ) : (
              <button className="btn btn-sm" onClick={() => setTime(nextHalfHour(v.date ?? today))}>
                Весь день · указать
              </button>
            )}
          </div>
          {v.time && (
            <div className="dp-chips">
              <span className="tiny muted">Длительность:</span>
              {DURATIONS.map((d) => (
                <button key={d} className={`chip${v.duration === d ? ' active' : ''}`} onClick={() => setV((x) => ({ ...x, duration: x.duration === d ? undefined : d }))}>
                  {durationLabel(d)}
                </button>
              ))}
            </div>
          )}

          <div className="dp-row">
            <Bell className="dp-ico" />
            <span className="grow">Напоминания</span>
            <button className="icon-btn" onClick={() => setAddRem(!addRem)} aria-label="Добавить напоминание">
              <Plus />
            </button>
          </div>
          <div className="dp-chips">
            {v.reminders.length === 0 && <span className="tiny faint">Нет напоминаний</span>}
            {v.reminders.map((r) => (
              <span key={r} className="chip active">
                {reminderLabel(r, timed)}
                <button className="dp-chip-x" onClick={() => toggleRem(r)} aria-label="Убрать">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          {addRem && (
            <div className="dp-rem-pick">
              {remOptions.map((o) => (
                <button key={o.v} className={`chip${v.reminders.includes(o.v) ? ' active' : ''}`} onClick={() => toggleRem(o.v)}>
                  {o.label}
                </button>
              ))}
              <CustomReminder timed={timed} onAdd={(off) => !v.reminders.includes(off) && toggleRem(off)} />
            </div>
          )}

          <div className="dp-row">
            <Repeat className="dp-ico" />
            <span className="grow">Повтор</span>
            <select
              className="select dp-select"
              value={customRepeat || (presetIdx < 0 && v.repeat) ? 'custom' : String(presetIdx)}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setCustomRepeat(true);
                  setV((x) => ({ ...x, date: x.date ?? today, repeat: x.repeat ?? { freq: 'weekly', interval: 1, weekdays: [wd] } }));
                } else {
                  setCustomRepeat(false);
                  const rule = presets[Number(e.target.value)].rule;
                  setV((x) => ({ ...x, date: x.date ?? (rule ? today : undefined), repeat: rule }));
                }
              }}
            >
              {presets.map((p, i) => (
                <option key={i} value={i}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Настроить…</option>
            </select>
          </div>
          {v.repeat && (presetIdx < 0 || customRepeat) && <RepeatEditor rule={v.repeat} date={base} onChange={(repeat) => setV((x) => ({ ...x, repeat }))} />}
          {v.repeat && (presetIdx < 0 || customRepeat) && <div className="tiny muted dp-rep-sum">{repeatLabel(v.repeat)}</div>}
        </div>

        <div className="modal-actions">
          <button
            className="btn btn-ghost"
            onClick={() => onDone({ date: undefined, time: undefined, duration: undefined, reminders: [], repeat: undefined })}
          >
            Очистить
          </button>
          <div className="grow" />
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => onDone(v)}>
            Готово
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function nextHalfHour(date: string): string {
  const now = new Date();
  if (date !== toYmd(now)) return '09:00';
  const m = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30;
  return m >= 1440 ? '23:30' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function CustomReminder({ timed, onAdd }: { timed: boolean; onAdd: (off: number) => void }) {
  const [n, setN] = useState(timed ? 20 : 1);
  const [unit, setUnit] = useState<'min' | 'hour' | 'day'>('min');
  const [time, setTime] = useState('09:00');
  return (
    <div className="dp-custom-rem">
      <span className="tiny muted">Своё:</span>
      <span className="tiny">за</span>
      <input className="input dp-num" type="number" min={0} max={999} value={n} onChange={(e) => setN(Math.max(0, Number(e.target.value) || 0))} />
      {timed ? (
        <select className="select dp-unit" value={unit} onChange={(e) => setUnit(e.target.value as 'min')}>
          <option value="min">мин</option>
          <option value="hour">ч</option>
          <option value="day">дн</option>
        </select>
      ) : (
        <>
          <span className="tiny">дн в</span>
          <input className="dp-time" type="time" value={time} onChange={(e) => setTime(e.target.value || '09:00')} />
        </>
      )}
      <button className="btn btn-sm" onClick={() => onAdd(timed ? -n * (unit === 'min' ? 1 : unit === 'hour' ? 60 : 1440) : allDayOffset(n, time))}>
        Добавить
      </button>
    </div>
  );
}

function RepeatEditor({ rule, date, onChange }: { rule: RepeatRule; date: string; onChange: (r: RepeatRule) => void }) {
  const set = (p: Partial<RepeatRule>) => {
    const n: RepeatRule = { ...rule, ...p };
    for (const k of Object.keys(n) as (keyof RepeatRule)[]) if (n[k] === undefined) delete n[k];
    onChange(n);
  };
  const d = fromYmd(date);
  const nth = Math.ceil(d.getDate() / 7);
  const isLastWeek = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getMonth() !== d.getMonth();
  const end = rule.count ? 'count' : rule.until ? 'until' : 'never';
  return (
    <div className="dp-rep card">
      <div className="row">
        <span className="small">Каждые</span>
        <input className="input dp-num" type="number" min={1} max={99} value={rule.interval} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} />
        <select
          className="select"
          value={rule.freq}
          onChange={(e) => {
            const freq = e.target.value as RepeatRule['freq'];
            set({ freq, weekdays: freq === 'weekly' ? [d.getDay()] : undefined, monthWeek: undefined, lastDay: undefined });
          }}
        >
          <option value="daily">дн.</option>
          <option value="weekly">нед.</option>
          <option value="monthly">мес.</option>
          <option value="yearly">лет</option>
        </select>
      </div>
      {rule.freq === 'weekly' && (
        <div className="dp-wds">
          {[1, 2, 3, 4, 5, 6, 0].map((w) => {
            const on = rule.weekdays?.includes(w);
            return (
              <button
                key={w}
                className={`dp-wd${on ? ' on' : ''}`}
                onClick={() => {
                  const cur = rule.weekdays ?? [];
                  const next = on ? cur.filter((x) => x !== w) : [...cur, w];
                  set({ weekdays: next.length ? next : [w] });
                }}
              >
                {WD_SHORT[w]}
              </button>
            );
          })}
        </div>
      )}
      {rule.freq === 'monthly' && (
        <select
          className="select"
          value={rule.monthWeek ? 'nth' : rule.lastDay ? 'last' : 'day'}
          onChange={(e) => {
            const m = e.target.value;
            if (m === 'nth') set({ monthWeek: { n: isLastWeek && nth >= 4 ? -1 : nth, wd: d.getDay() }, lastDay: undefined });
            else if (m === 'last') set({ lastDay: true, monthWeek: undefined });
            else set({ lastDay: undefined, monthWeek: undefined });
          }}
        >
          <option value="day">{d.getDate()}-го числа</option>
          <option value="nth">
            {isLastWeek && nth >= 4 ? 'В последний' : `В ${nth}-й`} {WD_SHORT[d.getDay()].toLowerCase()} месяца
          </option>
          <option value="last">В последний день месяца</option>
        </select>
      )}
      <div className="row">
        <span className="small">Окончание</span>
        <select
          className="select grow"
          value={end}
          onChange={(e) => {
            const m = e.target.value;
            if (m === 'never') set({ count: undefined, until: undefined });
            else if (m === 'count') set({ count: 10, until: undefined });
            else set({ until: addDaysYmd(date, 30), count: undefined });
          }}
        >
          <option value="never">Никогда</option>
          <option value="until">До даты</option>
          <option value="count">После N повторов</option>
        </select>
      </div>
      {end === 'until' && <input className="input" type="date" value={rule.until} onChange={(e) => set({ until: e.target.value || undefined })} />}
      {end === 'count' && (
        <div className="row">
          <input className="input dp-num" type="number" min={1} max={999} value={rule.count} onChange={(e) => set({ count: Math.max(1, Number(e.target.value) || 1) })} />
          <span className="small">раз</span>
        </div>
      )}
      <label className="row small dp-check">
        <input type="checkbox" checked={!!rule.fromCompletion} onChange={(e) => set({ fromCompletion: e.target.checked || undefined })} />
        Считать от даты выполнения
      </label>
    </div>
  );
}

/** Маленький календарь месяца */
export function MiniMonth({ selected, onPick, marks }: { selected?: string; onPick: (d: string) => void; marks?: Set<string> }) {
  const today = todayYmd();
  const s = fromYmd(selected ?? today);
  const [view, setView] = useState({ y: s.getFullYear(), m: s.getMonth() });
  const first = toYmd(new Date(view.y, view.m, 1));
  const start = mondayOf(first);
  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const weeks = Math.ceil((lead + new Date(view.y, view.m + 1, 0).getDate()) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDaysYmd(start, i));
  const shift = (n: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  return (
    <div className="mm">
      <div className="mm-head">
        <CalendarClock size={16} className="faint" />
        <b className="grow">
          {MONTHS[view.m]} <span className="faint">{view.y}</span>
        </b>
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Предыдущий месяц">
          <ChevronLeft />
        </button>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Следующий месяц">
          <ChevronRight />
        </button>
      </div>
      <div className="mm-grid">
        {[1, 2, 3, 4, 5, 6, 0].map((w) => (
          <span key={w} className="mm-wd">
            {WD_SHORT[w]}
          </span>
        ))}
        {cells.map((d) => (
          <button
            key={d}
            className={`mm-day${fromYmd(d).getMonth() !== view.m ? ' out' : ''}${d === today ? ' today' : ''}${d === selected ? ' sel' : ''}${d < today ? ' past' : ''}`}
            onClick={() => onPick(d)}
          >
            {fromYmd(d).getDate()}
            {marks?.has(d) && <i />}
          </button>
        ))}
      </div>
    </div>
  );
}
