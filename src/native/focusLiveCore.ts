/** Таймер фокуса → состояние для экрана блокировки (без зависимостей — проверяется тестами) */
import { t } from '../i18n/index.ts';
import type { FocusState } from '../tasks/focusTimer';

export interface LiveState {
  running: boolean;
  stopwatch: boolean;
  phase: FocusState['phase'];
  title: string;
  task?: string;
  /** помодоро идёт: когда закончится фаза, мс */
  endAt?: number;
  /** секундомер идёт: момент «нуля», мс */
  start?: number;
  /** на паузе: осталось (помодоро) или прошло (секундомер), мс */
  left?: number;
  elapsed?: number;
  /** длительность фазы помодоро, мс */
  total: number;
  pauseLabel: string;
  resumeLabel: string;
  stopLabel: string;
  pausedLabel: string;
  channel: string;
  /** уведомление в конце фазы (iPhone ставит его сам, если таймер продолжили с экрана блокировки) */
  doneTitle: string;
  doneBody: string;
}

const remaining = (s: FocusState, now: number) => (s.running && s.endAt != null ? Math.max(0, s.endAt - now) : (s.remaining ?? s.total));
const elapsed = (s: FocusState, now: number) => s.acc + (s.running && s.startedAt != null ? Math.max(0, now - s.startedAt) : 0);

const phaseTitle = (s: FocusState) => (s.mode === 'stopwatch' ? t('Секундомер') : s.phase === 'work' ? t('Фокус') : s.phase === 'short' ? t('Короткий перерыв') : t('Длинный перерыв'));

/** Что показать на экране блокировки; null — таймер не запущен */
export function liveState(s: FocusState, taskTitle: string | undefined, now = Date.now()): LiveState | null {
  if (s.sessionStart == null) return null;
  const stopwatch = s.mode === 'stopwatch';
  const work = s.phase === 'work';
  const base = {
    running: s.running,
    stopwatch,
    phase: s.phase,
    title: phaseTitle(s),
    ...(taskTitle ? { task: taskTitle } : {}),
    total: stopwatch ? 0 : s.total,
    pauseLabel: t('Пауза'),
    resumeLabel: t('Продолжить'),
    stopLabel: t('Стоп'),
    pausedLabel: t('На паузе'),
    channel: t('Таймер фокуса'),
    doneTitle: work ? t('Помодоро завершён') : t('Перерыв окончен'),
    doneBody: work ? t('Время отдохнуть') : t('Пора вернуться к фокусу'),
  };
  if (stopwatch) return s.running ? { ...base, start: now - elapsed(s, now) } : { ...base, elapsed: elapsed(s, now) };
  return s.running && s.endAt != null ? { ...base, endAt: s.endAt } : { ...base, left: remaining(s, now) };
}
