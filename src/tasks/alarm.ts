/**
 * Будильник в веб-версии (браузер, PWA, приложение для Windows): громкий повторяющийся сигнал и вибрация,
 * пока его не выключат (или 5 минут). Звучит, только пока приложение открыто — хотя бы свёрнутым:
 * закрытая веб-страница звонить не может (на iPhone тогда приходит обычное уведомление).
 * На Android-приложении будильник настоящий — нативный (SmAlarm).
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let buzz: ReturnType<typeof setInterval> | undefined;
const RING_MS = 5 * 60_000;

/** Браузер разрешает звук только после действия пользователя — готовим его при первом касании */
export function primeAlarmAudio() {
  const unlock = () => {
    try {
      ctx ??= new AudioContext();
      void ctx.resume();
    } catch {
      /* звук недоступен */
    }
  };
  for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, unlock, { once: true, capture: true });
}

function beep(c: AudioContext, out: AudioNode, at: number, freq: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.9, at + 0.015);
  g.gain.setValueAtTime(0.9, at + 0.13);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + 0.2);
}

/** Зазвонить. Сигнал заранее расписан на всё время звонка: таймеры свёрнутой вкладки браузер замедляет, а звук — нет */
export function ringWeb() {
  if (master) return;
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.05;
    // «би-би-би — пауза», как у будильника
    for (let i = 0; i * 1.5 < RING_MS / 1000; i++) for (let k = 0; k < 3; k++) beep(ctx, master, t0 + i * 1.5 + k * 0.22, k === 2 ? 1175 : 988);
  } catch {
    master = null;
  }
  // вибрация (Android-браузер) — только после касания страницы, иначе браузер её запрещает
  const vibrate = () => {
    try {
      if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive !== false) navigator.vibrate?.([700, 400, 700, 400, 700]);
    } catch {
      /* без вибрации */
    }
  };
  vibrate();
  buzz = setInterval(vibrate, 4000);
  stopTimer = setTimeout(stopWeb, RING_MS);
}

export function stopWeb() {
  clearTimeout(stopTimer);
  clearInterval(buzz);
  if (master) {
    try {
      master.gain.value = 0;
      master.disconnect();
    } catch {
      /* уже отключён */
    }
    master = null;
  }
  try {
    navigator.vibrate?.(0);
  } catch {
    /* без вибрации */
  }
}

// ---------- Android: настоящий будильник (нативный плагин SmAlarm) ----------

export interface NativeAlarm {
  id: number;
  at: number;
  title: string;
  body: string;
  taskId: string;
  date: string;
  snooze?: number;
}

interface SmAlarmPlugin {
  sync(o: { alarms: NativeAlarm[] }): Promise<{ count: number; set: number }>;
  list(): Promise<{ alarms: NativeAlarm[] }>;
  cancel(o: { ids: number[] }): Promise<void>;
  takeActions(): Promise<{ actions: { action: string; taskId: string; date: string }[] }>;
  test(): Promise<void>;
  fullScreenAllowed(): Promise<{ allowed: boolean }>;
  openFullScreenSettings(): Promise<void>;
  addListener(event: 'actions', fn: () => void): Promise<PluginListenerHandle>;
}

export const SmAlarm = registerPlugin<SmAlarmPlugin>('SmAlarm');
