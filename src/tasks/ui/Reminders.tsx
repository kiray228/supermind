import { AlarmClock, BellRing, X } from 'lucide-react';
import { dismissReminder, reminderAction, useReminders } from '../sync';
import { t } from '../../i18n/index';
import './tasks.css';

/** Напоминания, сработавшие, пока приложение открыто (веб-версия) */
export function ReminderStack() {
  const items = useReminders((s) => s.items);
  if (!items.length) return null;
  return (
    <div className="rm-stack" role="alert">
      {items.slice(-3).map((r) => (
        <div key={r.key} className={`rm-card${r.alarm ? ' rm-alarm' : ''}`}>
          <div className="rm-head">
            <span className="rm-ico">{r.alarm ? <AlarmClock size={18} /> : <BellRing size={18} />}</span>
            <div className="grow">
              <div className="rm-title">{r.title}</div>
              {r.body && <div className="small muted">{r.body}</div>}
            </div>
            <button className="icon-btn" onClick={() => dismissReminder(r.key)} aria-label={t('Закрыть')}>
              <X />
            </button>
          </div>
          <div className="rm-actions">
            {r.alarm && (
              <button className="btn btn-sm" onClick={() => dismissReminder(r.key)}>
                {t('Выключить')}
              </button>
            )}
            {r.taskId && (
              <button className="btn btn-sm" onClick={() => reminderAction(r, 'snooze')}>
                {t('Отложить 10 мин')}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => reminderAction(r, 'open')}>
              {t('Открыть')}
            </button>
            {(r.taskId || r.habitId) && (
              <button className="btn btn-sm btn-primary" onClick={() => reminderAction(r, 'done')}>
                {r.habitId ? t('Отметить') : t('Выполнено')}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
