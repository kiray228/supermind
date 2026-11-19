/**
 * Подключение к Apple «Здоровью» (iPhone) и Health Connect (Android): шаги по дням и сон.
 * Читаем только шаги и сон, только на этом телефоне; на сервер уходят лишь отметки привычек.
 */
import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';
import { addDaysYmd, todayYmd } from '../utils/mapTasks';
import { activeHabits, doneOn, dueOn } from '../habits/model';
import { loadPlanner } from '../store/db';
import { autoMarks, fellAsleepAt, sleepMinutes, type HealthDay, type SleepPiece } from './healthCore';

const LINK = 'sm-health-link';
const CACHE = 'sm-health-cache';
const MARKED = 'sm-health-marked';
const DAYS = 7;

export type HealthSource = 'apple' | 'connect';

/** Где брать данные на этом устройстве: iPhone — «Здоровье», Android 9+ — Health Connect */
export function healthSource(): HealthSource | null {
  if (!Capacitor.isNativePlatform()) return null;
  if (Capacitor.getPlatform() === 'ios') return 'apple';
  if (Capacitor.getPlatform() !== 'android') return null;
  // Health Connect — с Android 9 (на Android 8 его нельзя установить), плагин собран под Android 8+
  const m = navigator.userAgent.match(/Android (\d+)/);
  return m && +m[1] >= 9 ? 'connect' : null;
}

const read = <T,>(k: string): T | null => {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* нет хранилища — просто не запомним */
  }
};

export const isLinked = () => read<boolean>(LINK) === true;

export interface HealthState extends HealthDay {
  at: number;
}

const plugin = () => import('@capgo/capacitor-health').then((m) => m.Health);

export type LinkResult = 'ok' | 'denied' | 'unavailable' | 'install';

/** Попросить доступ к шагам и сну */
export async function linkHealth(): Promise<LinkResult> {
  if (!healthSource()) return 'unavailable';
  const Health = await plugin();
  const av = await Health.isAvailable().catch(() => ({ available: false, reason: '' }));
  if (!av.available) return /install|update|not installed|provider/i.test(av.reason ?? '') ? 'install' : 'unavailable';
  const st = await Health.requestAuthorization({ read: ['steps', 'sleep'] }).catch(() => null);
  if (!st) return 'denied';
  // iOS не сообщает, разрешено ли чтение (приватность): считаем подключённым, данные покажут сами
  if (Capacitor.getPlatform() === 'android' && !st.readAuthorized.includes('steps') && !st.readAuthorized.includes('sleep')) return 'denied';
  write(LINK, true);
  window.dispatchEvent(new Event('sm-health-changed'));
  return 'ok';
}

export function unlinkHealth() {
  try {
    localStorage.removeItem(LINK);
    localStorage.removeItem(CACHE);
  } catch {
    /* ничего */
  }
  window.dispatchEvent(new Event('sm-health-changed'));
}

/** Открыть системные настройки доступа (Health Connect) */
export async function openHealthSettings() {
  if (Capacitor.getPlatform() !== 'android') return;
  const Health = await plugin();
  await Health.openHealthConnectSettings().catch(() => undefined);
}

const startOf = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Прочитать шаги за неделю и сон за две последние ночи */
export async function readHealth(): Promise<HealthState | null> {
  if (!healthSource() || !isLinked()) return null;
  const Health = await plugin();
  const today = todayYmd();
  const first = addDaysYmd(today, -(DAYS - 1));
  const now = new Date();
  const steps: Record<string, number> = {};
  const agg = await Health.queryAggregated({ dataType: 'steps', startDate: startOf(first).toISOString(), endDate: now.toISOString(), bucket: 'day', aggregation: 'sum' }).catch(() => null);
  for (const s of agg?.samples ?? []) {
    const d = new Date(s.startDate);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    steps[ymd] = (steps[ymd] ?? 0) + Math.round(s.values?.sum ?? s.value ?? 0);
  }
  const yesterday = addDaysYmd(today, -1);
  const sleepRes = await Health.readSamples({ dataType: 'sleep', startDate: new Date(startOf(yesterday).getTime() - 6 * 3600_000).toISOString(), endDate: now.toISOString(), limit: 500 }).catch(() => null);
  const pieces = (sleepRes?.samples ?? []) as SleepPiece[];
  const sleep: Record<string, number> = {};
  const asleepAt: Record<string, number> = {};
  for (const d of [yesterday, today]) {
    const m = sleepMinutes(pieces, d);
    if (m > 0) sleep[d] = m;
    const at = fellAsleepAt(pieces, d);
    if (at != null) asleepAt[d] = at;
  }
  const state: HealthState = { at: Date.now(), steps, sleep, asleepAt };
  write(CACHE, state);
  await applyAutoMarks(state, today).catch(() => undefined);
  return state;
}

export const cachedHealth = () => read<HealthState>(CACHE);

/** Отметить привычки «шаги» и «сон» — один раз за день: снятую вручную отметку не возвращаем */
async function applyAutoMarks(state: HealthDay, today: string) {
  const p = await loadPlanner();
  const habits = activeHabits(p.habits);
  const marks = autoMarks(habits, state, today, (d) => addDaysYmd(d, -1));
  if (!marks.length) return;
  const seen = new Set(read<string[]>(MARKED) ?? []);
  const { toggleHabitOn, bumpHabitOn } = await import('../habits/store');
  const { isCounter, targetOf, countOn } = await import('../habits/model');
  let changed = false;
  for (const [h, d] of marks) {
    const key = `${h.id}|${d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cur = await loadPlanner();
    if (!dueOn(cur.days ?? {}, h, d) || doneOn(cur.days ?? {}, h, d)) continue;
    if (isCounter(h)) await bumpHabitOn(h, d, targetOf(h) - countOn(cur.days?.[d], h));
    else await toggleHabitOn(h, d);
    changed = true;
  }
  // помним последние 60 отметок
  write(MARKED, [...seen].slice(-60));
  if (changed) {
    window.dispatchEvent(new Event('sm-planner-changed'));
    const { syncSoon } = await import('../tasks/sync');
    syncSoon(1500);
  }
}

/** Данные «Здоровья» для экрана: сначала из кэша, затем свежие (и при возврате в приложение) */
export function useHealth(): { source: HealthSource | null; linked: boolean; data: HealthState | null; refresh: () => void } {
  const source = healthSource();
  const [linked, setLinked] = useState(isLinked);
  const [data, setData] = useState<HealthState | null>(() => (isLinked() ? cachedHealth() : null));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => {
      setLinked(isLinked());
      setTick((t) => t + 1);
    };
    window.addEventListener('sm-health-changed', on);
    document.addEventListener('visibilitychange', on);
    return () => {
      window.removeEventListener('sm-health-changed', on);
      document.removeEventListener('visibilitychange', on);
    };
  }, []);
  useEffect(() => {
    if (!source || !linked || document.visibilityState === 'hidden') return;
    let alive = true;
    void readHealth().then((s) => alive && s && setData(s));
    return () => {
      alive = false;
    };
  }, [source, linked, tick]);
  return { source, linked, data: linked ? data : null, refresh: () => setTick((t) => t + 1) };
}

/** При запуске приложения — обновить отметки привычек, если «Здоровье» подключено */
export function syncHealthOnStart() {
  if (!healthSource() || !isLinked()) return;
  void readHealth().catch(() => undefined);
}
