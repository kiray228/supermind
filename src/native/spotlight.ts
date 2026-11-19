/**
 * Поиск iPhone (Spotlight): карты, заметки и задачи — названия и короткий отрывок. Переиндексация в фоне:
 * при запуске и после изменений (с задержкой), отправляются только новые, изменённые и удалённые записи.
 * Касание результата открывает запись (SpotlightPlugin.handle → очередь → open_map / open_note / open_task).
 * С кодом-паролем индекс очищается: названия не должны быть видны в поиске телефона в обход замка.
 */
import { registerPlugin } from '@capacitor/core';
import { onDirty } from '../store/kv';
import { listDocs } from '../store/db';
import { ensureTasks, useTasks } from '../tasks/store';
import { ensureNotes, useNotes } from '../notes/store';
import { lockConfig, useLock } from '../ui/lock';
import { buildSpotlightItems, diffSpotlight, type SpotItem } from './spotlightCore';

interface SpotlightPlugin {
  index(o: { items: SpotItem[] }): Promise<void>;
  remove(o: { ids: string[] }): Promise<void>;
  clear(): Promise<void>;
}
const Spotlight = registerPlugin<SpotlightPlugin>('Spotlight');

const KEY = 'sm-spotlight';
const BATCH = 400;

function loadState(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { v: 1; h: Record<string, string> } | null;
    return v?.v === 1 && v.h ? v.h : {};
  } catch {
    return {};
  }
}
function saveState(h: Record<string, string> | null) {
  try {
    if (h) localStorage.setItem(KEY, JSON.stringify({ v: 1, h }));
    else localStorage.removeItem(KEY);
  } catch {
    /* не страшно: в следующий раз переиндексирует всё */
  }
}

let running = false;
let again = false;

async function reindex() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  again = false;
  try {
    if (lockConfig()) {
      if (localStorage.getItem(KEY) !== null) {
        await Spotlight.clear();
        saveState(null);
      }
      return;
    }
    const [maps, notes, tasks] = await Promise.all([listDocs(), ensureNotes(), ensureTasks()]);
    const items = buildSpotlightItems({ maps, notes: notes.notes, tasks: tasks.tasks });
    const prev = loadState();
    const { upsert, remove, next } = diffSpotlight(prev, items);
    if (!upsert.length && !remove.length) return;
    // первый раз (или после сбоя) — с чистого листа: в индексе могли остаться записи прежних версий
    if (!Object.keys(prev).length) await Spotlight.clear();
    else for (let i = 0; i < remove.length; i += BATCH) await Spotlight.remove({ ids: remove.slice(i, i + BATCH) });
    for (let i = 0; i < upsert.length; i += BATCH) await Spotlight.index({ items: upsert.slice(i, i + BATCH) });
    saveState(next);
  } catch {
    // состояние не сохранено — в следующий раз попробует снова
  } finally {
    running = false;
    if (again) schedule(3000);
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(ms = 5000) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void reindex();
  }, ms);
}

let started = false;

export function initSpotlight() {
  if (started) return;
  started = true;
  useTasks.subscribe((s, p) => {
    if (s.data !== p.data) schedule();
  });
  useNotes.subscribe((s, p) => {
    if (s.data !== p.data) schedule();
  });
  useLock.subscribe((s, p) => {
    if (s.enabled !== p.enabled) schedule(500);
  });
  onDirty((key) => {
    if (!key || key === 'docs:index') schedule();
  });
  // после запуска — когда приложение уже показалось
  schedule(8000);
}
