import { create } from 'zustand';
import { isNative } from '../platform';
import { DEFAULT_PREFS, type FocusSession } from './model';
import { addFocusSession, ensureTasks, useTasks } from './store';

// ================= Глобальный таймер фокуса (помодоро / секундомер) =================
// Живёт вне компонентов: переход между разделами его не останавливает,
// состояние хранится в localStorage — после перезагрузки таймер продолжается.

export type FocusMode = 'pomo' | 'stopwatch';
export type FocusPhase = 'work' | 'short' | 'long';
export type NoiseKind = 'none' | 'white' | 'pink' | 'brown' | 'rain';

export interface FocusState {
  mode: FocusMode;
  phase: FocusPhase;
  running: boolean;
  /** помодоро: момент окончания фазы (пока идёт) */
  endAt: number | null;
  /** помодоро: сколько осталось мс (на паузе) */
  remaining: number | null;
  /** длительность текущей фазы, мс */
  total: number;
  /** секундомер: момент последнего запуска */
  startedAt: number | null;
  /** секундомер: накоплено мс до последней паузы */
  acc: number;
  /** начало текущей сессии; null — таймер не запущен */
  sessionStart: number | null;
  taskId?: string;
  /** выполнено помодоро в текущем цикле (до длинного перерыва) */
  completedPomos: number;
  noise: NoiseKind;
  /** громкость шума 0..1 */
  volume: number;
  /** «тик» для перерисовки, обновляется раз в секунду, пока таймер идёт */
  now: number;
}

/** Действия доступны и как функции модуля, и через useFocus.getState() */
export interface FocusActions {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  skip: () => void;
  setTask: (id: string | undefined) => void;
  setMode: (m: FocusMode) => void;
  setNoise: (n: NoiseKind) => void;
  setVolume: (v: number) => void;
}

const KEY = 'sm-focus';
const NID = 777001;

function load(): Partial<FocusState> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<FocusState>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

const initial: FocusState & FocusActions = {
  mode: 'pomo',
  phase: 'work',
  running: false,
  endAt: null,
  remaining: null,
  total: DEFAULT_PREFS.pomo.work * 60000,
  startedAt: null,
  acc: 0,
  sessionStart: null,
  completedPomos: 0,
  noise: 'none',
  volume: 0.5,
  ...load(),
  now: Date.now(),
  start,
  pause,
  resume,
  stop,
  skip,
  setTask,
  setMode,
  setNoise,
  setVolume,
};

export const useFocus = create<FocusState & FocusActions>(() => initial);

const g = () => useFocus.getState();
const put = (p: Partial<FocusState>) => useFocus.setState(p);

// ---------- Сохранение ----------

let lastSaved = '';
useFocus.subscribe((s) => {
  const { now: _now, ...rest } = s;
  void _now;
  const str = JSON.stringify(rest);
  if (str !== lastSaved) {
    lastSaved = str;
    try {
      localStorage.setItem(KEY, str);
    } catch {
      /* хранилище недоступно */
    }
  }
  syncNoise();
});

// ---------- Вычисления ----------

export function pomoPrefs() {
  return useTasks.getState().data?.prefs.pomo ?? DEFAULT_PREFS.pomo;
}

/** Длительность фазы по настройкам, мс */
export function phaseMs(phase: FocusPhase): number {
  const p = pomoPrefs();
  const min = phase === 'work' ? p.work : phase === 'short' ? p.short : p.long;
  return Math.max(1, min || 1) * 60000;
}

export const isFocusActive = (s: FocusState) => s.sessionStart != null;

/** Помодоро: сколько осталось мс */
export function remainingMs(s: FocusState, now = Date.now()): number {
  if (s.running && s.endAt != null) return Math.max(0, s.endAt - now);
  if (s.remaining != null) return s.remaining;
  return phaseMs(s.phase);
}

/** Секундомер: сколько прошло мс */
export function elapsedMs(s: FocusState, now = Date.now()): number {
  return s.acc + (s.running && s.startedAt != null ? Math.max(0, now - s.startedAt) : 0);
}

/** Доля выполнения текущей фазы 0..1 (для секундомера — оборот за час) */
export function focusProgress(s: FocusState, now = Date.now()): number {
  if (s.mode === 'stopwatch') return (elapsedMs(s, now) % 3600000) / 3600000;
  const total = isFocusActive(s) ? s.total : phaseMs(s.phase);
  return total ? Math.min(1, Math.max(0, 1 - remainingMs(s, now) / total)) : 0;
}

/** «mm:ss» или «h:mm:ss» */
export function formatMs(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export const PHASE_LABEL: Record<FocusPhase, string> = { work: 'Фокус', short: 'Короткий перерыв', long: 'Длинный перерыв' };

function record(start: number, minutes: number, taskId: string | undefined, kind: FocusSession['kind']) {
  if (minutes < 1) return;
  void ensureTasks()
    .then(() => addFocusSession(taskId ? { start, minutes, taskId, kind } : { start, minutes, kind }))
    .catch(() => {});
}

// ---------- Управление ----------

export function start() {
  const s = g();
  if (isFocusActive(s)) {
    if (!s.running) resume();
    return;
  }
  const now = Date.now();
  askPermission();
  ensureTicker();
  if (s.mode === 'stopwatch') {
    put({ running: true, startedAt: now, acc: 0, sessionStart: now, now });
    return;
  }
  const total = phaseMs(s.phase);
  put({ running: true, endAt: now + total, total, remaining: null, sessionStart: now, now });
  scheduleNative();
}

export function pause() {
  const s = g();
  if (!s.running) return;
  const now = Date.now();
  if (s.mode === 'stopwatch') put({ running: false, acc: elapsedMs(s, now), startedAt: null, now });
  else {
    put({ running: false, remaining: remainingMs(s, now), endAt: null, now });
    cancelNative();
  }
}

export function resume() {
  const s = g();
  if (s.running || !isFocusActive(s)) return;
  const now = Date.now();
  ensureTicker();
  if (s.mode === 'stopwatch') put({ running: true, startedAt: now, now });
  else {
    put({ running: true, endAt: now + (s.remaining ?? s.total), remaining: null, now });
    scheduleNative();
  }
}

/** Остановить без вопросов; если отработана хотя бы минута — записать сессию */
export function stop() {
  const s = g();
  const now = Date.now();
  if (s.mode === 'stopwatch') {
    if (s.sessionStart != null) record(s.sessionStart, Math.floor(elapsedMs(s, now) / 60000), s.taskId, 'stopwatch');
    put({ running: false, startedAt: null, acc: 0, sessionStart: null, now });
    return;
  }
  if (s.phase === 'work' && s.sessionStart != null) {
    record(s.sessionStart, Math.floor((s.total - remainingMs(s, now)) / 60000), s.taskId, 'pomo');
  }
  put({
    running: false,
    endAt: null,
    remaining: null,
    sessionStart: null,
    phase: 'work',
    total: phaseMs('work'),
    completedPomos: s.phase === 'long' ? 0 : s.completedPomos,
    now,
  });
  cancelNative();
}

/** Перейти к следующей фазе */
export function skip() {
  const s = g();
  if (s.mode !== 'pomo') return;
  const now = Date.now();
  cancelNative();
  if (s.phase === 'work') {
    if (s.sessionStart != null) record(s.sessionStart, Math.floor((s.total - remainingMs(s, now)) / 60000), s.taskId, 'pomo');
    enterPhase('short', pomoPrefs().autoNext && isFocusActive(s), now);
  } else {
    if (s.phase === 'long') put({ completedPomos: 0 });
    enterPhase('work', false, now);
  }
}

export function setTask(id: string | undefined) {
  put({ taskId: id });
}

export function setMode(m: FocusMode) {
  if (g().mode === m) return;
  if (isFocusActive(g())) stop();
  put({ mode: m, phase: 'work', total: phaseMs('work'), remaining: null, endAt: null, acc: 0, startedAt: null });
}

export function setNoise(n: NoiseKind) {
  put({ noise: n });
}
export function setVolume(v: number) {
  put({ volume: Math.min(1, Math.max(0, v)) });
}

function enterPhase(phase: FocusPhase, autoStart: boolean, base: number) {
  const total = phaseMs(phase);
  if (autoStart) {
    put({ phase, total, running: true, endAt: base + total, remaining: null, sessionStart: base, now: Date.now() });
    scheduleNative();
  } else {
    put({ phase, total, running: false, endAt: null, remaining: null, sessionStart: null, now: Date.now() });
  }
}

/** Фаза закончилась */
function finishPhase(s: FocusState, now: number) {
  const endAt = s.endAt ?? now;
  const late = now - endAt;
  const prefs = pomoPrefs();
  let next: FocusPhase;
  if (s.phase === 'work') {
    record(s.sessionStart ?? endAt - s.total, Math.round(s.total / 60000), s.taskId, 'pomo');
    const n = s.completedPomos + 1;
    next = n % Math.max(1, prefs.longEvery) === 0 ? 'long' : 'short';
    put({ completedPomos: n });
  } else {
    next = 'work';
    if (s.phase === 'long') put({ completedPomos: 0 });
  }
  // сигнал — только если фаза закончилась только что, а не пока приложение было закрыто
  if (late < 120000) {
    playChime();
    try {
      navigator.vibrate?.([200, 100, 200, 100, 300]);
    } catch {
      /* нет вибрации */
    }
    if (!isNative()) {
      if (s.phase === 'work') webNotify('Помодоро завершён', 'Время отдохнуть');
      else webNotify('Перерыв окончен', 'Пора вернуться к фокусу');
    }
  }
  // после долгого отсутствия следующий этап сам не запускаем
  enterPhase(next, prefs.autoNext && late < 600000, late < 5000 ? endAt : now);
}

function tick() {
  const s = g();
  if (!s.running) return;
  const now = Date.now();
  if (s.mode === 'pomo' && s.endAt != null && now >= s.endAt) {
    // настройки помодоро ещё не загружены — подождать
    if (!useTasks.getState().data) {
      void ensureTasks().catch(() => {});
      put({ now });
      return;
    }
    finishPhase(s, now);
  }
  else put({ now });
}

let ticker: ReturnType<typeof setInterval> | null = null;
function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
  window.addEventListener('focus', tick);
}

/** Запустить проверку таймера (вызывается при старте приложения) */
export function initFocusTimer() {
  ensureTicker();
  void ensureTasks()
    .catch(() => {})
    .then(tick);
  // после перезагрузки страницы на вебе — обновить уведомление на телефоне
  if (g().running && g().mode === 'pomo') scheduleNative();
}

// ---------- Уведомления ----------

// объект плагина Capacitor нельзя возвращать из Promise (он «thenable») — возвращаем модуль целиком
const LN = () => import('@capacitor/local-notifications');
let nativeQueue: Promise<void> = Promise.resolve();
const nativeOp = (fn: () => Promise<void>) => {
  if (!isNative()) return;
  nativeQueue = nativeQueue.then(fn).catch(() => {});
};

let permAsked = false;
function askPermission() {
  if (permAsked) return;
  permAsked = true;
  if (isNative()) {
    nativeOp(async () => {
      const { LocalNotifications: L } = await LN();
      const p = await L.checkPermissions();
      if (p.display !== 'granted' && p.display !== 'denied') await L.requestPermissions();
    });
  } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => {});
  }
}

function scheduleNative() {
  nativeOp(async () => {
    const s = g();
    if (!s.running || s.endAt == null || s.mode !== 'pomo' || s.endAt <= Date.now()) return;
    const { LocalNotifications: L } = await LN();
    await L.cancel({ notifications: [{ id: NID }] }).catch(() => {});
    const work = s.phase === 'work';
    await L.schedule({
      notifications: [
        {
          id: NID,
          title: work ? 'Помодоро завершён' : 'Перерыв окончен',
          body: work ? 'Время отдохнуть' : 'Пора вернуться к фокусу',
          schedule: { at: new Date(s.endAt), allowWhileIdle: true },
          channelId: 'sm-reminders',
        },
      ],
    });
  });
}

function cancelNative() {
  nativeOp(async () => {
    const { LocalNotifications: L } = await LN();
    await L.cancel({ notifications: [{ id: NID }] });
  });
}

function webNotify(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag: 'sm-focus' });
  } catch {
    // Chrome на Android: только через service worker
    void navigator.serviceWorker?.getRegistration().then((r) => r?.showNotification(title, { body, tag: 'sm-focus' }));
  }
}

// ---------- Звук ----------

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Мягкий колокольчик: восходящее арпеджио с обертонами */
export function playChime() {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + 0.05;
  const notes = [659.25, 830.61, 987.77, 1318.51];
  const partials = [
    [1, 0.2],
    [2, 0.05],
    [3.01, 0.02],
  ] as const;
  notes.forEach((f, i) => {
    const t = t0 + i * 0.17;
    for (const [mult, amp] of partials) {
      const o = a.createOscillator();
      const gn = a.createGain();
      o.type = 'sine';
      o.frequency.value = f * mult;
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(amp, t + 0.015);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      o.connect(gn).connect(a.destination);
      o.start(t);
      o.stop(t + 2);
    }
  });
}

const buffers: Partial<Record<NoiseKind, AudioBuffer>> = {};

/** Шум в буфере с плавной склейкой концов (без щелчка при повторе) */
function makeNoise(a: AudioContext, kind: NoiseKind): AudioBuffer {
  const sr = a.sampleRate;
  const len = Math.floor(sr * 8);
  const fade = Math.floor(sr * 0.5);
  const buf = a.createBuffer(2, len, sr);
  const raw = new Float32Array(len + fade);
  for (let ch = 0; ch < 2; ch++) {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      // розовый шум (фильтр Пола Келлета)
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      brown = (brown + 0.02 * w) / 1.02;
      raw[i] = kind === 'white' ? w * 0.3 : kind === 'pink' ? pink : kind === 'brown' ? brown * 3.2 : pink * 0.8 + brown * 1.2;
    }
    if (kind === 'rain') {
      // капли: короткие затухающие щелчки разной силы
      const drops = Math.floor((raw.length / sr) * 45);
      for (let k = 0; k < drops; k++) {
        const pos = Math.floor(Math.random() * raw.length);
        const amp = 0.08 + Math.random() * 0.35;
        const dur = Math.floor(sr * (0.003 + Math.random() * 0.01));
        let prev = 0;
        for (let j = 0; j < dur && pos + j < raw.length; j++) {
          const n = Math.random() * 2 - 1;
          raw[pos + j] += (n - prev) * amp * Math.exp(-j / (dur / 4));
          prev = n;
        }
      }
    }
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = raw[i];
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = raw[i] * k + raw[len + i] * (1 - k);
    }
  }
  return buf;
}

let noiseSrc: AudioBufferSourceNode | null = null;
let noiseGain: GainNode | null = null;
let noisePlaying: NoiseKind = 'none';
const gainOf = (v: number) => v * v * 0.9;

function stopNoise() {
  if (noiseSrc && noiseGain && ctx) {
    const t = ctx.currentTime;
    noiseGain.gain.cancelScheduledValues(t);
    noiseGain.gain.setValueAtTime(noiseGain.gain.value, t);
    noiseGain.gain.linearRampToValueAtTime(0, t + 0.3);
    try {
      noiseSrc.stop(t + 0.35);
    } catch {
      /* уже остановлен */
    }
  }
  noiseSrc = null;
  noiseGain = null;
  noisePlaying = 'none';
}

/** Шум звучит только пока таймер идёт */
function syncNoise() {
  const s = g();
  const want: NoiseKind = s.running ? s.noise : 'none';
  if (want === noisePlaying) {
    if (noiseGain && ctx) noiseGain.gain.setTargetAtTime(gainOf(s.volume), ctx.currentTime, 0.05);
    return;
  }
  stopNoise();
  if (want === 'none') return;
  const a = audio();
  if (!a) return;
  const buf = (buffers[want] ??= makeNoise(a, want));
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gn = a.createGain();
  gn.gain.setValueAtTime(0, a.currentTime);
  gn.gain.linearRampToValueAtTime(gainOf(s.volume), a.currentTime + 0.8);
  let node: AudioNode = src;
  if (want === 'rain') {
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5500;
    node = src.connect(hp).connect(lp);
  }
  node.connect(gn).connect(a.destination);
  src.start();
  noiseSrc = src;
  noiseGain = gn;
  noisePlaying = want;
}

