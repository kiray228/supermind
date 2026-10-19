import { registerPlugin } from '@capacitor/core';
import { get, set } from '../store/kv';
import { create } from 'zustand';
import type { PlannerData } from '../types';
import { isAndroidApp, isNative } from '../platform';
import { pushActive, uploadSchedule } from '../store/push';
import { useApp, toast } from '../store/appStore';
import { todayYmd, toYmd, addDaysYmd, fromYmd } from '../utils/mapTasks';
import { isIOS, downloadText } from '../io/download';
import { dayLabel, isActive, minutesOf, reminderFires, startAt, timeOf, whenLabel, type TaskItem } from './model';
import { buildIcs, taskDescription, toRRule, utcStamp } from './ics';
import { primeAlarmAudio, ringWeb, SmAlarm, stopWeb, type NativeAlarm } from './alarm';
import { completeOccurrence, getTask, openTask, tasksData, useTasks } from './store';
import * as hm from '../habits/model';

// ================= Нативные модули Android =================

export interface PhoneCalendar {
  id: string;
  name: string;
  account: string;
  color: string;
  writable: boolean;
  visible: boolean;
  primary: boolean;
}
export interface PhoneEvent {
  eventId: string;
  title: string;
  begin: number;
  end: number;
  allDay: boolean;
  color: string;
  calendar: string;
  location?: string;
  calendarId: string;
}

interface SmCalendarPlugin {
  checkAccess(): Promise<{ granted: boolean }>;
  requestAccess(): Promise<{ granted: boolean }>;
  listCalendars(): Promise<{ calendars: PhoneCalendar[] }>;
  upsertEvent(o: { id?: string; taskId?: string; calendarId?: string; title: string; description: string; start: number; end: number; allDay: boolean; rrule?: string; exdate?: string }): Promise<{ id: string }>;
  deleteEvents(o: { ids: string[] }): Promise<{ deleted: number }>;
  listEvents(o: { from: number; to: number }): Promise<{ events: PhoneEvent[] }>;
  insertWithPrompt(o: { title: string; description: string; start: number; end: number; allDay: boolean; rrule?: string }): Promise<void>;
}

export const SmCalendar = registerPlugin<SmCalendarPlugin>('SmCalendar');

// объект плагина Capacitor нельзя возвращать из Promise (он «thenable») — возвращаем модуль целиком
const notifications = () => import('@capacitor/local-notifications');

// ================= Всплывающие напоминания внутри приложения =================

export interface InAppReminder {
  key: string;
  taskId?: string;
  habitId?: string;
  /** дата повтора, о котором напоминание */
  date?: string;
  title: string;
  body: string;
  /** платёж или утренний брифинг — только «Открыть» */
  payId?: string;
  briefing?: boolean;
  /** вечернее «серия под угрозой» (без привычки — «Открыть» ведёт в «Привычки») */
  saver?: boolean;
  /** срок цели — «Открыть» ведёт в цель */
  goalId?: string;
  /** второй мозг: вопрос дня или карточка (данные уведомления — в extra) */
  brain?: string;
  extra?: Record<string, string>;
  /** будильник: звенит, пока не выключат */
  alarm?: boolean;
}
export const useReminders = create<{ items: InAppReminder[] }>(() => ({ items: [] }));
export const dismissReminder = (key: string) => useReminders.setState((s) => ({ items: s.items.filter((i) => i.key !== key) }));
// будильник замолкает, когда на экране не осталось будильников (выключили, отложили или отметили)
useReminders.subscribe((s) => {
  if (!s.items.some((i) => i.alarm)) stopWeb();
});

// ================= Разрешения =================

export type NotifyPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export async function notifyPermission(): Promise<NotifyPermission> {
  if (isNative()) {
    const { LocalNotifications: LN } = await notifications();
    const p = await LN.checkPermissions();
    return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : (Notification.permission as NotifyPermission);
}

/** Запросить разрешение на уведомления (вызывать по нажатию пользователя) */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  try {
    if (isNative()) {
      const { LocalNotifications: LN } = await notifications();
      const p = await LN.requestPermissions();
      void syncSoon(0);
      return p.display === 'granted' ? 'granted' : 'denied';
    }
    if (typeof Notification === 'undefined') return 'unsupported';
    const r = await Notification.requestPermission();
    return r === 'default' ? 'prompt' : (r as NotifyPermission);
  } catch {
    return 'denied';
  }
}

/** Точные будильники (Android 12+): без них напоминание может прийти с опозданием */
export async function exactAlarmState(): Promise<'granted' | 'denied' | 'n/a'> {
  if (!isNative()) return 'n/a';
  try {
    const { LocalNotifications: LN } = await notifications();
    const r = await LN.checkExactNotificationSetting();
    return r.exact_alarm === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'n/a';
  }
}
export async function openExactAlarmSettings() {
  const { LocalNotifications: LN } = await notifications();
  await LN.changeExactNotificationSetting().catch(() => {});
}

/** При первом напоминании — спросить разрешение (по нажатию пользователя) */
export async function askNotifyIfNeeded() {
  const d = tasksData();
  if (!d?.prefs.notify) return;
  if ((await notifyPermission()) === 'prompt') {
    const r = await requestNotifyPermission();
    if (r === 'denied') toast('Уведомления запрещены — напоминания будут видны только в приложении');
  }
}

// ================= Расписание напоминаний =================

const HORIZON_DAYS = 21;
const MAX_NATIVE = 350;

export interface Planned {
  id: number;
  at: number;
  title: string;
  body: string;
  extra: Record<string, string | number>;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // id уведомления — положительное 31-битное число, не пересекается с «отложенными» (ниже 1e6)
  return 1_000_000 + ((h >>> 0) % 2_000_000_000);
}

function reminderBody(t: TaskItem, date: string, at = Date.now()): string {
  // «Сегодня/Завтра» — относительно момента, когда уведомление покажется
  const w = whenLabel({ date, time: t.time, duration: t.duration }, toYmd(new Date(at)));
  const list = tasksData()?.lists.find((l) => l.id === t.listId);
  const extra = t.checklist.length ? ` · ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}` : '';
  return [w, list && list.id !== 'inbox' ? list.name : '', t.notes?.split('\n')[0]?.slice(0, 80) ?? ''].filter(Boolean).join(' · ') + extra;
}

/** Расписание напоминаний (для уведомлений Android и для push-сервера) */
export function planReminders(fromMs: number, toMs: number): Promise<Planned[]> {
  return plan(fromMs, toMs);
}

const isActiveTask = (id: string) => {
  const t = getTask(id);
  return !!t && isActive(t);
};

/** Отложенные напоминания веб-версии — тоже уходят на push-сервер */
export function pendingWebSnoozes(): { at: number; taskId: string; title: string }[] {
  // задачу уже выполнили — отложенное напоминание не нужно
  return webSnoozes.filter((s) => s.at > Date.now() && isActiveTask(s.taskId)).map((s) => ({ ...s, title: getTask(s.taskId)?.title ?? 'Задача' }));
}

async function plan(fromMs: number, toMs: number): Promise<Planned[]> {
  const d = tasksData();
  if (!d || !d.prefs.notify) return [];
  const out: Planned[] = [];
  // повторы «настойчивого» напоминания идут ещё 3×nag минут после основного — смотрим и чуть назад,
  // иначе пересчёт расписания после основного напоминания отменял бы уже запланированные повторы
  const back = d.prefs.nag > 0 ? 3 * d.prefs.nag * 60000 : 0;
  for (const f of reminderFires(d.tasks, fromMs - back, toMs)) {
    const base = { taskId: f.task.id, date: f.date, sm: 1, ...(f.task.alarm ? { alarm: 1 } : {}) };
    if (f.at >= fromMs)
      out.push({ id: hash(`${f.task.id}|${f.date}|${f.offset}`), at: f.at, title: (f.task.alarm ? '⏰ ' : '') + (f.task.title || 'Задача'), body: reminderBody(f.task, f.date, f.at), extra: base });
    // «настойчивое» напоминание — ещё 3 раза, пока задача не выполнена (будильник звенит и так)
    if (d.prefs.nag > 0 && !f.task.alarm && f.offset === Math.max(...f.task.reminders) && !nagSnoozed(f.task.id, f.date))
      for (let k = 1; k <= 3; k++) {
        const at = f.at + k * d.prefs.nag * 60000;
        if (at >= fromMs && at <= toMs) out.push({ id: hash(`${f.task.id}|${f.date}|nag${k}`), at, title: '⏰ ' + (f.task.title || 'Задача'), body: 'Ещё не выполнено · ' + reminderBody(f.task, f.date, at), extra: base });
      }
  }
  // платежи по подпискам (раздел «Финансы»): напоминание в 09:00 за указанное число дней
  // финансы в памяти (если раздел уже загружен) — без чтения всего блока из базы на каждое изменение задач
  const finMem = (await import('../finance/store').catch(() => null))?.useFinance.getState().data;
  const fin = finMem ?? (await get<import('../finance/model').FinanceData>('finance').catch(() => undefined));
  if (fin?.subscriptions?.length) {
    const { upcomingPayments } = await import('../finance/model');
    const fromDay = toYmd(new Date(fromMs));
    for (const pay of upcomingPayments(fin, fromDay, toYmd(new Date(toMs + 31 * 86400000)))) {
      if (pay.remindDays < 0) continue;
      const day = addDaysYmd(pay.date, -pay.remindDays);
      const at = fromYmd(day).getTime() + 9 * 3600000;
      if (at < fromMs || at > toMs) continue;
      const amount = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: pay.currency, maximumFractionDigits: 2 }).format(pay.amount);
      out.push({
        id: hash(`pay|${pay.id}`),
        at,
        title: `${pay.income ? '💰' : '💳'} ${pay.title}`,
        body: `${pay.income ? 'Поступление' : 'Платёж'} ${pay.remindDays === 0 ? 'сегодня' : dayLabel(pay.date, day).toLowerCase()} · ${pay.income ? '+' : ''}${amount}`,
        extra: { payId: pay.id, date: pay.date, sm: 1 },
      });
    }
  }
  // долги (раздел «Финансы»): напоминание в 09:00 в день «вернуть до»
  for (const x of fin?.debts ?? []) {
    if (x.closed || !x.dueDate || x.remind === false) continue;
    const at = fromYmd(x.dueDate).getTime() + 9 * 3600000;
    if (at < fromMs || at > toMs) continue;
    const paid = (x.payments ?? []).reduce((a, q) => a + q.amount, 0);
    const left = Math.max(0, x.amount - paid);
    if (!(left > 0)) continue;
    const amount = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: x.currency, maximumFractionDigits: 2 }).format(left);
    out.push({
      id: hash(`debt|${x.id}|${x.dueDate}`),
      at,
      title: x.kind === 'owe' ? `🤝 Вернуть долг: ${x.person}` : `🤝 ${x.person}: пора вернуть долг`,
      body: x.kind === 'owe' ? `Сегодня срок — верните ${amount}` : `Сегодня срок — вам должны вернуть ${amount}`,
      extra: { payId: `debt:${x.id}`, date: x.dueDate, sm: 1 },
    });
  }
  // сроки целей и этапов: за неделю, накануне и в день срока, в 09:00
  try {
    const [{ ensureGoals }, { goalReminders }, { makeTaskLookup }] = await Promise.all([import('../goals/store'), import('../goals/reminders'), import('../goals/model')]);
    const goals = await ensureGoals();
    // накопительные цели считаются по счёту: без загруженных финансов их прогресс был бы 0%
    if (goals.goals.some((g) => g.mode === 'savings' && g.status === 'active')) await (await import('../finance/store')).ensureFinance().catch(() => undefined);
    for (const r of goalReminders(goals, makeTaskLookup(d.tasks), toYmd(new Date(fromMs)), toYmd(new Date(toMs)))) {
      const at = fromYmd(r.day).getTime() + 9 * 3600000;
      if (at < fromMs || at > toMs) continue;
      out.push({ id: hash(r.key), at, title: r.title, body: r.body, extra: { goalId: r.goalId, date: r.day, sm: 1 } });
    }
  } catch {
    /* цели не загрузились — остальные напоминания всё равно */
  }
  const p = await get<PlannerData>('planner').catch(() => undefined);
  // утренний брифинг: что на сегодня (пересчитывается при каждом изменении задач)
  const brief = d.prefs.briefing ?? '08:00';
  if (brief) {
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const day = addDaysYmd(toYmd(new Date(fromMs)), i);
      const at = fromYmd(day).getTime() + minutesOf(brief) * 60000;
      if (at < fromMs || at > toMs) continue;
      // из «второго мозга»: карточки на день и давняя заметка к задачам дня
      const ids = d.tasks.filter((t) => isActive(t) && t.date === day).map((t) => t.id);
      const brain = await import('../notes/brainBrief').then((m) => m.brainBriefFor(day, ids).then(m.briefParts)).catch(() => ({}));
      out.push({ id: hash(`brief|${day}`), at, ...briefingFor(d.tasks, p, day, brain), extra: { briefing: 1, date: day, sm: 1 } });
    }
  }
  // второй мозг: вопрос дня и карточка — сразу после «Плана на день»
  const brainN = await import('../notes/brainNotify').then((m) => m.planBrainNotifications(fromMs, toMs, brief)).catch(() => []);
  for (const b of brainN) out.push({ id: hash(b.key), at: b.at, title: b.title, body: b.body, extra: { ...b.extra, sm: 1 } });
  // привычки с напоминанием: только в запланированные дни и пока не выполнены
  if (p?.habits?.length) {
    const pdays = p.days ?? {};
    for (const h of hm.activeHabits(p.habits)) {
      const times = hm.reminderTimesOf(h);
      // несколько раз в день — напоминание на каждый приём, пока он не отмечен
      const slots = hm.timesOf(h).length;
      for (let i = 0; i <= HORIZON_DAYS; i++) {
        const day = addDaysYmd(toYmd(new Date(fromMs)), i);
        if (hm.doneOn(pdays, h, day) || !hm.dueOn(pdays, h, day)) continue;
        const count = hm.countOn(pdays[day], h);
        times.forEach((time, k) => {
          if (slots && count > k) return;
          const at = fromYmd(day).getTime() + minutesOf(time) * 60000;
          if (at < fromMs || at > toMs) return;
          if (slots) {
            out.push({
              id: hash(k ? `habit|${h.id}|${day}|${k}` : `habit|${h.id}|${day}`),
              at,
              title: `${h.icon ?? '💊'} ${h.name}`,
              body: `${k + 1}-й раз из ${slots} сегодня (${time}) — отметьте, когда сделаете`,
              extra: { habitId: h.id, date: day, sm: 1 },
            });
            return;
          }
          const t = hm.targetOf(h);
          const left = hm.freqOf(h) === 'weekly' ? hm.weekGoal(pdays, h, day) - hm.weekCount(pdays, h, day, day) : 0;
          const body =
            t > 1
              ? `Цель на сегодня: ${h.unit ? `${h.unit} ` : ''}×${t}${h.duration ? ` · ${hm.durationLabel(h.duration)}` : ''}`
              : left > 0
                ? `Ещё ${left} ${hm.plural(left, ['раз', 'раза', 'раз'])} на этой неделе — отметьте выполнение`
                : `Привычка на сегодня${h.duration ? ` · ${hm.durationLabel(h.duration)}` : ''} — отметьте выполнение`;
          out.push({ id: hash(`habit|${h.id}|${day}`), at, title: `${h.icon ?? '🔥'} ${h.name}`, body, extra: { habitId: h.id, date: day, sm: 1 } });
        });
      }
    }
  }
  await planStreakSaver(d.prefs.streakSaver, p, fromMs, toMs, out);
  return out.sort((a, b) => a.at - b.at);
}

export const STREAK_SAVER_DEFAULT = '20:30';

/** Время «серия под угрозой» ('' — выключено): по умолчанию включено, только если уведомления уже разрешены */
export async function streakSaverTime(pref: string | undefined): Promise<string> {
  if (pref !== undefined) return pref;
  return (await notifyPermission().catch(() => 'unsupported')) === 'granted' ? STREAK_SAVER_DEFAULT : '';
}

/**
 * Вечернее «серия под угрозой»: не больше одного в день, только при общей серии от 2 дней
 * и пока сегодня нет активности. Сегодня — по факту; завтра — если сегодня уже активны
 * (с первой активностью завтра расписание пересчитается и напоминание исчезнет).
 */
async function planStreakSaver(pref: string | undefined, p: PlannerData | undefined, fromMs: number, toMs: number, out: Planned[]) {
  const time = await streakSaverTime(pref);
  if (!time) return;
  const today = todayYmd();
  const days = [today, addDaysYmd(today, 1)].filter((day) => {
    const at = fromYmd(day).getTime() + minutesOf(time) * 60000;
    return at >= fromMs && at <= toMs;
  });
  if (!days.length) return;
  const { progressNow } = await import('../progress/hooks');
  const stats = await progressNow(p ?? null).catch(() => null);
  if (!stats) return;
  const activeToday = (stats.dayTotal.get(today) ?? 0) > 0;
  const streak = stats.counters.streak;
  if (streak < 2) return;
  for (const day of days) {
    if ((day === today) === activeToday) continue;
    const pdays = p?.days ?? {};
    const h = hm.activeHabits(p?.habits).find((x) => hm.dueOn(pdays, x, day) && !hm.doneOn(pdays, x, day));
    const n = `${streak} ${hm.plural(streak, ['день', 'дня', 'дней'])}`;
    out.push({
      id: hash(`saver|${day}`),
      at: fromYmd(day).getTime() + minutesOf(time) * 60000,
      title: '🔥 Сохраните серию',
      body: h ? `Серия ${n} 🔥 — отметьте «${h.name}», это 10 секунд` : `Серия ${n} 🔥 — отметьте одну привычку или задачу, это 10 секунд`,
      extra: h ? { habitId: h.id, saver: 1, date: day, sm: 1 } : { saver: 1, date: day, sm: 1 },
    });
  }
}

/** Текст утреннего уведомления на день */
export function briefingFor(tasks: TaskItem[], p: PlannerData | undefined, day: string, brain: { part?: string; tail?: string } = {}): { title: string; body: string } {
  const active = tasks.filter((t) => isActive(t) && t.date);
  const today = active.filter((t) => t.date === day).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.time ?? '99').localeCompare(b.time ?? '99'));
  // «завтра» — один раз, а не для каждой задачи
  const overdue = day <= addDaysYmd(toYmd(new Date()), 1) ? active.filter((t) => t.date! < day).length : 0;
  const due = p ? hm.activeHabits(p.habits ?? []).filter((h) => hm.dueOn(p.days ?? {}, h, day)) : [];
  const habits = due.filter((h) => !hm.doneOn(p?.days ?? {}, h, day)).length;
  const parts: string[] = [];
  parts.push(today.length ? `Задач на сегодня: ${today.length}` : 'Задач на сегодня нет');
  if (overdue) parts.push(`просрочено: ${overdue}`);
  if (habits) parts.push(habits < due.length ? `привычки: осталось ${habits} из ${due.length}` : `привычек: ${habits}`);
  if (brain.part) parts.push(brain.part);
  let body = parts.join(' · ');
  if (today[0]) {
    const t = today[0].time;
    body += `. Главное: ${today[0].title || 'Задача'}${t ? ` в ${t}` : ''}`;
  }
  // «Перечитать» — только если влезает целиком
  if (brain.tail && body.length + brain.tail.length + 2 <= 180) body += `. ${brain.tail}`;
  return { title: '☀️ Доброе утро! План на день', body: body.length > 180 ? body.slice(0, 177) + '…' : body };
}

let nativeReady: Promise<void> | null = null;

function setupNative(): Promise<void> {
  if (nativeReady) return nativeReady;
  nativeReady = (async () => {
    const { LocalNotifications: LN } = await notifications();
    await LN.createChannel({
      id: 'sm-reminders',
      name: 'Напоминания о задачах',
      description: 'Сроки задач, повторы и привычки',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#007AFF',
    }).catch(() => {});
    await LN.registerActionTypes({
      types: [
        {
          id: 'sm-task',
          actions: [
            { id: 'done', title: '✓ Выполнено' },
            { id: 'snooze10', title: 'Отложить 10 мин' },
            { id: 'snooze60', title: 'Через час' },
          ],
        },
        { id: 'sm-habit', actions: [{ id: 'habit-done', title: '✓ Отметить' }] },
        ...(await import('../notes/brainNotify').then((m) => m.BRAIN_ACTION_TYPES).catch(() => [])),
      ],
    }).catch(() => {});
    await LN.addListener('localNotificationActionPerformed', (e) => {
      const ex = (e.notification.extra ?? {}) as Record<string, string>;
      void handleAction(e.actionId, ex, e.inputValue);
    });
  })();
  return nativeReady;
}

/** Действие из уведомления: выполнено / отложить / открыть; input — текст, набранный в шторке */
async function handleAction(action: string, ex: Record<string, string>, input?: string) {
  if (ex.brain) {
    await import('../notes/brainNotify').then((m) => m.brainAction(action, ex, input));
    return;
  }
  const { ensureTasks } = await import('./store');
  await ensureTasks();
  if (ex.habitId) {
    if (action === 'habit-done') {
      const p = await get<PlannerData>('planner');
      if (p) {
        const h = p.habits?.find((x) => x.id === ex.habitId);
        const day = (p.days[ex.date] ??= { journal: '', tasks: [] });
        if (h && hm.timesOf(h).length) {
          // несколько раз в день — отметить один приём
          p.days[ex.date] = hm.withCount(day, h, hm.countOn(day, h) + 1);
        } else if (h) {
          // счётчик — сразу до цели дня
          p.days[ex.date] = hm.withDone(day, h, true);
        } else day.habits = [...new Set([...(day.habits ?? []), ex.habitId])];
        await (await import('../store/db')).savePlanner(p);
        window.dispatchEvent(new Event('sm-planner-changed'));
        // отмечена — оставшиеся напоминания о ней сегодня и «серия под угрозой» не нужны
        syncSoon(500);
        toast('Привычка отмечена');
      }
    } else useApp.getState().go('planner');
    return;
  }
  if (ex.saver) {
    useApp.getState().go('habits');
    return;
  }
  if (ex.goalId) {
    useApp.getState().go('goals');
    const { ensureGoals, openGoal } = await import('../goals/store');
    await ensureGoals();
    openGoal(ex.goalId);
    return;
  }
  if (ex.payId) {
    useApp.getState().go('finance');
    return;
  }
  if (ex.briefing) {
    useApp.getState().go('assistant');
    return;
  }
  // новое обращение в поддержку (push владельцу) — «Входящие»
  if (ex.inbox) {
    useApp.getState().go('settings');
    (await import('../ui/SupportInbox')).openInbox();
    return;
  }
  const t = ex.taskId ? getTask(ex.taskId) : undefined;
  if (!t) return;
  if (action === 'done') {
    if (!completeOccurrence(t.id, ex.date || undefined)) toast('Эта задача уже выполнена');
  } else if (action === 'snooze10' || action === 'snooze60' || action === 'snooze') {
    await snoozeOne(t, action === 'snooze60' ? 60 : 10, ex.date || undefined);
  } else {
    useApp.getState().go('tasks');
    openTask(t.id);
  }
}

/** Отложенное напоминание (не трогает срок задачи) */
// ---------- Отложенные «настойчивые» напоминания ----------

const NAG_KEY = 'sm-nag-snoozed';

function nagSnoozes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(NAG_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/** Этот повтор отложили — повторы «настойчивого» напоминания больше не нужны (отложенное придёт само) */
function nagSnoozed(taskId: string, date: string): boolean {
  return !!nagSnoozes()[`${taskId}|${date}`];
}

function snoozeNag(taskId: string, date: string) {
  const m = nagSnoozes();
  // старше двух суток — уже не нужны
  for (const [k, at] of Object.entries(m)) if (at < Date.now() - 2 * 86400000) delete m[k];
  m[`${taskId}|${date}`] = Date.now();
  try {
    localStorage.setItem(NAG_KEY, JSON.stringify(m));
  } catch {
    /* не страшно */
  }
}

/** forDate — день повтора, о котором было уведомление (у просроченной повторяющейся задачи t.date — другой день) */
async function snoozeOne(t: TaskItem, minutes: number, forDate?: string) {
  const date = forDate || t.date;
  if (date) snoozeNag(t.id, date);
  const at = Date.now() + minutes * 60000;
  if (isNative()) {
    const { LocalNotifications: LN } = await notifications();
    if (date) await LN.cancel({ notifications: [1, 2, 3].map((k) => ({ id: hash(`${t.id}|${date}|nag${k}`) })) }).catch(() => {});
    await LN.schedule({
      notifications: [
        {
          // 1..700000: не пересекается с напоминаниями (от 1 000 000) и таймером фокуса (777001)
          id: Math.floor(Math.random() * 700_000) + 1,
          title: t.title || 'Задача',
          body: 'Отложено · ' + reminderBody(t, date ?? todayYmd()),
          schedule: { at: new Date(at), allowWhileIdle: true },
          channelId: 'sm-reminders',
          actionTypeId: 'sm-task',
          extra: { taskId: t.id, date: date ?? '', sm: 1, snooze: 1 },
        },
      ],
    });
  } else {
    webSnoozes.push({ at, taskId: t.id });
    saveWebSnoozes();
    void uploadSchedule(true);
  }
  toast(`Напомню через ${minutes === 60 ? 'час' : minutes + ' мин'}`);
}

async function syncNative() {
  // задачи ещё не загружены — пустое расписание отменило бы все уведомления и будильники
  if (!tasksData()) return;
  await setupNative();
  const { LocalNotifications: LN } = await notifications();
  if ((await notifyPermission()) !== 'granted') {
    // уведомления запретили: будильники без уведомления нечем выключить — снять все (и выполненные не зазвонят)
    await syncAlarms([]);
    try {
      const left = (await SmAlarm.list()).alarms.map((x) => x.id);
      if (left.length) await SmAlarm.cancel({ ids: left });
    } catch {
      /* без плагина будильника */
    }
    return;
  }
  const now = Date.now();
  const planned = (await plan(now + 5000, now + HORIZON_DAYS * 86400000)).slice(0, MAX_NATIVE);
  // будильники — системным будильником Android (звонит, пока не выключат); без нативного плагина — обычным уведомлением
  const alarmsOk = await syncAlarms(planned.filter((p) => p.extra.alarm));
  const want = alarmsOk ? planned.filter((p) => !p.extra.alarm) : planned;
  const pending = (await LN.getPending()).notifications;
  const sig = (p: { title?: string; body?: string; at: number }) => `${p.at}|${p.title}|${p.body}`;
  const wantById = new Map(want.map((w) => [w.id, w]));
  const cancel: { id: number }[] = [];
  const have = new Set<number>();
  for (const n of pending) {
    const ex = (n.extra ?? {}) as Record<string, unknown>;
    if (!ex.sm) continue;
    // отложенное («через 10 мин») не трогаем, пока задача не выполнена
    if (ex.snooze) {
      if (typeof ex.taskId === 'string' && !isActiveTask(ex.taskId)) cancel.push({ id: n.id });
      continue;
    }
    const w = wantById.get(n.id);
    if (!w || ex.sig !== sig(w)) cancel.push({ id: n.id });
    else have.add(n.id);
  }
  if (cancel.length) await LN.cancel({ notifications: cancel });
  const add = want.filter((w) => !have.has(w.id));
  for (let i = 0; i < add.length; i += 60) {
    await LN.schedule({
      notifications: add.slice(i, i + 60).map((w) => ({
        id: w.id,
        title: w.title,
        body: w.body,
        largeBody: w.body,
        schedule: { at: new Date(w.at), allowWhileIdle: true },
        channelId: 'sm-reminders',
        actionTypeId: w.extra.brain === 'question' ? 'sm-question' : w.extra.brain === 'cards' ? 'sm-card' : w.extra.habitId ? 'sm-habit' : w.extra.payId || w.extra.briefing || w.extra.saver || w.extra.goalId ? undefined : 'sm-task',
        autoCancel: true,
        extra: { ...w.extra, sig: sig(w) },
      })),
    });
  }
}

/** Расписание будильников в нативный плагин; false — плагина нет (старая сборка), будильники уйдут уведомлениями */
/** «2026-10-20 09:00» — время будильника «как на часах» (для смены часового пояса) */
const localStamp = (ms: number) => {
  const d = new Date(ms);
  return `${toYmd(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

async function syncAlarms(list: Planned[]): Promise<boolean> {
  try {
    const alarms: NativeAlarm[] = list.slice(0, 100).map((p) => ({
      id: p.id,
      at: p.at,
      title: p.title.replace(/^⏰ /, ''),
      body: p.body,
      taskId: String(p.extra.taskId ?? ''),
      date: String(p.extra.date ?? ''),
      local: localStamp(p.at),
    }));
    await SmAlarm.sync({ alarms });
    // отложенные на самом будильнике: задачу уже выполнили — не звонить
    const stale = (await SmAlarm.list()).alarms.filter((a) => a.snooze && a.taskId && !isActiveTask(a.taskId)).map((a) => a.id);
    if (stale.length) await SmAlarm.cancel({ ids: stale });
    return true;
  } catch {
    return false;
  }
}

/** «Готово», нажатое на будильнике, — отметить задачу (сразу или при следующем открытии приложения) */
async function takeAlarmActions() {
  try {
    const { actions } = await SmAlarm.takeActions();
    if (!actions.length) return;
    const { ensureTasks } = await import('./store');
    await ensureTasks();
    let n = 0;
    for (const a of actions) if (a.action === 'done' && a.taskId && completeOccurrence(a.taskId, a.date || undefined)) n++;
    if (n) toast(n === 1 ? 'Задача отмечена с будильника' : `Отмечено с будильника: ${n}`);
  } catch {
    /* старая сборка без будильников */
  }
}

/** Проверка будильника: на Android — настоящий, в веб-версии — сигнал на 5 секунд */
export async function testAlarm() {
  if (isAndroidApp()) {
    await SmAlarm.test();
    return;
  }
  ringWeb();
  setTimeout(stopWeb, 5000);
}

/** Android 14+: разрешено ли показывать будильник поверх экрана блокировки */
export async function alarmFullScreen(): Promise<'granted' | 'denied' | 'n/a'> {
  if (!isNative()) return 'n/a';
  try {
    return (await SmAlarm.fullScreenAllowed()).allowed ? 'granted' : 'denied';
  } catch {
    return 'n/a';
  }
}
export const openAlarmFullScreenSettings = () => SmAlarm.openFullScreenSettings().catch(() => {});

// ---------- Веб (браузер, PWA на iPhone/Android): уведомления, пока приложение открыто ----------

const LAST_KEY = 'sm-notify-last';
let webTimer: ReturnType<typeof setInterval> | null = null;
let webSnoozes: { at: number; taskId: string }[] = [];
function saveWebSnoozes() {
  try {
    localStorage.setItem('sm-snoozes', JSON.stringify(webSnoozes));
  } catch {
    /* нет доступа к хранилищу */
  }
}

async function showWeb(title: string, body: string, data: Record<string, string>) {
  const key = `${data.taskId ?? data.habitId ?? data.payId ?? data.goalId ?? data.brain ?? 'brief'}|${data.date ?? ''}|${Date.now()}`;
  const alarm = data.alarm === '1';
  // будильник — и когда окно свёрнуто: звенит, пока не выключат
  if (document.visibilityState === 'visible' || alarm) {
    useReminders.setState((s) => ({ items: [...s.items.filter((i) => i.taskId !== data.taskId || !data.taskId), { key, taskId: data.taskId, habitId: data.habitId, payId: data.payId, briefing: !!data.briefing, saver: !!data.saver, ...(data.goalId ? { goalId: data.goalId } : {}), ...(data.brain ? { brain: data.brain, extra: data } : {}), ...(alarm ? { alarm } : {}), date: data.date || undefined, title, body }] }));
    if (alarm) ringWeb();
    else playChime();
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // с push системное уведомление присылает сервер — второе не нужно
  if (pushActive()) return;
  const opts: NotificationOptions & { actions?: { action: string; title: string }[]; requireInteraction?: boolean } = {
    body,
    tag: `${data.taskId ?? data.habitId ?? data.payId ?? data.goalId ?? data.brain ?? 'brief'}|${data.date ?? ''}`,
    icon: './icon-192.png',
    badge: './icon-192.png',
    data,
    requireInteraction: alarm || !!tasksData()?.prefs.nag,
    ...(alarm ? { vibrate: [800, 400, 800, 400, 800, 400, 800], renotify: true } : {}),
    actions: data.taskId
      ? [
          { action: 'done', title: '✓ Выполнено' },
          { action: 'snooze', title: 'Отложить 10 мин' },
        ]
      : [],
  };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch {
    try {
      new Notification(title, { body });
    } catch {
      /* браузер не поддерживает */
    }
  }
}

async function webTick() {
  const now = Date.now();
  let last = now - 60000;
  try {
    last = Number(localStorage.getItem(LAST_KEY)) || last;
  } catch {
    /* ignore */
  }
  // пропущенные, пока приложение было закрыто, — не старше 12 часов
  const from = Math.max(last + 1, now - 12 * 3600000);
  // отрезок времени «занимаем» сразу: проверка по таймеру и по возврату в приложение
  // могут идти одновременно (plan ждёт базу) — иначе одно напоминание покажется дважды
  try {
    localStorage.setItem(LAST_KEY, String(Math.max(now, last)));
  } catch {
    /* ignore */
  }
  if (from <= now) {
    const due = await plan(from, now);
    // при открытии после долгого перерыва не засыпаем уведомлениями: максимум 5
    for (const p of due.slice(-5)) await showWeb(p.title, p.body, Object.fromEntries(Object.entries(p.extra).map(([k, v]) => [k, String(v)])));
  }
  const fire = webSnoozes.filter((s) => s.at <= now);
  if (fire.length) {
    webSnoozes = webSnoozes.filter((s) => s.at > now);
    saveWebSnoozes();
    for (const s of fire) {
      const t = getTask(s.taskId);
      if (t && !t.done) await showWeb((t.alarm ? '⏰ ' : '') + t.title, 'Отложенное напоминание · ' + reminderBody(t, t.date ?? todayYmd()), { taskId: t.id, date: t.date ?? '', ...(t.alarm ? { alarm: '1' } : {}) });
    }
  }
}

let audio: AudioContext | null = null;
function playChime() {
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.5);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.18);
      o.stop(t0 + i * 0.18 + 0.55);
    }
  } catch {
    /* звук недоступен */
  }
}

// ================= Календарь телефона (Android) =================

const CAL_INDEX = 'calsync';
const CAL_LOCAL = 'sm-cal-id';

/**
 * Календарь телефона — свой у каждого устройства (номер календаря имеет смысл только на этом телефоне).
 * Раньше выбор хранился в общих настройках задач — он остаётся запасным вариантом.
 */
export function phoneCalendarId(d: { prefs: { calendarId?: string } }): string | undefined {
  try {
    const v = localStorage.getItem(CAL_LOCAL);
    if (v !== null) return v || undefined;
  } catch {
    /* хранилище недоступно */
  }
  return d.prefs.calendarId;
}

export function setPhoneCalendarId(id: string | undefined) {
  try {
    localStorage.setItem(CAL_LOCAL, id ?? '');
  } catch {
    /* хранилище недоступно */
  }
}
type CalIndex = Record<string, { id: string; sig: string; cal?: string }>;

function eventFor(t: TaskItem) {
  const date = t.date!;
  const allDay = !t.time;
  const start = allDay ? Date.UTC(fromYmd(date).getFullYear(), fromYmd(date).getMonth(), fromYmd(date).getDate()) : startAt(t, date).getTime();
  const end = allDay ? start + 86400000 : start + (t.duration || 30) * 60000;
  const rrule = t.repeat && !t.done ? toRRule(t.repeat, date, { allDay, done: t.repeatDone }) ?? undefined : undefined;
  // пропущенные и перенесённые повторы — исключения серии (иначе в календаре телефона они остаются, а перенесённый — дважды)
  const skip = rrule ? (t.repeat?.skip ?? []).filter((d) => d >= date) : [];
  const exdate = skip.length ? skip.map((d) => (allDay ? d.replace(/-/g, '') + 'T000000Z' : utcStamp(startAt(t, d).getTime()))).join(',') : undefined;
  return { title: (t.done ? '✓ ' : '') + (t.title || 'Задача'), description: taskDescription(t), start, end, allDay, rrule, ...(exdate ? { exdate } : {}) };
}

let calRunning = false;
let calAgain = false;

export async function syncCalendar(): Promise<void> {
  if (!isNative()) return;
  if (calRunning) {
    calAgain = true;
    return;
  }
  calRunning = true;
  try {
    const d = tasksData();
    if (!d) return;
    const idx = ((await get<CalIndex>(CAL_INDEX)) ?? {}) as CalIndex;
    const enabled = d.prefs.calendarSync && (await SmCalendar.checkAccess().catch(() => ({ granted: false }))).granted;
    if (!enabled && !Object.keys(idx).length) return;
    const byId = new Map(d.tasks.map((t) => [t.id, t]));
    const remove: [string, string][] = [];
    for (const [taskId, e] of Object.entries(idx)) {
      const t = byId.get(taskId);
      // событие в другом календаре (сменили календарь) — удалить и создать заново
      const moved = enabled && (e.cal ?? '') !== (phoneCalendarId(d) ?? '');
      if (!enabled || !t || t.deleted || !t.date || t.wontDo || moved) remove.push([taskId, e.id]);
    }
    if (remove.length) {
      const ok = await SmCalendar.deleteEvents({ ids: remove.map((r) => r[1]) }).then(() => true).catch(() => false);
      // при ошибке оставляем в индексе — попробуем удалить в следующий раз
      if (ok) for (const [taskId] of remove) delete idx[taskId];
    }
    if (enabled) {
      // старые выполненные задачи в календарь не пишем
      const since = addDaysYmd(todayYmd(), -60);
      for (const t of d.tasks) {
        if (t.deleted || !t.date || t.wontDo || (t.done && t.date < since)) continue;
        const ev = eventFor(t);
        const sig = JSON.stringify([ev, phoneCalendarId(d) ?? '']);
        const cur = idx[t.id];
        if (cur?.sig === sig) continue;
        try {
          const r = await SmCalendar.upsertEvent({ ...ev, id: cur?.id, taskId: t.id, calendarId: phoneCalendarId(d) });
          idx[t.id] = { id: r.id, sig, cal: phoneCalendarId(d) ?? '' };
        } catch {
          /* календарь недоступен — попробуем позже */
        }
      }
    }
    await set(CAL_INDEX, idx);
  } finally {
    calRunning = false;
    if (calAgain) {
      calAgain = false;
      void syncCalendar();
    }
  }
}

/** Включить запись задач в календарь телефона */
export async function enableCalendarSync(): Promise<boolean> {
  const r = await SmCalendar.requestAccess().catch(() => ({ granted: false }));
  if (!r.granted) {
    toast('Нет доступа к календарю — разрешите его в настройках телефона');
    return false;
  }
  const { setPrefs } = await import('./store');
  setPrefs({ calendarSync: true });
  return true;
}

export async function listPhoneCalendars(): Promise<PhoneCalendar[]> {
  if (!isNative()) return [];
  const r = await SmCalendar.listCalendars().catch(() => ({ calendars: [] as PhoneCalendar[] }));
  return r.calendars;
}

/** События календаря телефона за период (без событий, созданных из задач SuperMind) */
export async function phoneEvents(fromMs: number, toMs: number): Promise<PhoneEvent[]> {
  if (!isNative()) return [];
  const d = tasksData();
  if (!d?.prefs.showPhoneEvents) return [];
  const acc = await SmCalendar.checkAccess().catch(() => ({ granted: false }));
  if (!acc.granted) return [];
  const idx = ((await get<CalIndex>(CAL_INDEX)) ?? {}) as CalIndex;
  const ours = new Set(Object.values(idx).map((e) => e.id));
  const r = await SmCalendar.listEvents({ from: fromMs, to: toMs }).catch(() => ({ events: [] as PhoneEvent[] }));
  return r.events.filter((e) => !ours.has(e.eventId));
}

// ================= Экспорт в календарь (.ics) =================

/** Добавить одну задачу в календарь телефона */
export async function addTaskToCalendar(t: TaskItem) {
  if (!t.date) {
    toast('Сначала укажите дату задачи');
    return;
  }
  if (isAndroidApp()) {
    const d = tasksData();
    if (d?.prefs.calendarSync) {
      await syncCalendar();
      toast('Задача уже в календаре телефона');
      return;
    }
    await SmCalendar.insertWithPrompt(eventFor(t)).catch(() => toast('Не удалось открыть календарь'));
    return;
  }
  await openIcs(buildIcs([t], t.title), `${t.title.slice(0, 40) || 'задача'}.ics`);
}

/** Экспорт задач в файл календаря */
export async function exportTasksIcs(tasks: TaskItem[]) {
  const list = tasks.filter((t) => t.date && !t.deleted && !t.wontDo);
  if (!list.length) {
    toast('Нет задач с датой для экспорта');
    return;
  }
  await openIcs(buildIcs(list), 'supermind-tasks.ics');
}

async function openIcs(ics: string, filename: string) {
  if (isIOS() && !isNative()) {
    // iPhone: Safari сам предлагает «Добавить в Календарь» для text/calendar
    const a = document.createElement('a');
    a.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  await downloadText(ics, filename, 'text/calendar');
}

// ================= Запуск =================

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function syncSoon(delay = 1200) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    if (isNative()) {
      void syncNative().catch(() => {});
      void syncCalendar().catch(() => {});
    } else void uploadSchedule();
  }, delay);
}

let started = false;

/** Подписка на изменения задач: напоминания и календарь обновляются автоматически */
export function initTaskSync() {
  if (started) return;
  started = true;
  let prev = useTasks.getState().data;
  useTasks.subscribe((s) => {
    if (s.data !== prev) {
      prev = s.data;
      syncSoon();
    }
  });
  // сроки целей — тоже в напоминаниях: изменили цель — пересчитать
  void import('../goals/store').then(({ useGoals }) => {
    let pg = useGoals.getState().data;
    useGoals.subscribe((s) => {
      if (s.data === pg) return;
      const first = !pg;
      pg = s.data;
      if (!first) syncSoon(3000);
    });
  });
  if (isNative()) {
    void setupNative().then(async () => {
      // как в TickTick: разрешение на уведомления спрашиваем при первом запуске
      // (новичка спросит знакомство с приложением — не показываем два запроса сразу)
      let asked = false;
      try {
        asked = !!localStorage.getItem('sm-notify-asked') || !localStorage.getItem('sm-onboarded');
        localStorage.setItem('sm-notify-asked', '1');
      } catch {
        /* хранилище недоступно */
      }
      if (!asked && (await notifyPermission()) === 'prompt') await requestNotifyPermission();
    });
    void import('@capacitor/app').then(({ App }) =>
      App.addListener('resume', () => {
        syncSoon(300);
        void takeAlarmActions();
      }),
    );
    // «Готово» на будильнике: пока приложение открыто — сразу, иначе — при запуске
    void SmAlarm.addListener('actions', () => void takeAlarmActions()).catch(() => {});
    setTimeout(() => void takeAlarmActions(), 1500);
  } else {
    try {
      webSnoozes = JSON.parse(localStorage.getItem('sm-snoozes') ?? '[]');
    } catch {
      webSnoozes = [];
    }
    webTimer ??= setInterval(() => void webTick(), 15000);
    primeAlarmAudio();
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void webTick());
    setTimeout(() => void webTick(), 3000);
    // нажатие на уведомление / кнопку в нём (из service worker)
    navigator.serviceWorker?.addEventListener('message', (e) => {
      const m = e.data as { type?: string; action?: string; data?: Record<string, string> };
      if (m?.type === 'sm-notify' && m.data) void handleAction(m.action || 'open', m.data);
    });
    const q = new URLSearchParams(location.search);
    if (q.get('task') || q.get('sm')) {
      const action = q.get('action') || 'open';
      const data: Record<string, string> = Object.fromEntries([...q].filter(([k, v]) => k !== 'action' && k !== 'task' && v));
      if (q.get('task')) data.taskId = q.get('task')!;
      data.date ??= '';
      history.replaceState(history.state, '', location.pathname);
      setTimeout(() => void handleAction(action, data), 500);
    }
  }
  syncSoon(1500);
}

/** Действия из всплывающего напоминания внутри приложения */
export function reminderAction(r: InAppReminder, action: 'done' | 'snooze' | 'open') {
  dismissReminder(r.key);
  if (r.brain) {
    if (action === 'open') void handleAction('open', r.extra ?? { brain: r.brain });
    return;
  }
  if (r.goalId) {
    if (action === 'open') void handleAction('open', { goalId: r.goalId });
    return;
  }
  if (r.payId || r.briefing) {
    if (action === 'open') useApp.getState().go(r.payId ? 'finance' : 'assistant');
    return;
  }
  if (r.saver && (!r.habitId || action === 'open')) {
    if (action === 'open') useApp.getState().go('habits');
    return;
  }
  if (r.habitId) {
    // день напоминания, а не сегодняшний: вчерашнее напоминание, открытое утром, отмечает вчера
    void handleAction(action === 'done' ? 'habit-done' : 'open', { habitId: r.habitId, date: r.date ?? todayYmd() });
    return;
  }
  if (!r.taskId) return;
  const t = getTask(r.taskId);
  if (!t) return;
  if (action === 'done') {
    if (!completeOccurrence(t.id, r.date)) toast('Эта задача уже выполнена');
  }
  else if (action === 'snooze') void snoozeOne(t, 10, r.date);
  else {
    useApp.getState().go('tasks');
    openTask(t.id);
  }
}

export { timeOf };
