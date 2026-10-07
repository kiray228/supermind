/**
 * Виджет «SuperMind — Сегодня» (Android) и «Поделиться → SuperMind» (Android и PWA share_target).
 * Приложение отдаёт виджету задачи на ближайшую неделю и прогресс привычек по дням — виджет сам
 * выбирает «сегодня», поэтому остаётся верным после полуночи. Действия из виджета (выполнить,
 * открыть задачу, быстрое добавление) и присланный текст приходят очередью через consumePending.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { isNative } from '../platform';
import { get, onDirty } from '../store/kv';
import { useApp, type View } from '../store/appStore';
import type { PlannerData } from '../types';
import { addDaysYmd, todayYmd } from '../utils/mapTasks';
import { completeOccurrence, ensureTasks, flushTasks, openQuickAdd, openTask, useTasks } from '../tasks/store';
import { isActive } from '../tasks/model';
import { activeHabits, doneOn, dueOn } from '../habits/model';
import { joinShared, type SharedText } from './share';

type PendingAction =
  | { type: 'complete'; id: string; date?: string }
  | { type: 'open_task'; id: string }
  | { type: 'quick_add' }
  | { type: 'open_view'; view: string }
  | { type: 'share'; text: string; title?: string };

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
  return JSON.stringify({ v: 1, at: Date.now(), tasks, habits });
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

const VIEWS: View[] = ['home', 'tasks', 'calendar', 'planner', 'notes', 'goals', 'finance', 'assistant', 'progress', 'focus', 'board', 'settings'];

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
          if (VIEWS.includes(a.view as View)) useApp.getState().go(a.view as View);
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
  onDirty(() => pushSoon(1500));
  void WidgetBridge.addListener('pending', () => void applyPending()).catch(() => {});
  void import('@capacitor/app').then(({ App }) => {
    void App.addListener('resume', () => {
      void applyPending();
      pushSoon(300);
    });
    // перед уходом в фон — сразу, чтобы виджет показывал свежее
    void App.addListener('pause', () => void pushNow());
  });
  void applyPending();
}
