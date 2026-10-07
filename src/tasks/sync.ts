import { registerPlugin } from '@capacitor/core';
import { get, set } from '../store/kv';
import { create } from 'zustand';
import type { PlannerData } from '../types';
import { isNative } from '../platform';
import { pushActive, uploadSchedule } from '../store/push';
import { useApp, toast } from '../store/appStore';
import { todayYmd, toYmd, addDaysYmd, fromYmd } from '../utils/mapTasks';
import { isIOS, downloadText } from '../io/download';
import { dayLabel, isActive, minutesOf, reminderFires, startAt, timeOf, whenLabel, type TaskItem } from './model';
import { buildIcs, taskDescription, toRRule } from './ics';
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
  upsertEvent(o: { id?: string; calendarId?: string; title: string; description: string; start: number; end: number; allDay: boolean; rrule?: string }): Promise<{ id: string }>;
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
}
export const useReminders = create<{ items: InAppReminder[] }>(() => ({ items: [] }));
export const dismissReminder = (key: string) => useReminders.setState((s) => ({ items: s.items.filter((i) => i.key !== key) }));

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

/** Отложенные напоминания веб-версии — тоже уходят на push-сервер */
export function pendingWebSnoozes(): { at: number; taskId: string; title: string }[] {
  return webSnoozes.filter((s) => s.at > Date.now()).map((s) => ({ ...s, title: getTask(s.taskId)?.title ?? 'Задача' }));
}

async function plan(fromMs: number, toMs: number): Promise<Planned[]> {
  const d = tasksData();
  if (!d || !d.prefs.notify) return [];
  const out: Planned[] = [];
  for (const f of reminderFires(d.tasks, fromMs, toMs)) {
    const base = { taskId: f.task.id, date: f.date, sm: 1 };
    out.push({ id: hash(`${f.task.id}|${f.date}|${f.offset}`), at: f.at, title: f.task.title || 'Задача', body: reminderBody(f.task, f.date, f.at), extra: base });
    // «настойчивое» напоминание — ещё 3 раза, пока задача не выполнена
    if (d.prefs.nag > 0 && f.offset === Math.max(...f.task.reminders))
      for (let k = 1; k <= 3; k++) {
        const at = f.at + k * d.prefs.nag * 60000;
        if (at <= toMs) out.push({ id: hash(`${f.task.id}|${f.date}|nag${k}`), at, title: '⏰ ' + (f.task.title || 'Задача'), body: 'Ещё не выполнено · ' + reminderBody(f.task, f.date, at), extra: base });
      }
  }
  // платежи по подпискам (раздел «Финансы»): напоминание в 09:00 за указанное число дней
  const fin = await get<import('../finance/model').FinanceData>('finance').catch(() => undefined);
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
        title: `💳 ${pay.title}`,
        body: `${pay.remindDays === 0 ? 'Платёж сегодня' : `Платёж ${dayLabel(pay.date, day).toLowerCase()}`} · ${amount}`,
        extra: { payId: pay.id, date: pay.date, sm: 1 },
      });
    }
  }
  const p = await get<PlannerData>('planner').catch(() => undefined);
  // утренний брифинг: что на сегодня (пересчитывается при каждом изменении задач)
  const brief = d.prefs.briefing ?? '08:00';
  if (brief) {
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const day = addDaysYmd(toYmd(new Date(fromMs)), i);
      const at = fromYmd(day).getTime() + minutesOf(brief) * 60000;
      if (at < fromMs || at > toMs) continue;
      out.push({ id: hash(`brief|${day}`), at, ...briefingFor(d.tasks, p, day), extra: { briefing: 1, date: day, sm: 1 } });
    }
  }
  // привычки с напоминанием: только в запланированные дни и пока не выполнены
  if (p?.habits?.length) {
    const pdays = p.days ?? {};
    for (const h of hm.activeHabits(p.habits)) {
      const time = hm.reminderTimeOf(h);
      if (!time) continue;
      for (let i = 0; i <= HORIZON_DAYS; i++) {
        const day = addDaysYmd(toYmd(new Date(fromMs)), i);
        if (hm.doneOn(pdays, h, day) || !hm.dueOn(pdays, h, day)) continue;
        const at = fromYmd(day).getTime() + minutesOf(time) * 60000;
        if (at < fromMs || at > toMs) continue;
        const t = hm.targetOf(h);
        const left = hm.freqOf(h) === 'weekly' ? hm.perWeekOf(h) - hm.weekCount(pdays, h, day, day) : 0;
        const body =
          t > 1
            ? `Цель на сегодня: ${h.unit ? `${h.unit} ` : ''}×${t}${h.duration ? ` · ${hm.durationLabel(h.duration)}` : ''}`
            : left > 0
              ? `Ещё ${left} ${hm.plural(left, ['раз', 'раза', 'раз'])} на этой неделе — отметьте выполнение`
              : `Привычка на сегодня${h.duration ? ` · ${hm.durationLabel(h.duration)}` : ''} — отметьте выполнение`;
        out.push({ id: hash(`habit|${h.id}|${day}`), at, title: `${h.icon ?? '🔥'} ${h.name}`, body, extra: { habitId: h.id, date: day, sm: 1 } });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Текст утреннего уведомления на день */
function briefingFor(tasks: TaskItem[], p: PlannerData | undefined, day: string): { title: string; body: string } {
  const active = tasks.filter((t) => isActive(t) && t.date);
  const today = active.filter((t) => t.date === day).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.time ?? '99').localeCompare(b.time ?? '99'));
  const overdue = active.filter((t) => t.date! < day && day <= addDaysYmd(toYmd(new Date()), 1)).length;
  const habits = p ? hm.activeHabits(p.habits ?? []).filter((h) => hm.dueOn(p.days ?? {}, h, day)).length : 0;
  const parts: string[] = [];
  parts.push(today.length ? `Задач на сегодня: ${today.length}` : 'Задач на сегодня нет');
  if (overdue) parts.push(`просрочено: ${overdue}`);
  if (habits) parts.push(`привычек: ${habits}`);
  let body = parts.join(' · ');
  if (today[0]) {
    const t = today[0].time;
    body += `. Главное: ${today[0].title || 'Задача'}${t ? ` в ${t}` : ''}`;
  }
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
      lightColor: '#FF4A2B',
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
      ],
    }).catch(() => {});
    await LN.addListener('localNotificationActionPerformed', (e) => {
      const ex = (e.notification.extra ?? {}) as Record<string, string>;
      void handleAction(e.actionId, ex);
    });
  })();
  return nativeReady;
}

/** Действие из уведомления: выполнено / отложить / открыть */
async function handleAction(action: string, ex: Record<string, string>) {
  const { ensureTasks } = await import('./store');
  await ensureTasks();
  if (ex.habitId) {
    if (action === 'habit-done') {
      const p = await get<PlannerData>('planner');
      if (p) {
        const h = p.habits?.find((x) => x.id === ex.habitId);
        const day = (p.days[ex.date] ??= { journal: '', tasks: [] });
        if (h) {
          // счётчик — сразу до цели дня
          p.days[ex.date] = hm.withDone(day, h, true);
        } else day.habits = [...new Set([...(day.habits ?? []), ex.habitId])];
        await (await import('../store/db')).savePlanner(p);
        window.dispatchEvent(new Event('sm-planner-changed'));
        toast('Привычка отмечена');
      }
    } else useApp.getState().go('planner');
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
  const t = ex.taskId ? getTask(ex.taskId) : undefined;
  if (!t) return;
  if (action === 'done') {
    if (!completeOccurrence(t.id, ex.date || undefined)) toast('Эта задача уже выполнена');
  } else if (action === 'snooze10' || action === 'snooze60' || action === 'snooze') {
    await snoozeOne(t, action === 'snooze60' ? 60 : 10);
  } else {
    useApp.getState().go('tasks');
    openTask(t.id);
  }
}

/** Отложенное напоминание (не трогает срок задачи) */
async function snoozeOne(t: TaskItem, minutes: number) {
  const at = Date.now() + minutes * 60000;
  if (isNative()) {
    const { LocalNotifications: LN } = await notifications();
    if (t.date) await LN.cancel({ notifications: [1, 2, 3].map((k) => ({ id: hash(`${t.id}|${t.date}|nag${k}`) })) }).catch(() => {});
    await LN.schedule({
      notifications: [
        {
          // 1..700000: не пересекается с напоминаниями (от 1 000 000) и таймером фокуса (777001)
          id: Math.floor(Math.random() * 700_000) + 1,
          title: t.title || 'Задача',
          body: 'Отложено · ' + reminderBody(t, t.date ?? todayYmd()),
          schedule: { at: new Date(at), allowWhileIdle: true },
          channelId: 'sm-reminders',
          actionTypeId: 'sm-task',
          extra: { taskId: t.id, date: t.date ?? '', sm: 1, snooze: 1 },
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
  await setupNative();
  const { LocalNotifications: LN } = await notifications();
  if ((await notifyPermission()) !== 'granted') return;
  const now = Date.now();
  const want = (await plan(now + 5000, now + HORIZON_DAYS * 86400000)).slice(0, MAX_NATIVE);
  const pending = (await LN.getPending()).notifications;
  const sig = (p: { title?: string; body?: string; at: number }) => `${p.at}|${p.title}|${p.body}`;
  const wantById = new Map(want.map((w) => [w.id, w]));
  const cancel: { id: number }[] = [];
  const have = new Set<number>();
  for (const n of pending) {
    const ex = (n.extra ?? {}) as Record<string, unknown>;
    if (!ex.sm || ex.snooze) continue;
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
        actionTypeId: w.extra.habitId ? 'sm-habit' : w.extra.payId || w.extra.briefing ? undefined : 'sm-task',
        autoCancel: true,
        extra: { ...w.extra, sig: sig(w) },
      })),
    });
  }
}

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
  const key = `${data.taskId ?? data.habitId ?? data.payId ?? 'brief'}|${data.date ?? ''}|${Date.now()}`;
  if (document.visibilityState === 'visible') {
    useReminders.setState((s) => ({ items: [...s.items.filter((i) => i.taskId !== data.taskId || !data.taskId), { key, taskId: data.taskId, habitId: data.habitId, payId: data.payId, briefing: !!data.briefing, date: data.date || undefined, title, body }] }));
    playChime();
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // с push системное уведомление присылает сервер — второе не нужно
  if (pushActive()) return;
  const opts: NotificationOptions & { actions?: { action: string; title: string }[]; requireInteraction?: boolean } = {
    body,
    tag: `${data.taskId ?? data.habitId ?? data.payId ?? 'brief'}|${data.date ?? ''}`,
    icon: './icon-192.png',
    badge: './icon-192.png',
    data,
    requireInteraction: !!tasksData()?.prefs.nag,
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
      if (t && !t.done) await showWeb(t.title, 'Отложенное напоминание · ' + reminderBody(t, t.date ?? todayYmd()), { taskId: t.id, date: t.date ?? '' });
    }
  }
  try {
    localStorage.setItem(LAST_KEY, String(now));
  } catch {
    /* ignore */
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
type CalIndex = Record<string, { id: string; sig: string; cal?: string }>;

function eventFor(t: TaskItem) {
  const date = t.date!;
  const allDay = !t.time;
  const start = allDay ? Date.UTC(fromYmd(date).getFullYear(), fromYmd(date).getMonth(), fromYmd(date).getDate()) : startAt(t, date).getTime();
  const end = allDay ? start + 86400000 : start + (t.duration || 30) * 60000;
  const rrule = t.repeat && !t.done ? toRRule(t.repeat, date, { allDay, done: t.repeatDone }) ?? undefined : undefined;
  return { title: (t.done ? '✓ ' : '') + (t.title || 'Задача'), description: taskDescription(t), start, end, allDay, rrule };
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
      const moved = enabled && (e.cal ?? '') !== (d.prefs.calendarId ?? '');
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
        const sig = JSON.stringify([ev, d.prefs.calendarId ?? '']);
        const cur = idx[t.id];
        if (cur?.sig === sig) continue;
        try {
          const r = await SmCalendar.upsertEvent({ ...ev, id: cur?.id, calendarId: d.prefs.calendarId });
          idx[t.id] = { id: r.id, sig, cal: d.prefs.calendarId ?? '' };
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
  if (isNative()) {
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
  if (isNative()) {
    void setupNative().then(async () => {
      // как в TickTick: разрешение на уведомления спрашиваем при первом запуске
      let asked = false;
      try {
        asked = !!localStorage.getItem('sm-notify-asked');
        localStorage.setItem('sm-notify-asked', '1');
      } catch {
        /* хранилище недоступно */
      }
      if (!asked && (await notifyPermission()) === 'prompt') await requestNotifyPermission();
    });
    void import('@capacitor/app').then(({ App }) =>
      App.addListener('resume', () => syncSoon(300)),
    );
  } else {
    try {
      webSnoozes = JSON.parse(localStorage.getItem('sm-snoozes') ?? '[]');
    } catch {
      webSnoozes = [];
    }
    webTimer ??= setInterval(() => void webTick(), 15000);
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
  if (r.payId || r.briefing) {
    if (action === 'open') useApp.getState().go(r.payId ? 'finance' : 'assistant');
    return;
  }
  if (r.habitId) {
    void handleAction(action === 'done' ? 'habit-done' : 'open', { habitId: r.habitId, date: todayYmd() });
    return;
  }
  if (!r.taskId) return;
  const t = getTask(r.taskId);
  if (!t) return;
  if (action === 'done') {
    if (!completeOccurrence(t.id, r.date)) toast('Эта задача уже выполнена');
  }
  else if (action === 'snooze') void snoozeOne(t, 10);
  else {
    useApp.getState().go('tasks');
    openTask(t.id);
  }
}

export { timeOf };
