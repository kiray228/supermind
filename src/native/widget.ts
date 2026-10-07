/**
 * Виджеты Android («Сегодня», «Календарь», «Привычки», «Карта»), ярлыки значка приложения
 * и «Поделиться → SuperMind» (Android и PWA share_target).
 * Приложение отдаёт виджетам задачи, повестку на 2 недели, привычки по дням и наброски карт —
 * виджет сам выбирает «сегодня», поэтому остаётся верным после полуночи. Действия из виджетов
 * (выполнить, отметить привычку, открыть…), ярлыков и присланный текст приходят очередью через consumePending.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { isNative } from '../platform';
import { get, onDirty } from '../store/kv';
import type { View } from '../store/appStore';
import type { PlannerData } from '../types';
import { addDaysYmd, todayYmd } from '../utils/mapTasks';
import { completeOccurrence, ensureTasks, flushTasks, openQuickAdd, openTask, useTasks } from '../tasks/store';
import { isActive } from '../tasks/model';
import { activeHabits, countOn, doneOn, dueOn } from '../habits/model';
import { bumpHabitOn } from '../habits/store';
import { loadPlanner } from '../store/db';
import { ensureGoals, openGoal } from '../goals/store';
import { buildAgenda, buildHabits, buildMaps, invalidatePhoneEvents, subscribeGoals } from './widgetData';
import { joinShared, type SharedText } from './share';

type PendingAction =
  | { type: 'complete'; id: string; date?: string }
  | { type: 'open_task'; id: string }
  | { type: 'quick_add' }
  | { type: 'open_view'; view: string }
  | { type: 'share'; text: string; title?: string }
  /** привычка из виджета: n — новое значение счётчика за день (0/1 для простой отметки) */
  | { type: 'habit'; id: string; date: string; n: number }
  | { type: 'open_map'; id: string }
  | { type: 'open_goal'; id: string }
  | { type: 'search' }
  | { type: 'new_note' };

interface WidgetBridgePlugin {
  update(o: { json: string }): Promise<void>;
  consumePending(): Promise<{ actions: PendingAction[] }>;
  addListener(event: 'pending', fn: () => void): Promise<PluginListenerHandle>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

const DAYS_AHEAD = 7;
const MAX_TASKS = 80;

/** Данные для виджета: активные задачи с датой до +7 дней и привычки «выполнено/всего» по дням */
async function buildPayload(): Promise<string> {
  const data = useTasks.getState().data;
  const today = todayYmd();
  const last = addDaysYmd(today, DAYS_AHEAD);
  const tasks = (data?.tasks ?? [])
    .filter((t) => isActive(t) && !!t.date && t.date <= last)
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : (a.time ?? '99').localeCompare(b.time ?? '99')))
    .slice(0, MAX_TASKS)
    .map((t) => ({ id: t.id, t: t.title || 'Без названия', d: t.date, ...(t.time ? { tm: t.time } : {}), ...(t.duration ? { du: t.duration } : {}), ...(t.priority ? { p: t.priority } : {}) }));
  const habits: Record<string, [number, number]> = {};
  const p = await get<PlannerData>('planner').catch(() => undefined);
  const list = activeHabits(p?.habits);
  if (list.length) {
    const days = p?.days ?? {};
    for (let i = 0; i <= DAYS_AHEAD; i++) {
      const d = addDaysYmd(today, i);
      const due = list.filter((h) => dueOn(days, h, d));
      if (due.length) habits[d] = [due.filter((h) => doneOn(days, h, d)).length, due.length];
    }
  }
  await ensureGoals().catch(() => undefined);
  const [agenda, hab, maps] = await Promise.all([
    buildAgenda(today).catch(() => []),
    buildHabits(today).catch(() => ({ list: [], days: {} })),
    buildMaps().catch(() => []),
  ]);
  return JSON.stringify({ v: 2, at: Date.now(), tasks, habits, agenda, hab, maps });
}

let lastSent = '';
let timer: ReturnType<typeof setTimeout> | null = null;

async function pushNow(force = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  // пока применяются действия из виджета — не отправлять промежуточное состояние
  if (applying && !force) return pushSoon(500);
  if (!useTasks.getState().data) return;
  const json = await buildPayload();
  // время отправки не влияет на содержимое — сравниваем без него
  const key = json.replace(/"at":\d+,/, '');
  if (key === lastSent) return;
  lastSent = key;
  await WidgetBridge.update({ json }).catch(() => {});
}

function pushSoon(ms = 800) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void pushNow(), ms);
}

let applying = false;
let again = false;

const VIEWS: View[] = ['home', 'tasks', 'calendar', 'planner', 'habits', 'notes', 'goals', 'finance', 'assistant', 'progress', 'focus', 'board', 'settings'];

/** Перейти в раздел (из редактора карты — с сохранением) */
async function goView(view: Exclude<View, 'editor'>) {
  const { nav } = await import('../search/sources');
  await nav(view);
}

/** Отметка привычки из виджета: привести счётчик дня к значению, которое видел пользователь */
async function applyHabit(id: string, date: string, n: number): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const p = await loadPlanner();
  const h = p.habits?.find((x) => x.id === id);
  if (!h) return false;
  const delta = Math.max(0, n) - countOn(p.days?.[date], h);
  if (!delta) return false;
  await bumpHabitOn(h, date, delta);
  return true;
}

async function newNote() {
  const { ensureNotes, createNote, openNote } = await import('../notes/store');
  await ensureNotes();
  const m = createNote();
  if (!m) return;
  await openNote(m.id);
  await goView('notes');
}

/** Забрать и выполнить действия из виджета и «Поделиться» */
async function applyPending() {
  if (applying) {
    again = true;
    return;
  }
  applying = true;
  again = false;
  try {
    await ensureTasks();
    const { actions } = await WidgetBridge.consumePending();
    if (!actions?.length) return;
    let completed = 0;
    for (const a of actions) {
      // переход из виджета/ярлыка — открытый поиск не должен его заслонять
      if (a.type !== 'search' && a.type !== 'complete' && a.type !== 'habit') {
        const { closeSearch } = await import('../search/state');
        closeSearch();
      }
      switch (a.type) {
        case 'complete':
          if (completeOccurrence(a.id, a.date)) completed++;
          break;
        case 'open_task':
          openTask(a.id);
          break;
        case 'quick_add':
          // из виджета «Сегодня» — сразу на сегодня; окно — после того как приложение показалось
          setTimeout(() => openQuickAdd({ date: todayYmd() }), 150);
          break;
        case 'open_view':
          if (VIEWS.includes(a.view as View)) await goView(a.view as Exclude<View, 'editor'>);
          break;
        case 'habit':
          await applyHabit(a.id, a.date, a.n).catch(() => false);
          break;
        case 'open_map': {
          const { openDoc } = await import('../actions');
          await openDoc(a.id);
          break;
        }
        case 'open_goal':
          await goView('goals');
          openGoal(a.id);
          break;
        case 'search': {
          const { openSearch } = await import('../search/state');
          setTimeout(() => openSearch(), 150);
          break;
        }
        case 'new_note':
          await newNote();
          break;
        case 'share':
          openShare({ text: a.text, title: a.title });
          break;
      }
    }
    if (completed) await flushTasks();
    await pushNow(true);
  } catch {
    /* виджет необязателен */
  } finally {
    applying = false;
    if (again) void applyPending();
  }
}

let shareRoot: Root | null = null;

/** Окно «Сохранить в SuperMind» — отдельный React-корень поверх приложения; новое сообщение заменяет прежнее */
function openShare(s: SharedText) {
  void import('./ShareSheet').then(({ default: ShareSheet }) => {
    if (!shareRoot) {
      const host = document.createElement('div');
      host.id = 'sm-share-host';
      document.body.appendChild(host);
      shareRoot = createRoot(host);
    }
    const root = shareRoot;
    root.render(createElement(ShareSheet, { key: Date.now(), shared: s, onClose: () => root.render(null) }));
  });
}

/** PWA share_target: ./?share-title=…&share-text=…&share-url=… */
function handleWebShare() {
  const q = new URLSearchParams(location.search);
  if (!['share-title', 'share-text', 'share-url'].some((k) => q.has(k))) return;
  const shared = joinShared({ title: q.get('share-title'), text: q.get('share-text'), url: q.get('share-url') });
  for (const k of ['share-title', 'share-text', 'share-url']) q.delete(k);
  const rest = q.toString();
  history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  if (shared) void ensureTasks().then(() => openShare(shared));
}

let started = false;

export function initWidget() {
  if (started) return;
  started = true;
  handleWebShare();
  if (!isNative() || Capacitor.getPlatform() !== 'android') return;
  // любые изменения задач и привычек → обновить виджет
  useTasks.subscribe((s, prev) => {
    if (s.data !== prev.data) pushSoon();
  });
  window.addEventListener('sm-planner-changed', () => pushSoon());
  subscribeGoals(() => pushSoon());
  onDirty(() => pushSoon(1500));
  void WidgetBridge.addListener('pending', () => void applyPending()).catch(() => {});
  void import('@capacitor/app').then(({ App }) => {
    void App.addListener('resume', () => {
      invalidatePhoneEvents();
      void applyPending();
      pushSoon(300);
    });
    // перед уходом в фон — сразу, чтобы виджет показывал свежее
    void App.addListener('pause', () => void pushNow());
  });
  void applyPending();
}
