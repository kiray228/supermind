/**
 * Таймер фокуса на экране блокировки: Live Activity и Dynamic Island на iPhone, закреплённое уведомление на Android.
 * Приложение присылает состояние таймера при каждом изменении; кнопки «Пауза/Продолжить/Стоп» там работают сразу,
 * а действие приходит в приложение через очередь виджетов ({type:'focus', action, at}) — см. applyFocusAction.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNative } from '../platform';
import { resume, start, stop, useFocus } from '../tasks/focusTimer';
import { liveState, type LiveState } from './focusLiveCore';
import { useTasks } from '../tasks/store';

interface FocusLivePlugin {
  update(o: LiveState): Promise<void>;
  end(): Promise<void>;
}
const FocusLive = registerPlugin<FocusLivePlugin>('FocusLive');

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
  // виджет «Фокус» и Siri «Начни фокус»: запустить (идёт уже — просто продолжить)
  else if (action === 'start') start();
  else if (action === 'stop') {
    freezeAt(when);
    stop();
  }
}
