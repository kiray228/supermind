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
import { t } from '../i18n/index';
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
          {stage === 'pause' && initial === 'menu' ? t('Назад') : t('Отмена')}
        </button>
      </div>
    </div>
  );

  if (stage === 'pause') {
    const minUntil = addDaysYmd(from, 1);
    return backdrop(
      <div className="dlg-as-group">
        <div className="dlg-as-head">
          <div className="dlg-as-title">{all ? t('⏸ Пауза для всех привычек') : `${t('⏸ Пауза')} · ${h.icon ?? ''} ${h.name}`.replace(/\s+/g, ' ')}</div>
          <div className="dlg-as-msg">
            {all
              ? t('Больничный, отпуск, поездка: в эти дни привычки не напоминают, не считаются пропущенными, а серия не прерывается.')
              : t('Больничный, отпуск, поездка: в эти дни привычка не напоминает, не считается пропущенной, а серия не прерывается.')}
            {from !== today && t(' Начало — {day}.', { day: shortDay(from) })}
          </div>
        </div>
        <button className="dlg-as-btn" onClick={() => pause(from)}>
          {from === today ? t('До завтра') : t('Только этот день')}
        </button>
        <button className="dlg-as-btn" onClick={() => pause(addDaysYmd(from, 2))}>
          {t('3 дня')}
        </button>
        <button className="dlg-as-btn" onClick={() => pause(addDaysYmd(from, 6))}>
          {t('Неделя')}
        </button>
        <div className="fz-row">
          <span className="grow">{t('До даты')}</span>
          <input
            className="input fz-date"
            type="date"
            min={minUntil}
            value={until}
            aria-label={t('Возобновить с даты')}
            onChange={(e) => setUntil(e.target.value)}
          />
        </div>
        {until && until >= minUntil && (
          <button className="dlg-as-btn fz-strong" onClick={() => pause(addDaysYmd(until, -1))}>
            {t('Пауза до {day}', { day: shortDay(until) })}
          </button>
        )}
        <label className="fz-row fz-switch-row">
          <span className="grow">{t('Для всех привычек')}</span>
          <input type="checkbox" className="switch" checked={all} onChange={(e) => setAll(e.target.checked)} />
        </label>
      </div>,
      t('Пауза'),
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
        <div className="dlg-as-msg">{status ?? (isToday ? t('Сегодня') : shortDay(date))}</div>
      </div>
      {fz === 'skip' ? (
        <button className="dlg-as-btn" onClick={() => act(() => handlers.skip(h, date, false))}>
          {t('Отменить пропуск')}
        </button>
      ) : (
        !done &&
        !fz && (
          <button className="dlg-as-btn" onClick={() => act(() => handlers.skip(h, date, true))}>
            {isToday ? t('❄️ Пропустить сегодня (не ломая серию)') : t('❄️ Пропустить этот день (не ломая серию)')}
          </button>
        )
      )}
      {fz && onDone && date <= today && (
        <button className="dlg-as-btn" onClick={() => act(onDone)}>
          {t('✓ Всё-таки выполнено')}
        </button>
      )}
      {ahead && (
        <button className="dlg-as-btn" onClick={() => act(() => handlers.resume(h))}>
          {t('▶︎ Возобновить')}
        </button>
      )}
      <button className="dlg-as-btn" onClick={() => setStage('pause')}>
        ⏸ {pausedOn(h, date) ? t('Продлить паузу…') : t('Пауза…')}
      </button>
      {onOpen && (
        <button className="dlg-as-btn" onClick={() => act(onOpen)}>
          {t('Статистика и настройки')}
        </button>
      )}
      {onDelete && (
        <button className="dlg-as-btn danger" onClick={() => act(onDelete)}>
          {t('Удалить привычку')}
        </button>
      )}
    </div>,
    h.name,
  );
}
