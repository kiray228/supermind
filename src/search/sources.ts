/**
 * Индекс поиска: карты (названия, темы, заметки к темам), задачи, заметки, цели,
 * привычки, записи ежедневника, операции. Строится при открытии поиска; большие
 * карты и тела заметок кэшируются по времени изменения.
 */
import type { ComponentType } from 'react';
import { CircleDot, NotebookPen, Network, Repeat, SquareCheck, StickyNote, Target, Wallet, Zap } from 'lucide-react';
import { useApp, toast, type View } from '../store/appStore';
import { listDocs, loadDoc, loadPlanner } from '../store/db';
import { leaveEditor, openDoc } from '../actions';
import type { MindDoc, Topic } from '../types';
import { norm } from './match';
import { ensureTasks, openTask } from '../tasks/store';
import { dayLabel, INBOX } from '../tasks/model';
import { ensureNotes, loadNoteBody, openNote } from '../notes/store';
import { bodyPlainText } from '../notes/model';
import { ensureGoals, openGoal } from '../goals/store';
import { STATUS_LABEL } from '../goals/model';
import { ensureFinance } from '../finance/store';
import { fmtMoney, fmtNum } from '../finance/model';
import { openTxSheet } from '../finance/ui/state';

export type Kind = 'cmd' | 'map' | 'topic' | 'task' | 'note' | 'goal' | 'habit' | 'journal' | 'tx';
export type GroupId = 'cmd' | 'maps' | 'task' | 'note' | 'goal' | 'habit' | 'journal' | 'tx';

export interface Entry {
  key: string;
  kind: Kind;
  title: string;
  /** текст, по которому тоже ищем (описание, заметки, пункты) */
  body?: string;
  /** вторая строка, когда совпадение только в названии */
  sub?: string;
  /** эмодзи вместо значка */
  emoji?: string;
  /** время изменения — свежее чуть выше */
  at?: number;
  /** поправка к рейтингу (выполненное — ниже) */
  boost?: number;
  done?: boolean;
  hint?: string;
  run: () => void | Promise<void>;
  /** нормализованные title и body */
  nt: string;
  nb: string;
}

export const GROUPS: Record<GroupId, { label: string; icon: ComponentType<{ size?: number }> }> = {
  cmd: { label: 'Команды', icon: Zap },
  maps: { label: 'Карты', icon: Network },
  task: { label: 'Задачи', icon: SquareCheck },
  note: { label: 'Заметки', icon: StickyNote },
  goal: { label: 'Цели', icon: Target },
  habit: { label: 'Привычки', icon: Repeat },
  journal: { label: 'Дневник', icon: NotebookPen },
  tx: { label: 'Финансы', icon: Wallet },
};

export const KIND_ICON: Record<Kind, ComponentType<{ size?: number }>> = {
  cmd: Zap,
  map: Network,
  topic: CircleDot,
  task: SquareCheck,
  note: StickyNote,
  goal: Target,
  habit: Repeat,
  journal: NotebookPen,
  tx: Wallet,
};

export const groupOf = (k: Kind): GroupId => (k === 'map' || k === 'topic' ? 'maps' : k);

export function entry(e: Omit<Entry, 'nt' | 'nb'>): Entry {
  return { ...e, nt: norm(e.title), nb: e.body ? norm(e.body) : '' };
}

// ---------- Переходы ----------

/** Перейти в раздел (из редактора — с сохранением карты) */
export async function nav(view: Exclude<View, 'editor'>) {
  const app = useApp.getState();
  if (app.view === 'editor') await leaveEditor(view);
  else if (app.view !== view) app.go(view);
}

/** Выполнить, когда раздел отрисован (окна раздела живут в его компоненте) */
export function whenShown(selector: string, fn: () => void, timeout = 5000) {
  const start = Date.now();
  const tick = () => {
    if (document.querySelector(selector)) {
      // раздел только что смонтирован: ждём, пока отработают его эффекты
      setTimeout(fn, 30);
    } else if (Date.now() - start < timeout) setTimeout(tick, 40);
  };
  tick();
}

// ---------- Вспомогательное ----------

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function dateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const yr = y !== new Date().getFullYear() ? ` ${y}` : '';
  return `${d} ${MONTHS[m - 1]}${yr}`;
}
const ymdTime = (ymd: string) => {
  const t = Date.parse(ymd + 'T12:00:00');
  return Number.isFinite(t) ? t : undefined;
};
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const plain = (s: string) => (s.includes('<') ? s.replace(/<[^>]+>/g, ' ') : s);

// ---------- Источники ----------

async function tasksSource(): Promise<Entry[]> {
  const d = await ensureTasks();
  const lists = new Map(d.lists.map((l) => [l.id, l]));
  const out: Entry[] = [];
  for (const t of d.tasks) {
    if (t.deleted || !t.title) continue;
    const list = lists.get(t.listId);
    const closed = t.done || !!t.wontDo;
    const sub = [
      closed ? (t.wontDo ? 'Не буду делать' : 'Выполнена') : '',
      t.date ? dayLabel(t.date) + (t.time ? ' ' + t.time : '') : '',
      list && list.id !== INBOX ? (list.emoji ? list.emoji + ' ' : '') + list.name : '',
      t.tags.length ? t.tags.map((x) => '#' + x).join(' ') : '',
    ]
      .filter(Boolean)
      .join(' · ');
    out.push(
      entry({
        key: 't:' + t.id,
        kind: 'task',
        title: oneLine(t.title),
        body: [t.notes ?? '', ...t.checklist.map((c) => c.text), ...t.tags.map((x) => '#' + x)].filter(Boolean).join('\n'),
        sub: sub || 'Входящие',
        at: t.updatedAt,
        boost: closed ? -2 : 0,
        done: closed,
        run: () => openTask(t.id),
      }),
    );
  }
  return out;
}

const noteCache = new Map<string, { at: number; text: string }>();

async function notesSource(withBodies: boolean): Promise<Entry[]> {
  const d = await ensureNotes();
  const folders = new Map(d.folders.map((f) => [f.id, f]));
  const out: Entry[] = [];
  for (const n of d.notes) {
    if (n.trashed) continue;
    let text = noteCache.get(n.id)?.at === n.updatedAt ? noteCache.get(n.id)!.text : null;
    if (text == null && withBodies) {
      const body = await loadNoteBody(n.id).catch(() => null);
      text = body ? bodyPlainText(body).slice(0, 20000) : n.preview;
      noteCache.set(n.id, { at: n.updatedAt, text });
    }
    const f = n.folderId ? folders.get(n.folderId) : undefined;
    out.push(
      entry({
        key: 'n:' + n.id,
        kind: 'note',
        title: oneLine(n.title) || 'Без названия',
        body: text ?? n.preview,
        sub: [f ? (f.emoji ? f.emoji + ' ' : '') + f.name : '', oneLine(n.preview).slice(0, 90)].filter(Boolean).join(' · '),
        at: n.updatedAt,
        run: async () => {
          await openNote(n.id);
          await nav('notes');
        },
      }),
    );
  }
  return out;
}

async function goalsSource(): Promise<Entry[]> {
  const d = await ensureGoals();
  const areas = new Map(d.areas.map((a) => [a.id, a]));
  return d.goals.map((g) => {
    const area = g.areaId ? areas.get(g.areaId) : undefined;
    const closed = g.status === 'done' || g.status === 'archived';
    return entry({
      key: 'g:' + g.id,
      kind: 'goal',
      title: oneLine(g.title) || 'Цель',
      emoji: g.emoji || undefined,
      body: [g.why, g.notes, ...g.stages.flatMap((s) => [s.title, ...s.steps.map((x) => x.title)])].filter(Boolean).join('\n'),
      sub: [g.status !== 'active' ? STATUS_LABEL[g.status] : '', area ? `${area.emoji} ${area.name}` : '', g.deadline ? 'до ' + dateLabel(g.deadline) : ''].filter(Boolean).join(' · '),
      at: g.updatedAt,
      boost: closed ? -1.5 : 0,
      done: g.status === 'done',
      run: async () => {
        await nav('goals');
        whenShown('.gl-page', () => openGoal(g.id));
      },
    });
  });
}

async function financeSource(): Promise<Entry[]> {
  const d = await ensureFinance();
  const accounts = new Map(d.accounts.map((a) => [a.id, a]));
  const cats = new Map(d.categories.map((c) => [c.id, c]));
  const TYPE = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' } as const;
  return d.transactions.map((tx) => {
    const acc = accounts.get(tx.accountId);
    const to = tx.toAccountId ? accounts.get(tx.toAccountId) : undefined;
    const cat = tx.categoryId ? cats.get(tx.categoryId) : undefined;
    const cur = acc?.currency ?? d.prefs.mainCurrency;
    const amount = fmtMoney(tx.type === 'expense' ? -tx.amount : tx.amount, cur, { sign: tx.type === 'income' });
    const title = oneLine(tx.note ?? '') || (cat ? cat.name : tx.type === 'transfer' && to ? `${acc?.name ?? ''} → ${to.name}` : TYPE[tx.type]);
    return entry({
      key: 'x:' + tx.id,
      kind: 'tx',
      title,
      emoji: cat?.emoji,
      body: [cat?.name ?? '', TYPE[tx.type], String(tx.amount), fmtNum(tx.amount), acc?.name ?? '', ...(tx.tags ?? []).map((x) => '#' + x)].filter(Boolean).join('\n'),
      sub: [amount, dateLabel(tx.date), tx.note && cat ? cat.name : '', acc?.name ?? ''].filter(Boolean).join(' · '),
      at: ymdTime(tx.date),
      run: async () => {
        await nav('finance');
        openTxSheet({ tx });
      },
    });
  });
}

async function plannerSource(): Promise<Entry[]> {
  const p = await loadPlanner();
  const out: Entry[] = [];
  for (const h of p.habits ?? []) {
    if (h.deleted || h.archived || !h.name) continue;
    out.push(
      entry({
        key: 'h:' + h.id,
        kind: 'habit',
        title: oneLine(h.name),
        emoji: h.icon || undefined,
        sub: ['Привычка', h.time ?? '', h.unit && h.target && h.target > 1 ? `${h.target} ${h.unit}` : ''].filter(Boolean).join(' · '),
        at: h.updatedAt,
        run: () => nav('planner'),
      }),
    );
  }
  for (const [ymd, day] of Object.entries(p.days ?? {})) {
    const text = day?.journal?.trim();
    if (!text) continue;
    out.push(
      entry({
        key: 'j:' + ymd,
        kind: 'journal',
        title: dateLabel(ymd) + (day.mood ? ' ' + day.mood : ''),
        body: text.slice(0, 20000),
        sub: oneLine(text).slice(0, 100),
        at: ymdTime(ymd),
        run: async () => {
          await nav('planner');
          toast(`Запись за ${dateLabel(ymd)} — выберите этот день в календаре`);
        },
      }),
    );
  }
  return out;
}

/** Не больше стольких тем из одной карты и всего */
const MAX_TOPICS_PER_DOC = 2500;
const MAX_TOPICS_TOTAL = 30000;
const docCache = new Map<string, { at: number; entries: Entry[] }>();

function docTopics(doc: MindDoc): Entry[] {
  const out: Entry[] = [];
  const multi = doc.sheets.length > 1;
  for (const sheet of doc.sheets) {
    const stack: Topic[] = [sheet.root, ...sheet.floating];
    while (stack.length && out.length < MAX_TOPICS_PER_DOC) {
      const t = stack.pop()!;
      for (let i = t.children.length - 1; i >= 0; i--) stack.push(t.children[i]);
      const text = oneLine(plain(t.text ?? ''));
      const note = t.note ? plain(t.note).slice(0, 4000) : '';
      if (!text && !note) continue;
      if (t === sheet.root && norm(text) === norm(doc.title) && !note) continue;
      out.push(
        entry({
          key: `m:${doc.id}:${t.id}`,
          kind: 'topic',
          title: text || 'Тема',
          body: [note, ...(t.labels ?? [])].filter(Boolean).join('\n'),
          sub: doc.title + (multi && sheet.title ? ` · ${sheet.title}` : ''),
          at: doc.updatedAt,
          boost: -0.6,
          run: () => openDoc(doc.id, t.id),
        }),
      );
    }
  }
  return out;
}

async function mapsSource(withTopics: boolean): Promise<Entry[]> {
  const list = await listDocs();
  const out: Entry[] = [];
  let topics = 0;
  for (const m of list) {
    if (m.trashed) continue;
    out.push(
      entry({
        key: 'd:' + m.id,
        kind: 'map',
        title: m.title || 'Без названия',
        sub: m.locked ? 'Защищена паролем' : m.topicCount ? `${m.topicCount} ${plural(m.topicCount, 'тема', 'темы', 'тем')}` : 'Карта',
        at: m.updatedAt,
        boost: 0.5 + (m.starred ? 0.5 : 0),
        run: () => openDoc(m.id),
      }),
    );
    if (!withTopics || m.locked || topics >= MAX_TOPICS_TOTAL) continue;
    let c = docCache.get(m.id);
    if (!c || c.at !== m.updatedAt) {
      const doc = await loadDoc(m.id).catch(() => undefined);
      if (!doc || 'locked' in doc) continue;
      c = { at: m.updatedAt, entries: docTopics(doc) };
      docCache.set(m.id, c);
    }
    out.push(...c.entries);
    topics += c.entries.length;
  }
  return out;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/**
 * Собрать индекс. onUpdate вызывается по мере готовности: сначала быстрые источники
 * (названия), затем содержимое карт и заметок.
 */
export async function buildIndex(onUpdate: (entries: Entry[], done: boolean) => void, alive: () => boolean): Promise<void> {
  const parts: Partial<Record<string, Entry[]>> = {};
  const emit = (done: boolean) => alive() && onUpdate(Object.values(parts).flat() as Entry[], done);
  const run = async (name: string, fn: () => Promise<Entry[]>) => {
    try {
      parts[name] = await fn();
    } catch {
      /* раздел не загрузился — ищем по остальным */
    }
    emit(false);
  };
  await Promise.all([
    run('maps', () => mapsSource(false)),
    run('tasks', tasksSource),
    run('notes', () => notesSource(false)),
    run('goals', goalsSource),
    run('finance', financeSource),
    run('planner', plannerSource),
  ]);
  if (!alive()) return;
  await run('maps', () => mapsSource(true));
  if (!alive()) return;
  await run('notes', () => notesSource(true));
  emit(true);
}
