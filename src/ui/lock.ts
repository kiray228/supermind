/**
 * Код-пароль приложения: экран блокировки при запуске и после паузы в фоне.
 * PIN хранится только на этом устройстве — как хеш PBKDF2 с солью, не синхронизируется.
 */
import { create } from 'zustand';

const KEY = 'sm-lock';
const FAILS = 'sm-lock-fails';
/** сколько неверных попыток подряд — и пауза */
export const MAX_TRIES = 5;

export interface LockConfig {
  v: 1;
  salt: string;
  hash: string;
  /** запирать после стольких минут в фоне (0 — сразу) */
  after: number;
}

export const LOCK_AFTER_OPTIONS = [
  { value: 0, label: 'Сразу' },
  { value: 1, label: 'Через 1 минуту' },
  { value: 5, label: 'Через 5 минут' },
  { value: 15, label: 'Через 15 минут' },
];

export const useLock = create<{ locked: boolean; enabled: boolean }>(() => ({ locked: false, enabled: false }));

export function lockConfig(): LockConfig | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LockConfig | null;
    return v && v.v === 1 && v.hash && v.salt ? v : null;
  } catch {
    return null;
  }
}

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

/** Хеш PIN: PBKDF2-SHA-256, 120 000 повторов — подбор 4–6 цифр по украденному хешу медленный */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: 120_000 }, key, 256);
  return hex(bits);
}

export const validPin = (pin: string) => /^\d{4,6}$/.test(pin);

/** Включить или сменить код */
export async function setPin(pin: string, after = lockConfig()?.after ?? 1): Promise<void> {
  if (!validPin(pin)) throw new Error('Код — от 4 до 6 цифр');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const cfg: LockConfig = { v: 1, salt, hash: await hashPin(pin, salt), after };
  localStorage.setItem(KEY, JSON.stringify(cfg));
  localStorage.removeItem(FAILS);
  useLock.setState({ enabled: true });
}

export function disableLock() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(FAILS);
  useLock.setState({ enabled: false, locked: false });
}

export function setLockAfter(after: number) {
  const cfg = lockConfig();
  if (cfg) localStorage.setItem(KEY, JSON.stringify({ ...cfg, after }));
}

interface Fails {
  n: number;
  /** до этого времени вводить нельзя */
  until: number;
}
const fails = (): Fails => {
  try {
    return { n: 0, until: 0, ...(JSON.parse(localStorage.getItem(FAILS) ?? '{}') as Partial<Fails>) };
  } catch {
    return { n: 0, until: 0 };
  }
};

/** Сколько ещё ждать после неверных попыток (мс); 0 — можно вводить */
export const lockWait = (now = Date.now()) => Math.max(0, fails().until - now);

/** Проверить код: верный — разблокировать. Каждые 5 ошибок — пауза: 30 с, потом минута, 5 минут… */
export async function tryUnlock(pin: string, now = Date.now()): Promise<'ok' | 'wrong' | 'wait'> {
  const cfg = lockConfig();
  if (!cfg) {
    useLock.setState({ locked: false });
    return 'ok';
  }
  if (lockWait(now) > 0) return 'wait';
  if ((await hashPin(pin, cfg.salt)) === cfg.hash) {
    localStorage.removeItem(FAILS);
    useLock.setState({ locked: false });
    return 'ok';
  }
  const f = fails();
  const n = f.n + 1;
  const round = Math.floor(n / MAX_TRIES);
  const until = n % MAX_TRIES === 0 ? now + [30, 60, 300, 900][Math.min(round - 1, 3)] * 1000 : f.until;
  localStorage.setItem(FAILS, JSON.stringify({ n, until }));
  return 'wrong';
}

export const lockNow = () => lockConfig() && useLock.setState({ locked: true });

// ---------- Отпечаток (лицо): вместо кода, код — запасной ----------

const BIO = 'sm-lock-bio';
export const biometricOn = () => {
  try {
    return localStorage.getItem(BIO) === '1';
  } catch {
    return false;
  }
};
export function setBiometric(on: boolean) {
  try {
    localStorage.setItem(BIO, on ? '1' : '0');
  } catch {
    /* не страшно */
  }
}

/** Есть ли на устройстве отпечаток или распознавание лица (только Android-приложение) */
export async function biometricAvailable(): Promise<boolean> {
  const { isNative } = await import('../platform');
  if (!isNative()) return false;
  try {
    const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
    return (await NativeBiometric.isAvailable({ useFallback: false })).isAvailable;
  } catch {
    return false;
  }
}

/** идёт проверка отпечатка: системное окно может «свернуть» приложение — это не уход в фон */
let bioActive = false;
let bioDoneAt = 0;

/** Открыть по отпечатку: true — открыто (неудача или «Ввести код» — false, код остаётся) */
export async function unlockWithBiometric(): Promise<boolean> {
  if (bioActive || !lockConfig() || !biometricOn() || !(await biometricAvailable())) return false;
  bioActive = true;
  try {
    const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
    await NativeBiometric.verifyIdentity({ title: 'SuperMind', subtitle: 'Разблокировать приложение', negativeButtonText: 'Ввести код', maxAttempts: 3 });
    localStorage.removeItem(FAILS);
    useLock.setState({ locked: false });
    return true;
  } catch {
    return false;
  } finally {
    bioActive = false;
    bioDoneAt = Date.now();
  }
}

// ---------- Android: прятать содержимое в списке недавних приложений ----------

const SECURE = 'sm-secure-window';
export const secureWindow = () => {
  try {
    return localStorage.getItem(SECURE) === '1';
  } catch {
    return false;
  }
};
async function applySecure(on: boolean) {
  const { isNative } = await import('../platform');
  if (!isNative()) return;
  const { setSecureWindow } = await import('../native/widget');
  await setSecureWindow(on);
}
export function setSecure(on: boolean) {
  try {
    localStorage.setItem(SECURE, on ? '1' : '0');
  } catch {
    /* не страшно */
  }
  void applySecure(on);
}

let started = false;

/** При запуске — заперто (если код включён); после паузы в фоне дольше заданного — снова */
export function initLock() {
  const cfg = lockConfig();
  useLock.setState({ enabled: !!cfg, locked: !!cfg });
  if (started || typeof document === 'undefined') return;
  started = true;
  if (secureWindow()) void applySecure(true);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    const c = lockConfig();
    if (!c) return;
    // окно отпечатка (и секунда после него) — не уход из приложения
    if (bioActive || Date.now() - bioDoneAt < 1500) {
      hiddenAt = 0;
      return;
    }
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt >= c.after * 60_000) useLock.setState({ locked: true });
  });
}
