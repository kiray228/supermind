/**
 * Таймер фокуса на экране блокировки: Live Activity и Dynamic Island на iPhone, закреплённое уведомление на Android.
 * Приложение присылает состояние таймера при каждом изменении; кнопки «Пауза/Продолжить/Стоп» там работают сразу,
 * а действие приходит в приложение через очередь виджетов ({type:'focus', action, at}) — см. applyFocusAction.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNative } from '../platform';
import { t } from '../i18n';
import { elapsedMs, isFocusActive, remainingMs, resume, stop, useFocus, type FocusState } from '../tasks/focusTimer';
import { useTasks } from '../tasks/store';

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

interface FocusLivePlugin {
  update(o: LiveState): Promise<void>;
  end(): Promise<void>;
}
const FocusLive = registerPlugin<FocusLivePlugin>('FocusLive');

const phaseTitle = (s: FocusState) => (s.mode === 'stopwatch' ? t('Секундомер') : s.phase === 'work' ? t('Фокус') : s.phase === 'short' ? t('Короткий перерыв') : t('Длинный перерыв'));

/** Что показать на экране блокировки; null — таймер не запущен */
export function liveState(s: FocusState, taskTitle: string | undefined, now = Date.now()): LiveState | null {
  if (!isFocusActive(s)) return null;
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
  if (stopwatch) return s.running ? { ...base, start: now - elapsedMs(s, now) } : { ...base, elapsed: elapsedMs(s, now) };
  return s.running && s.endAt != null ? { ...base, endAt: s.endAt } : { ...base, left: remainingMs(s, now) };
}

let started = false;
let last = '';

export function initFocusLive() {
  const platform = Capacitor.getPlatform();
  if (started || !isNative() || (platform !== 'ios' && platform !== 'android')) return;
  started = true;
  const push = () => {
    const s = useFocus.getState();
    const task = s.taskId ? useTasks.getState().data?.tasks.find((x) => x.id === s.taskId)?.title : undefined;
    const st = liveState(s, task);
    // секундомер на паузе и остаток помодоро не меняются каждую секунду — сравниваем без «тика»
    const key = st ? JSON.stringify(st) : '';
    if (key === last) return;
    last = key;
    if (st) void FocusLive.update(st).catch(() => {});
    else void FocusLive.end().catch(() => {});
  };
  useFocus.subscribe((s, prev) => {
    if (s.running !== prev.running || s.sessionStart !== prev.sessionStart || s.phase !== prev.phase || s.endAt !== prev.endAt || s.taskId !== prev.taskId || s.mode !== prev.mode || s.startedAt !== prev.startedAt) push();
  });
  push();
}

/** Остановить таймер на моменте нажатия (приложение могло спать) — дальше пауза/стоп считают время верно */
function freezeAt(at: number) {
  const s = useFocus.getState();
  if (!s.running) return;
  if (s.mode === 'stopwatch') useFocus.setState({ running: false, acc: s.acc + Math.max(0, at - (s.startedAt ?? at)), startedAt: null, now: Date.now() });
  else useFocus.setState({ running: false, remaining: Math.max(0, (s.endAt ?? at) - at), endAt: null, now: Date.now() });
}

/** Кнопка на экране блокировки → таймер приложения */
export async function applyFocusAction(action: string, at = Date.now()) {
  const when = Math.min(at, Date.now());
  if (action === 'pause') {
    freezeAt(when);
    // уведомление «Помодоро завершён» больше не нужно
    if (isNative()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.cancel({ notifications: [{ id: 777001 }] }).catch(() => {});
    }
  } else if (action === 'resume') resume();
  else if (action === 'stop') {
    freezeAt(when);
    stop();
  }
}
