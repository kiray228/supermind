/**
 * Одинаковые настройки на всех устройствах: тема, цвет, стекло, фон, модель ИИ, анимации, озвучка,
 * что видит ассистент и утренние уведомления второго мозга. Хранятся в синхронизируемом ключе
 * 'ui-prefs': у каждой настройки своё время изменения — при слиянии побеждает более свежая (merge.ts).
 * API-ключ, код-пароль и защита экрана — только на этом устройстве и сюда не попадают.
 */
import { get, set } from './kv';
import type { Settings } from '../types';

export const PREFS_KEY = 'ui-prefs';
/** '1' — настройки только этого устройства (не отправлять и не принимать) */
const LOCAL_ONLY = 'sm-prefs-local';

export interface SharedPrefs {
  v: Record<string, unknown>;
  at: Record<string, number>;
}

/** Поля настроек приложения, общие для устройств */
export const SHARED_SETTINGS = ['theme', 'accent', 'glass', 'backdrop', 'model'] as const satisfies readonly (keyof Settings)[];
/** Настройки в localStorage (значение — строка как есть, null — не задано) */
export const SHARED_LOCAL = ['sm-ai-privacy', 'sm-brain-notify', 'sm-voice-speak', 'sm-celebrate'] as const;

const settingField = (k: string) => `settings.${k}`;
const localField = (k: string) => `ls:${k}`;

export function prefsShared(): boolean {
  try {
    return localStorage.getItem(LOCAL_ONLY) !== '1';
  } catch {
    return true;
  }
}

export function setPrefsShared(on: boolean) {
  try {
    if (on) localStorage.removeItem(LOCAL_ONLY);
    else localStorage.setItem(LOCAL_ONLY, '1');
  } catch {
    /* хранилище недоступно */
  }
  // включили снова — отправить свои текущие настройки как самые свежие
  if (on) void shareAll(Date.now());
}

const readLocal = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export const normalizePrefs = (raw: unknown): SharedPrefs => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<SharedPrefs>;
  return { v: { ...(o.v ?? {}) }, at: { ...(o.at ?? {}) } };
};

/** Слияние двух версий: каждая настройка — от той, где она изменена позже */
export function mergePrefs(local: unknown, remote: unknown): SharedPrefs {
  const a = normalizePrefs(local);
  const b = normalizePrefs(remote);
  const out: SharedPrefs = { v: { ...a.v }, at: { ...a.at } };
  for (const [f, t] of Object.entries(b.at)) {
    if ((Number(t) || 0) > (Number(out.at[f]) || 0)) {
      out.v[f] = b.v[f];
      out.at[f] = Number(t) || 0;
    }
  }
  return out;
}

/** записи по очереди: две быстрые правки не затрут друг друга */
let queue: Promise<unknown> = Promise.resolve();
function update(edit: (p: SharedPrefs) => boolean): Promise<void> {
  const run = queue.then(async () => {
    const p = normalizePrefs(await get(PREFS_KEY));
    if (edit(p)) await set(PREFS_KEY, p);
  });
  queue = run.catch(() => undefined);
  return run.catch(() => undefined);
}

function put(p: SharedPrefs, field: string, value: unknown, at: number): boolean {
  if (JSON.stringify(p.v[field] ?? null) === JSON.stringify(value ?? null) && (p.at[field] ?? 0) >= at) return false;
  p.v[field] = value ?? null;
  p.at[field] = at;
  return true;
}

/** Изменены настройки приложения (вызывает appStore.setSettings) */
export function shareSettings(patch: Partial<Settings>): Promise<void> {
  if (!prefsShared()) return Promise.resolve();
  const fields = SHARED_SETTINGS.filter((k) => k in patch);
  if (!fields.length) return Promise.resolve();
  const now = Date.now();
  return update((p) => fields.map((k) => put(p, settingField(k), patch[k], now)).some(Boolean));
}

/** Изменена настройка в localStorage (вызывают её сеттеры после записи) */
export function shareLocal(key: (typeof SHARED_LOCAL)[number]): Promise<void> {
  if (!prefsShared()) return Promise.resolve();
  const now = Date.now();
  return update((p) => put(p, localField(key), readLocal(key), now));
}

/** Все текущие настройки этого устройства — с отметкой at */
async function shareAll(at: number, onlyMissing = false): Promise<void> {
  const { useApp } = await import('./appStore');
  const s = useApp.getState().settings;
  const { DEFAULT_SETTINGS } = await import('./db');
  return update((p) => {
    let changed = false;
    for (const k of SHARED_SETTINGS) {
      const f = settingField(k);
      if (onlyMissing && (f in p.at || s[k] === undefined || s[k] === DEFAULT_SETTINGS[k])) continue;
      changed = put(p, f, s[k], at) || changed;
    }
    for (const k of SHARED_LOCAL) {
      const f = localField(k);
      const v = readLocal(k);
      if (onlyMissing && (f in p.at || v === null)) continue;
      changed = put(p, f, v, at) || changed;
    }
    return changed;
  });
}

/** Применить общие настройки к этому устройству; возвращает изменённые поля */
export async function applySharedPrefs(): Promise<string[]> {
  if (!prefsShared()) return [];
  const p = normalizePrefs(await get(PREFS_KEY));
  const { useApp } = await import('./appStore');
  const cur = useApp.getState().settings;
  const patch: Partial<Settings> = {};
  const changed: string[] = [];
  for (const k of SHARED_SETTINGS) {
    const f = settingField(k);
    if (!(f in p.at)) continue;
    const v = p.v[f];
    if (v === null || v === undefined || v === cur[k]) continue;
    (patch as Record<string, unknown>)[k] = v;
    changed.push(f);
  }
  if (changed.length) {
    const s = { ...cur, ...patch };
    useApp.setState({ settings: s });
    const { saveSettings } = await import('./db');
    await saveSettings(s);
  }
  for (const k of SHARED_LOCAL) {
    const f = localField(k);
    if (!(f in p.at)) continue;
    const v = (p.v[f] ?? null) as string | null;
    if (v === readLocal(k)) continue;
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, String(v));
      changed.push(f);
    } catch {
      /* хранилище недоступно */
    }
  }
  if (changed.length && typeof window !== 'undefined') window.dispatchEvent(new Event('sm-prefs-changed'));
  // утренние уведомления второго мозга — перепланировать
  if (changed.includes(localField('sm-brain-notify'))) void import('../tasks/sync').then((m) => m.syncSoon(300)).catch(() => undefined);
  return changed;
}

/**
 * Запуск (после загрузки настроек): настройки, заданные здесь до появления синхронизации настроек,
 * попадают в общий список с самым старым временем — их перекроет любая правка на другом устройстве;
 * затем применяется общий список.
 */
export async function initSharedPrefs(): Promise<void> {
  if (!prefsShared()) return;
  await shareAll(1, true);
  await applySharedPrefs();
}
