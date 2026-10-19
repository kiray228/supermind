/**
 * Напоминания о сроках целей и этапов: за неделю, накануне и в сам день (в 09:00) — с прогрессом.
 * Модуль чистый — тесты гоняют его в Node; расписание собирает tasks/sync.ts.
 */
import { addDaysYmd } from '../utils/mapTasks';
import { goalProgress, goalsDueBetween, type GoalsData, type TaskLookup } from './model';

export interface GoalReminder {
  /** ключ для id уведомления */
  key: string;
  /** день напоминания */
  day: string;
  goalId: string;
  title: string;
  body: string;
}

/** за сколько дней до срока напоминать */
export const GOAL_REMIND_DAYS = [7, 1, 0] as const;

const WHEN: Record<(typeof GOAL_REMIND_DAYS)[number], string> = { 7: 'Через неделю срок', 1: 'Завтра срок', 0: 'Сегодня срок' };

/** Напоминания, приходящиеся на дни [from, to] */
export function goalReminders(d: GoalsData | null | undefined, look: TaskLookup, from: string, to: string): GoalReminder[] {
  const out: GoalReminder[] = [];
  if (!d) return out;
  const goals = new Map(d.goals.map((g) => [g.id, g]));
  for (const due of goalsDueBetween(d, from, addDaysYmd(to, 7), look)) {
    const g = goals.get(due.goalId);
    if (!g) continue;
    const pct = goalProgress(g, look);
    // цель уже достигнута (100%), но не отмечена — напоминать о сроке незачем
    if (due.kind === 'goal' && pct >= 100) continue;
    for (const off of GOAL_REMIND_DAYS) {
      const day = addDaysYmd(due.date, -off);
      if (day < from || day > to) continue;
      const body =
        due.kind === 'goal'
          ? pct > 0
            ? `Прогресс ${pct}% — ${off ? 'ещё есть время сделать шаг' : 'отметьте, что сделано'}`
            : off
              ? 'Пора начать: выберите первый шаг'
              : 'Загляните в цель: перенести срок или отметить сделанное'
          : off
            ? 'Этап цели — отметьте шаги, когда сделаете'
            : 'Этап цели — сегодня последний день';
      out.push({ key: `goal|${due.id}|${due.date}|${off}`, day, goalId: due.goalId, title: `${due.emoji || '🎯'} ${WHEN[off]}: ${due.title}`, body });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
