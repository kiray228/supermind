import { BellRing, X } from 'lucide-react';
import { dismissReminder, reminderAction, useReminders } from '../sync';
import './tasks.css';

/** Напоминания, сработавшие, пока приложение открыто (веб-версия) */
export function ReminderStack() {
  const items = useReminders((s) => s.items);
  if (!items.length) return null;
  return (
    <div className="rm-stack" role="alert">
      {items.slice(-3).map((r) => (
        <div key={r.key} className="rm-card">
          <div className="rm-head">
            <span className="rm-ico">
              <BellRing size={18} />
            </span>
            <div className="grow">
              <div className="rm-title">{r.title}</div>
              {r.body && <div className="small muted">{r.body}</div>}
            </div>
            <button className="icon-btn" onClick={() => dismissReminder(r.key)} aria-label="Закрыть">
              <X />
            </button>
          </div>
          <div className="rm-actions">
            {r.taskId && (
              <button className="btn btn-sm" onClick={() => reminderAction(r, 'snooze')}>
                Отложить 10 мин
              </button>
            )}
            <button className="btn btn-sm" onClick={() => reminderAction(r, 'open')}>
              Открыть
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => reminderAction(r, 'done')}>
              {r.habitId ? 'Отметить' : 'Выполнено'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
