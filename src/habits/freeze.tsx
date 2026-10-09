/**
 * Заморозка серии: лист действий привычки (пропуск дня, пауза, возобновление) и лист «Пауза…».
 * Сами данные меняет страница — через FreezeHandlers (freezeActions.ts).
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Habit, PlannerData } from '../types';
import { addDaysYmd } from '../utils/mapTasks';
import { doneOn, frozenOn, pausedOn } from './model';
import { freezeStatus, hasPauseAhead, shortDay } from './freezeActions';
import type { FreezeHandlers } from './freezeActions';
import '../ui/dialogs.css';
import './freeze.css';

type Days = PlannerData['days'];

export function FreezeSheet({
  h,
  days,
  date,
  today,
  initial = 'menu',
  handlers,
  onOpen,
  onDone,
  onDelete,
  onClose,
}: {
  h: Habit;
  days: Days;
  /** день, для которого открыт лист (выбранный в разделе) */
  date: string;
  today: string;
  initial?: 'menu' | 'pause';
  handlers: FreezeHandlers;
  /** «Статистика и настройки»; нет — пункта нет */
  onOpen?: () => void;
  /** «Всё-таки выполнено» для замороженного дня; нет — пункта нет */
  onDone?: () => void;
  /** «Удалить привычку»; нет — пункта нет */
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState(initial);
  const [all, setAll] = useState(false);
  const [until, setUntil] = useState('');
  const done = doneOn(days, h, date);
  const fz = frozenOn(days, h, date);
  const isToday = date === today;
  // пауза — с выбранного дня (прошедший день — задним числом, «болел»), но не раньше чем за 60 дней
  const from = date < addDaysYmd(today, -60) ? today : date;
  const act = (fn: () => void) => {
    fn();
    onClose();
  };
  const pause = (to: string) => act(() => handlers.pause(all ? 'all' : h, from, to));

  const backdrop = (children: ReactNode, label: string) => (
    <div className="modal-backdrop dlg-as-backdrop fz-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg-as fz-sheet" role="dialog" aria-label={label} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        {children}
        <button className="dlg-as-btn dlg-as-cancel" onClick={stage === 'pause' && initial === 'menu' ? () => setStage('menu') : onClose}>
          {stage === 'pause' && initial === 'menu' ? 'Назад' : 'Отмена'}
        </button>
      </div>
    </div>
  );

  if (stage === 'pause') {
    const minUntil = addDaysYmd(from, 1);
    return backdrop(
      <div className="dlg-as-group">
        <div className="dlg-as-head">
          <div className="dlg-as-title">⏸ Пауза{all ? ' для всех привычек' : ` · ${h.icon ?? ''} ${h.name}`.replace(/\s+/g, ' ')}</div>
          <div className="dlg-as-msg">
            Больничный, отпуск, поездка: в эти дни {all ? 'привычки не напоминают' : 'привычка не напоминает'}, не считается пропущенной, а серия не прерывается.
            {from !== today && ` Начало — ${shortDay(from)}.`}
          </div>
        </div>
        <button className="dlg-as-btn" onClick={() => pause(from)}>
          {from === today ? 'До завтра' : 'Только этот день'}
        </button>
        <button className="dlg-as-btn" onClick={() => pause(addDaysYmd(from, 2))}>
          3 дня
        </button>
        <button className="dlg-as-btn" onClick={() => pause(addDaysYmd(from, 6))}>
          Неделя
        </button>
        <div className="fz-row">
          <span className="grow">До даты</span>
          <input
            className="input fz-date"
            type="date"
            min={minUntil}
            value={until}
            aria-label="Возобновить с даты"
            onChange={(e) => setUntil(e.target.value)}
          />
        </div>
        {until && until >= minUntil && (
          <button className="dlg-as-btn fz-strong" onClick={() => pause(addDaysYmd(until, -1))}>
            Пауза до {shortDay(until)}
          </button>
        )}
        <label className="fz-row fz-switch-row">
          <span className="grow">Для всех привычек</span>
          <input type="checkbox" className="switch" checked={all} onChange={(e) => setAll(e.target.checked)} />
        </label>
      </div>,
      'Пауза',
    );
  }

  const status = freezeStatus(days, h, date);
  const ahead = hasPauseAhead(h, today);
  return backdrop(
    <div className="dlg-as-group">
      <div className="dlg-as-head">
        <div className="dlg-as-title">
          {h.icon ?? '🔥'} {h.name}
        </div>
        <div className="dlg-as-msg">{status ?? (isToday ? 'Сегодня' : shortDay(date))}</div>
      </div>
      {fz === 'skip' ? (
        <button className="dlg-as-btn" onClick={() => act(() => handlers.skip(h, date, false))}>
          Отменить пропуск
        </button>
      ) : (
        !done &&
        !fz && (
          <button className="dlg-as-btn" onClick={() => act(() => handlers.skip(h, date, true))}>
            ❄️ Пропустить {isToday ? 'сегодня' : 'этот день'} (не ломая серию)
          </button>
        )
      )}
      {fz && onDone && date <= today && (
        <button className="dlg-as-btn" onClick={() => act(onDone)}>
          ✓ Всё-таки выполнено
        </button>
      )}
      {ahead && (
        <button className="dlg-as-btn" onClick={() => act(() => handlers.resume(h))}>
          ▶︎ Возобновить
        </button>
      )}
      <button className="dlg-as-btn" onClick={() => setStage('pause')}>
        ⏸ {pausedOn(h, date) ? 'Продлить паузу…' : 'Пауза…'}
      </button>
      {onOpen && (
        <button className="dlg-as-btn" onClick={() => act(onOpen)}>
          Статистика и настройки
        </button>
      )}
      {onDelete && (
        <button className="dlg-as-btn danger" onClick={() => act(onDelete)}>
          Удалить привычку
        </button>
      )}
    </div>,
    h.name,
  );
}
