import type { ID, MindDoc, TaskInfo, Topic } from '../types';
import { loadDoc, saveDoc } from '../store/db';
import { findInSheet, sheetRoots } from './tree';

/** Задача, привязанная к теме карты */
export interface MapTask {
  docId: ID;
  docTitle: string;
  sheetId: ID;
  topicId: ID;
  text: string;
  task: TaskInfo;
  /** тексты предков (от корня к родителю) */
  path: string[];
}

/** Собрать все темы с задачами из всех документов (все листы, включая плавающие темы) */
export function collectMapTasks(docs: MindDoc[]): MapTask[] {
  const out: MapTask[] = [];
  for (const doc of docs) {
    for (const sheet of doc.sheets) {
      const rec = (t: Topic, path: string[]) => {
        if (t.task) {
          out.push({
            docId: doc.id,
            docTitle: doc.title,
            sheetId: sheet.id,
            topicId: t.id,
            text: t.text,
            task: { ...t.task },
            path,
          });
        }
        if (t.children.length) {
          const next = [...path, t.text || 'Без названия'];
          for (const c of t.children) rec(c, next);
        }
      };
      for (const r of sheetRoots(sheet)) rec(r, []);
    }
  }
  return out;
}

// Очередь записей по документу, чтобы быстрые последовательные изменения не перетирали друг друга
const queues: Record<string, Promise<void>> = {};

/** Изменить задачу темы прямо в сохранённом документе */
export function updateMapTask(docId: ID, topicId: ID, patch: Partial<TaskInfo>): Promise<void> {
  const prev = queues[docId] ?? Promise.resolve();
  const viaEditor = import('../store/docStore').then(({ useDoc }) => {
    const st = useDoc.getState();
    if (st.doc?.id !== docId) return false;
    // тема может быть и на неактивном листе: запись мимо редактора он потом перетёр бы своим сохранением
    if (!st.doc.sheets.some((sh) => findInSheet(sh, topicId))) return false;
    st.mutateDoc((d) => {
      for (const sh of d.sheets) {
        const f = findInSheet(sh, topicId);
        if (f) {
          f.topic.task = { status: 'todo', ...f.topic.task, ...patch };
          return;
        }
      }
    });
    return true;
  });
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      // карта открыта в редакторе — изменение уже внесено через него
      if (await viaEditor.catch(() => false)) return;
      const raw = await loadDoc(docId);
      if (!raw || 'locked' in raw) return;
      const doc = raw;
      for (const sheet of doc.sheets) {
        const f = findInSheet(sheet, topicId);
        if (!f) continue;
        f.topic.task = { status: 'todo', ...f.topic.task, ...patch };
        doc.updatedAt = Date.now();
        await saveDoc(doc);
        return;
      }
    });
  queues[docId] = next;
  return next;
}

// ---------- Локальные даты (YYYY-MM-DD без перехода в UTC) ----------

const pad = (n: number) => String(n).padStart(2, '0');

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayYmd(): string {
  return toYmd(new Date());
}

export function addDaysYmd(s: string, n: number): string {
  const d = fromYmd(s);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}

export const PRIORITY_META: Record<number, { label: string; color: string }> = {
  1: { label: 'Высокий', color: '#ef4444' },
  2: { label: 'Средний', color: '#f97316' },
  3: { label: 'Низкий', color: '#3b82f6' },
};

/** 'overdue' | 'today' | null для срока */
export function dueState(due: string | undefined, done = false): 'overdue' | 'today' | null {
  if (!due || done) return null;
  const t = todayYmd();
  if (due < t) return 'overdue';
  if (due === t) return 'today';
  return null;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «2 окт» / «2 окт 2027» */
export function formatShortDate(s: string): string {
  const d = fromYmd(s);
  const m = MONTHS_GEN[d.getMonth()].slice(0, 3);
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${m}${y}`;
}
