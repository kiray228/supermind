/** Отметки привычек вне Ежедневника (из Календаря): читаем свежие данные, меняем день, сохраняем */
import type { Habit, PlannerData, PlannerDay } from '../types';
import { loadPlanner, savePlanner } from '../store/db';
import { syncSoon } from '../tasks/sync';
import { countOn, doneOn, withCount, withDone } from './model';

const emptyDay = (): PlannerDay => ({ journal: '', tasks: [] });

async function updateDay(ymd: string, fn: (d: PlannerDay) => PlannerDay): Promise<PlannerData> {
  const p = await loadPlanner();
  const days = { ...(p.days ?? {}) };
  days[ymd] = fn({ ...(days[ymd] ?? emptyDay()) });
  const next = { ...p, days, habits: p.habits ?? [] };
  await savePlanner(next);
  window.dispatchEvent(new Event('sm-planner-changed'));
  // выполненная сегодня привычка больше не напоминает
  syncSoon(1500);
  return next;
}

/** Переключить выполнение привычки за день; возвращает новое состояние (выполнена ли) */
export async function toggleHabitOn(h: Habit, ymd: string): Promise<boolean> {
  let done = false;
  await updateDay(ymd, (d) => {
    done = !doneOn({ [ymd]: d }, h, ymd);
    return withDone(d, h, done);
  });
  return done;
}

/** +1 к счётчику привычки за день */
export async function bumpHabitOn(h: Habit, ymd: string, delta = 1): Promise<number> {
  let n = 0;
  await updateDay(ymd, (d) => {
    n = countOn(d, h) + delta;
    return withCount(d, h, n);
  });
  return n;
}
