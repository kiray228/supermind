/**
 * Ошибки приложения.
 *  · Журнал последних ошибок на устройстве — уходит в «сведения для диагностики», если пользователь их приложил к обращению.
 *  · Автоматические отчёты на сервер (POST /errors) о необработанных ошибках и падениях разделов, если не выключены
 *    в Настройках → Поддержка. Без данных пользователя: только текст ошибки, стек, версия, устройство и раздел.
 */
import { APP_VERSION } from '../store/safety';
import { useApp } from '../store/appStore';
import { isNative } from '../platform';

type Kind = 'error' | 'rejection' | 'crash' | 'console';
interface Logged {
  at: number;
  kind: Kind;
  view: string;
  message: string;
  stack: string;
}

const LOG_MAX = 30;
const SEND_MAX = 20;
const OFF_KEY = 'sm-error-reports';
/** шум браузера, расширений и сети — не ошибки приложения */
const IGNORE = [
  /ResizeObserver loop/,
  /^Script error\.?$/,
  /Нет соединения с сервером/,
  /Failed to fetch|NetworkError|Load failed|network error/i,
  /AbortError|The user aborted|The operation was aborted/,
  /(chrome|moz|safari(-web)?)-extension:/,
];

const log: Logged[] = [];
const queue = new Map<string, { message: string; stack: string; view: string; count: number }>();
let sent = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let installed = false;

/** Устройство одной строкой — без личных данных */
export function deviceInfo(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : 'другая ОС';
  const app = isNative() ? 'приложение' : window.matchMedia('(display-mode: standalone)').matches ? 'PWA' : 'браузер';
  return `SuperMind ${APP_VERSION} · ${os} · ${app} · экран ${screen.width}×${screen.height} · ${navigator.language}`;
}

export const errorReportsOn = () => {
  try {
    return localStorage.getItem(OFF_KEY) !== 'off';
  } catch {
    return true;
  }
};
export function setErrorReports(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, 'off');
  } catch {
    /* без хранилища — остаётся как было */
  }
}

const currentView = () => {
  try {
    return useApp.getState().view;
  } catch {
    return '';
  }
};

function describe(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) return { message: `${err.name && err.name !== 'Error' ? err.name + ': ' : ''}${err.message}`, stack: err.stack ?? '' };
  if (typeof err === 'string') return { message: err, stack: '' };
  try {
    return { message: JSON.stringify(err).slice(0, 500), stack: '' };
  } catch {
    return { message: String(err), stack: '' };
  }
}

/** Записать ошибку в журнал; необработанные и падения разделов — ещё и в отчёт */
export function recordError(err: unknown, kind: Kind) {
  const { message, stack } = describe(err);
  if (!message || IGNORE.some((re) => re.test(message) || re.test(stack))) return;
  const view = currentView();
  log.push({ at: Date.now(), kind, view, message: message.slice(0, 500), stack: stack.slice(0, 3000) });
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
  if (kind !== 'console') enqueue(message, stack, view);
}

function enqueue(message: string, stack: string, view: string) {
  // в режиме разработки — только на локальный сервер
  if (!errorReportsOn() || APP_VERSION === 'dev' || (import.meta.env.DEV && !localStorage.getItem('sm-api'))) return;
  const key = `${message}|${stack.split('\n').slice(0, 3).join('|')}`;
  const q = queue.get(key);
  if (q) q.count++;
  else queue.set(key, { message: message.slice(0, 500), stack: stack.slice(0, 3000), view, count: 1 });
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), 5000);
}

async function flush() {
  if (!queue.size || sent >= SEND_MAX) return queue.clear();
  const errors = [...queue.values()].slice(0, Math.min(10, SEND_MAX - sent)).map((e) => ({ ...e, version: APP_VERSION, platform: deviceInfo().replace(/^SuperMind \S+ · /, '') }));
  queue.clear();
  sent += errors.length;
  try {
    const { API } = await import('../store/cloud');
    await fetch(API + '/errors', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ errors }) });
  } catch {
    /* нет сети — отчёт не важнее работы приложения */
  }
}

/** Подключить перехват ошибок (один раз, при запуске) */
export function installErrorReporting() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => recordError(e.error ?? e.message, 'error'));
  window.addEventListener('unhandledrejection', (e) => recordError(e.reason, 'rejection'));
  window.addEventListener('pagehide', () => void flush());
  // обработанные ошибки, которые приложение пишет в консоль, — только в журнал для диагностики
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    try {
      const err = args.find((a) => a instanceof Error);
      const text = args.filter((a) => !(a instanceof Error)).map((a) => (typeof a === 'string' ? a : describe(a).message)).join(' ');
      recordError(err ? Object.assign(new Error(`${text ? text + ': ' : ''}${(err as Error).message}`), { stack: (err as Error).stack }) : text, 'console');
    } catch {
      /* журнал — не повод сломать console.error */
    }
  };
}

/** Сведения для диагностики к обращению (с согласия пользователя): устройство, синхронизация, последние ошибки */
export async function diagnostics(): Promise<Record<string, unknown>> {
  const { useCloud } = await import('../store/cloud');
  const c = useCloud.getState();
  let storage: { usedMB: number; quotaMB: number } | undefined;
  try {
    const e = await navigator.storage?.estimate?.();
    if (e?.quota) storage = { usedMB: Math.round((e.usage ?? 0) / 1e6), quotaMB: Math.round(e.quota / 1e6) };
  } catch {
    /* оценка места недоступна */
  }
  const out: Record<string, unknown> = {
    version: APP_VERSION,
    device: deviceInfo(),
    userAgent: navigator.userAgent.slice(0, 300),
    view: currentView(),
    online: navigator.onLine,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    notifications: typeof Notification === 'undefined' ? 'нет' : Notification.permission,
    sync: { signedIn: !!c.account, status: c.status, error: c.error ?? null, lastSync: c.lastSync ? new Date(c.lastSync).toISOString() : null, localOnly: c.localOnly ?? 0 },
    storage,
    errors: log.slice(-15).map((e) => ({
      at: new Date(e.at).toISOString(),
      kind: e.kind,
      view: e.view,
      message: e.message.slice(0, 300),
      stack: e.stack.split('\n').slice(0, 5).join('\n').slice(0, 600),
    })),
  };
  // сервер принимает до 20 КБ — лишнее отрезаем со старых ошибок
  while (JSON.stringify(out).length > 18_000 && (out.errors as unknown[]).length) (out.errors as unknown[]).shift();
  return out;
}
