/**
 * Источники данных для опыта и хуки useProgress / useLevel.
 * Задачи, цели, финансы и заметки берутся из их хранилищ; ежедневник и список карт читаются из базы
 * (только чтение) и перечитываются при изменениях и при возвращении в приложение.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { DocMeta, PlannerData } from '../types';
import { get, onDirty } from '../store/kv';
import { listDocs } from '../store/db';
import { ensureTasks, useTasks } from '../tasks/store';
import { ensureGoals, useGoals } from '../goals/store';
import { ensureFinance, useFinance } from '../finance/store';
import { ensureNotes, useNotes } from '../notes/store';
import { todayYmd } from '../utils/mapTasks';
import { computeProgressCached, type LevelInfo, type ProgressStats } from './model';

interface ExtraState {
  planner: PlannerData | null;
  docs: DocMeta[] | null;
  /** сколько хранилищ уже загрузилось (или не смогло) */
  settled: number;
  /** меняется в полночь и при возвращении в приложение — чтобы «сегодня» было свежим */
  day: string;
}

const STORES = 4;

export const useProgressExtra = create<ExtraState>(() => ({ planner: null, docs: null, settled: 0, day: todayYmd() }));

let reading: Promise<void> | null = null;

/** Перечитать ежедневник и список карт */
export function refreshProgressSources(): Promise<void> {
  reading ??= (async () => {
    try {
      const [planner, docs] = await Promise.all([get<PlannerData>('planner').catch(() => undefined), listDocs().catch(() => [])]);
      const s = useProgressExtra.getState();
      useProgressExtra.setState({
        planner: planner && typeof planner === 'object' ? planner : (s.planner ?? { days: {}, habits: [] }),
        docs: Array.isArray(docs) ? docs : (s.docs ?? []),
        day: todayYmd(),
      });
    } finally {
      reading = null;
    }
  })();
  return reading;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void refreshProgressSources();
  }, 700);
}

let started = false;

/** Загрузить всё, что нужно для подсчёта опыта (один раз за запуск) */
export function ensureProgressSources() {
  if (started) return;
  started = true;
  const settle = () => useProgressExtra.setState((s) => ({ settled: s.settled + 1 }));
  for (const load of [ensureTasks, ensureGoals, ensureFinance, ensureNotes]) {
    try {
      load().then(settle, settle);
    } catch {
      settle();
    }
  }
  void refreshProgressSources();
  onDirty(scheduleRefresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefresh();
  });
  // смена дня, пока приложение открыто
  setInterval(() => {
    if (useProgressExtra.getState().day !== todayYmd()) useProgressExtra.setState({ day: todayYmd() });
  }, 60_000);
}

/** Весь подсчёт опыта. null — пока данные загружаются */
export function useProgress(): ProgressStats | null {
  useEffect(ensureProgressSources, []);
  const tasks = useTasks((s) => s.data);
  const goals = useGoals((s) => s.data);
  const finance = useFinance((s) => s.data);
  const notes = useNotes((s) => s.data);
  const planner = useProgressExtra((s) => s.planner);
  const docs = useProgressExtra((s) => s.docs);
  const settled = useProgressExtra((s) => s.settled);
  const day = useProgressExtra((s) => s.day);
  const ready = settled >= STORES && planner !== null && docs !== null;
  return useMemo(
    () => (ready ? computeProgressCached({ tasks, goals, finance, notes, planner, docs }, day) : null),
    [ready, tasks, goals, finance, notes, planner, docs, day],
  );
}

/** Текущий уровень (для значка где угодно). null — пока данные загружаются */
export function useLevel(): LevelInfo | null {
  return useProgress()?.level ?? null;
}
