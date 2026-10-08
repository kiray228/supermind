/**
 * Неотправленные изменения: сколько правок ещё не дошло до облака и с какого времени.
 * Пересчёт — по событиям (правка, конец синхронизации, возвращение в приложение), с задержкой 300 мс;
 * без опроса базы по таймеру.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useCloud, isLocalOnly } from './cloud';
import { dirtyKeys, onDirty } from './kv';

interface PendingState {
  /** сколько изменённых ключей ждёт отправки */
  count: number;
  /** с какого времени есть неотправленное */
  since?: number;
  /** итог последней синхронизации (на время новой попытки не сбрасывается — значок не мигает) */
  problem: 'offline' | 'error' | null;
}

export const usePending = create<PendingState>(() => ({ count: 0, problem: null }));

/** Отметки с настоящим временем (при входе в аккаунт ключи помечаются отметкой 1) */
const REAL_TIME = 1_000_000_000_000;

/** Пересчитать сейчас; вернёт, сколько осталось неотправленного */
export async function recount(): Promise<number> {
  const d = await dirtyKeys();
  let count = 0;
  let oldest = Infinity;
  for (const [k, at] of Object.entries(d)) {
    if (isLocalOnly(k)) continue;
    count++;
    if (at > REAL_TIME && at < oldest) oldest = at;
  }
  const prev = usePending.getState();
  // время самой старой правки; если отметки без времени (вход в аккаунт) — когда заметили
  const since = !count ? undefined : oldest < Infinity ? oldest : (prev.since ?? Date.now());
  if (prev.count !== count || prev.since !== since) usePending.setState({ count, since });
  return count;
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function recountSoon(delay = 300) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void recount().catch(() => {});
  }, delay);
}

let started = false;
/** Подписаться на изменения (один раз, при первом показе индикатора) */
export function initPending() {
  if (started) return;
  started = true;
  onDirty(() => recountSoon());
  const settle = (status: string) => {
    const problem = status === 'offline' || status === 'error' ? status : null;
    if (usePending.getState().problem !== problem) usePending.setState({ problem });
  };
  settle(useCloud.getState().status);
  useCloud.subscribe((s, p) => {
    if (s.status === p.status && s.account === p.account) return;
    if (s.status !== 'syncing') {
      settle(s.status);
      recountSoon();
    }
  });
  // правки из другой вкладки этого же устройства
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && recountSoon());
  recountSoon(0);
}

/** Неотправленное + состояние облака для индикаторов */
export function usePendingSync() {
  useEffect(initPending, []);
  const pending = usePending();
  const account = useCloud((s) => !!s.account);
  const syncing = useCloud((s) => s.status === 'syncing');
  return { ...pending, account, syncing };
}

/** «5 изменений» */
export function changesText(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? 'изменение' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'изменения' : 'изменений';
  return `${n} ${w}`;
}

/** «14:32» сегодня, иначе «7 окт., 14:32» */
export function clockText(ms: number) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${time}`;
}
