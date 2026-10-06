/**
 * Push-уведомления для веб-версии и iPhone (с экрана «Домой»): сервер присылает напоминания,
 * даже когда приложение закрыто. Расписание считается на устройстве и отправляется на сервер.
 */
import { API, authHeader } from './cloud';

const DEVICE_KEY = 'sm-push-device';

interface Device {
  deviceId: string;
  secret: string;
}

function loadDevice(): Device | null {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null') as Device | null;
  } catch {
    return null;
  }
}
function saveDevice(d: Device | null) {
  try {
    if (d) localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* хранилище недоступно */
  }
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}

/** Открыто ли приложение с экрана «Домой» (на iPhone push работает только так) */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Push включён на этом устройстве */
export function pushActive(): boolean {
  return pushSupported() && Notification.permission === 'granted' && !!loadDevice();
}

function b64ToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Ошибка ${res.status}`), { status: res.status });
  return data;
}

async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  const { publicKey } = await call<{ publicKey: string }>('/push/key');
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
}

/** Включить push (вызывать по нажатию пользователя) */
export async function enablePush(): Promise<{ ok: boolean; message: string }> {
  if (!pushSupported()) {
    return {
      ok: false,
      message: /iPhone|iPad/.test(navigator.userAgent)
        ? 'Добавьте SuperMind на экран «Домой» (Поделиться → На экран «Домой») и откройте оттуда — тогда уведомления заработают'
        : 'Этот браузер не поддерживает push-уведомления',
    };
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, message: 'Уведомления запрещены — разрешите их в настройках телефона' };
  if (!navigator.serviceWorker.controller && import.meta.env.DEV) return { ok: false, message: 'В режиме разработки push недоступен' };
  const reg = await navigator.serviceWorker.ready;
  const sub = await subscribe(reg);
  const dev = await call<Device>('/devices', {
    method: 'POST',
    body: JSON.stringify({ subscription: sub.toJSON(), platform: /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'web' }),
  });
  saveDevice(dev);
  await uploadSchedule(true);
  return { ok: true, message: 'Push-уведомления включены' };
}

export async function disablePush() {
  const d = loadDevice();
  saveDevice(null);
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    /* уже отписаны */
  }
  if (d) await call(`/devices/${d.deviceId}`, { method: 'DELETE', body: JSON.stringify({ secret: d.secret }) }).catch(() => {});
}

/** Тестовое уведомление с сервера */
export async function testPush(): Promise<boolean> {
  const d = loadDevice();
  if (!d) return false;
  const r = await call<{ ok: boolean }>(`/devices/${d.deviceId}/test`, { method: 'POST', body: JSON.stringify({ secret: d.secret }) });
  return r.ok;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSig = '';

/** Отправить серверу расписание напоминаний на 3 недели вперёд (с задержкой, без повторов одного и того же) */
export function uploadSchedule(now = false): Promise<void> {
  if (timer) clearTimeout(timer);
  return new Promise((resolve) => {
    timer = setTimeout(
      () => {
        timer = null;
        void doUpload().finally(resolve);
      },
      now ? 0 : 1500,
    );
  });
}

async function doUpload() {
  const d = loadDevice();
  if (!d || !pushActive()) return;
  const { planReminders, pendingWebSnoozes } = await import('../tasks/sync');
  const t = Date.now();
  const items = (await planReminders(t + 30_000, t + 21 * 86400000)).map((p) => ({
    id: `${p.extra.taskId ?? p.extra.habitId}|${p.extra.date ?? ''}|${p.id}`,
    at: p.at,
    title: p.title,
    body: p.body,
    data: Object.fromEntries(Object.entries(p.extra).map(([k, v]) => [k, String(v)])),
  }));
  for (const s of pendingWebSnoozes()) items.push({ id: `snooze|${s.taskId}|${s.at}`, at: s.at, title: s.title, body: 'Отложенное напоминание', data: { taskId: s.taskId, date: '' } });
  const sig = JSON.stringify(items);
  if (sig === lastSig) return;
  try {
    await call(`/devices/${d.deviceId}/schedule`, { method: 'PUT', body: JSON.stringify({ secret: d.secret, items }) });
    lastSig = sig;
  } catch (e) {
    // устройство удалено на сервере (подписка истекла) — включим заново при следующем запуске
    if ((e as { status?: number }).status === 401) saveDevice(null);
  }
}

/** При запуске: если разрешение есть, а подписка пропала — восстановить её */
export async function ensurePush() {
  if (!pushSupported() || Notification.permission !== 'granted' || import.meta.env.DEV) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub || !loadDevice()) await enablePush();
    else void uploadSchedule();
  } catch {
    /* попробуем позже */
  }
}
