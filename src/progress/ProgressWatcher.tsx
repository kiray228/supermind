/**
 * Поздравления в любом разделе: новый уровень, достижения, вехи серии (3, 7, 14… дней),
 * изредка — конфетти за выполненную задачу. Ничего не рисует; подключается в App один раз.
 */
import { useEffect } from 'react';
import { toast, useApp } from '../store/appStore';
import { useTasks } from '../tasks/store';
import { daysBetween, plural } from '../tasks/model';
import { todayYmd } from '../utils/mapTasks';
import { celebrate, celebrateTask } from '../ui/celebrate';
import { achievementStates } from './achievements';
import { useProgress } from './hooks';
import type { ProgressStats } from './model';
import { addFresh, readMilestones, readSeen, STREAK_MILESTONES, writeMilestones, writeSeen } from './seen';

// ---------- Очередь поздравлений: не перебивать «Отменить» и друг друга ----------

const queue: (() => void)[] = [];
let busy = false;

function pump() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  const run = (tries: number) => {
    // открыто уведомление с кнопкой («Отменить») — подождать, пока закроется
    if (useApp.getState().toastAction && tries < 16) return void setTimeout(() => run(tries + 1), 500);
    next();
    setTimeout(() => {
      busy = false;
      pump();
    }, 2800);
  };
  run(0);
}

function cheer(msg: string, big = false) {
  queue.push(() => {
    toast(msg);
    celebrate({ big });
  });
  pump();
}

// ---------- Уровень, достижения, вехи ----------

function streakText(n: number): string {
  if (n >= 365) return '🔥 Год без перерыва! Это невероятно';
  if (n >= 100) return `🔥 ${n} дней подряд — вы в редкой лиге!`;
  return `🔥 ${n} ${plural(n, 'день', 'дня', 'дней')} подряд — отличный ритм!`;
}

let lastActive: { day: string; on: boolean } | null = null;

function check(p: ProgressStats) {
  const states = achievementStates(p.counters);
  const unlocked = states.filter((s) => s.done).map((s) => s.a.id);
  const seen = readSeen();
  writeSeen({ level: Math.max(p.level.level, seen?.level ?? 0), ach: [...new Set([...(seen?.ach ?? []), ...unlocked])] });

  const streak = p.counters.streak;
  const ms = readMilestones();
  // серия прервалась — её вехи снова можно заработать
  const kept = (ms ?? []).filter((m) => m <= streak);
  const hit = ms ? STREAK_MILESTONES.filter((m) => m <= streak && !kept.includes(m)) : [];
  writeMilestones(ms ? [...kept, ...hit] : STREAK_MILESTONES.filter((m) => m <= streak));

  // сегодня впервые есть активность — убрать вечернее «серия под угрозой»
  const on = (p.dayTotal.get(p.today) ?? 0) > 0;
  if (on && lastActive && lastActive.day === p.today && !lastActive.on) void import('../tasks/sync').then((m) => m.syncSoon(800)).catch(() => {});
  lastActive = { day: p.today, on };

  // первый запуск на этом устройстве — только запомнить, без поздравлений
  if (!seen) return;
  const newAch = states.filter((s) => s.done && !seen.ach.includes(s.a.id));
  if (newAch.length) addFresh(newAch.map((s) => s.a.id));
  const up = p.level.level > seen.level;
  const many = (n: number) => `${n} ${plural(n, 'новое достижение', 'новых достижения', 'новых достижений')}`;
  if (up && newAch.length) cheer(`🎉 Уровень ${p.level.level} — «${p.level.title}»! И ${many(newAch.length)}`, true);
  else if (up) cheer(`🎉 Новый уровень ${p.level.level} — «${p.level.title}»!`, true);
  else if (newAch.length === 1) cheer(`🏆 Достижение получено: «${newAch[0].a.title}»`);
  else if (newAch.length > 1) cheer(`🏆 ${many(newAch.length)}!`);
  if (hit.length) cheer(streakText(Math.max(...hit)), true);
}

/** Выполненная задача: конфетти изредка и всегда — за давно просроченную */
function watchTasks(): () => void {
  let prev = useTasks.getState().data;
  return useTasks.subscribe((s) => {
    const old = prev;
    const d = (prev = s.data);
    if (!d || !old || d === old) return;
    const last = d.log[d.log.length - 1];
    const before = old.log[old.log.length - 1];
    // новая запись в журнале выполнения — только что, на этом устройстве
    if (!last || (before && last.at <= before.at) || Date.now() - last.at > 4000) return;
    const today = todayYmd();
    celebrateTask(last.date && last.date < today ? daysBetween(last.date, today) : 0);
  });
}

export default function ProgressWatcher() {
  const p = useProgress();
  useEffect(() => {
    if (p) check(p);
  }, [p]);
  useEffect(watchTasks, []);
  return null;
}
