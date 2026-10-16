/**
 * Второй мозг в утренних уведомлениях: вопрос дня (ответить прямо из шторки) и карточка для повторения
 * («Показать ответ» / «Помню»). Приходят сразу после «Плана на день». Расписание собирает tasks/sync.ts.
 */
import type { ID } from '../types';
import { addDaysYmd, todayYmd } from '../utils/mapTasks';
import { dueCards, type Grade, intervalLabel } from './cardsCore';

export interface BrainNotifyPrefs {
  question: boolean;
  cards: boolean;
}

const KEY = 'sm-brain-notify';

/** Настройки этого устройства (по умолчанию — включено) */
export function brainNotifyPrefs(): BrainNotifyPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<BrainNotifyPrefs>;
    return { question: v.question !== false, cards: v.cards !== false };
  } catch {
    return { question: true, cards: true };
  }
}

export function setBrainNotify(p: Partial<BrainNotifyPrefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...brainNotifyPrefs(), ...p }));
  } catch {
    /* не страшно */
  }
  void import('../tasks/sync').then((m) => m.syncSoon(300)).catch(() => undefined);
}

/** вопросы — на столько дней вперёд (дальше — когда откроете приложение) */
const QUESTION_DAYS = 7;
/** через сколько минут после «Плана на день» */
const AFTER_BRIEF_MIN = { question: 1, cards: 2 };
/** если «План на день» выключен */
const DEFAULT_TIME = '09:00';

export interface BrainPlanned {
  key: string;
  at: number;
  title: string;
  body: string;
  extra: Record<string, string | number>;
  actionTypeId?: string;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const dayStart = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
const plural = (n: number, f: [string, string, string]) => {
  const a = n % 10;
  const b = n % 100;
  return f[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 1 : 2];
};

/** Утренние уведомления мозга в промежутке [fromMs, toMs]; briefTime — время «Плана на день» ('' — выключен) */
export async function planBrainNotifications(fromMs: number, toMs: number, briefTime: string): Promise<BrainPlanned[]> {
  const prefs = brainNotifyPrefs();
  if (!prefs.question && !prefs.cards) return [];
  const base = minutesOf(briefTime || DEFAULT_TIME);
  const today = todayYmd();
  const within = (at: number) => at >= fromMs && at <= toMs;
  // дни, на которые уведомления попадают в промежуток (проверка раз в 15 с в браузере — обычно ни одного)
  const days: string[] = [];
  for (let i = 0; i <= 21; i++) {
    const day = addDaysYmd(today, i);
    if (dayStart(day) > toMs) break;
    if (within(dayStart(day) + (base + AFTER_BRIEF_MIN.question) * 60000) || within(dayStart(day) + (base + AFTER_BRIEF_MIN.cards) * 60000)) days.push(day);
  }
  if (!days.length) return [];
  const out: BrainPlanned[] = [];

  if (prefs.question) {
    const { plannedQuestions } = await import('./question');
    const plan = await plannedQuestions(days.slice(0, QUESTION_DAYS)).catch(() => ({}) as Awaited<ReturnType<typeof plannedQuestions>>);
    for (const [day, p] of Object.entries(plan)) {
      const at = dayStart(day) + (base + AFTER_BRIEF_MIN.question) * 60000;
      if (!within(at)) continue;
      out.push({
        key: `question|${day}`,
        at,
        title: '❓ Вопрос дня',
        body: p.question,
        extra: { brain: 'question', date: day, noteId: p.noteId },
        actionTypeId: 'sm-question',
      });
    }
  }

  if (prefs.cards) {
    const { ensureNotes, useNotes } = await import('./store');
    await ensureNotes().catch(() => null);
    const d = useNotes.getState().data;
    const alive = new Set((d?.notes ?? []).filter((n) => !n.trashed).map((n) => n.id));
    const cards = (d?.cards ?? []).filter((c) => alive.has(c.noteId));
    for (const day of days) {
      const due = dueCards(cards, day);
      if (!due.length) continue;
      const at = dayStart(day) + (base + AFTER_BRIEF_MIN.cards) * 60000;
      if (!within(at)) continue;
      const c = due[0];
      out.push({
        key: `cards|${day}`,
        at,
        title: due.length > 1 ? `🗂 Вспомните ответ · ещё ${due.length - 1} ${plural(due.length - 1, ['карточка', 'карточки', 'карточек'])}` : '🗂 Вспомните ответ',
        body: c.q,
        extra: { brain: 'cards', date: day, cardId: c.id },
        actionTypeId: 'sm-card',
      });
    }
  }
  return out;
}

/** Кнопки уведомлений мозга (Android) */
export const BRAIN_ACTION_TYPES = [
  {
    id: 'sm-question',
    actions: [
      { id: 'answer', title: 'Ответить', input: true, inputButtonTitle: 'Записать', inputPlaceholder: 'Ваш ответ — в заметку дня' },
      { id: 'skip', title: 'Не сегодня' },
    ],
  },
  {
    id: 'sm-card',
    actions: [
      { id: 'card-show', title: 'Показать ответ' },
      { id: 'card-good', title: '✓ Помню' },
    ],
  },
];

async function toNotes() {
  const { nav } = await import('../search/sources');
  await nav('notes');
}

/** Нажали уведомление мозга или кнопку в нём; input — ответ, набранный в шторке */
export async function brainAction(action: string, ex: Record<string, string>, input?: string): Promise<void> {
  const { toast } = await import('../store/appStore');
  if (ex.brain === 'question') {
    const q = await import('./question');
    const day = ex.date || todayYmd();
    const question = q.notifiedQuestion(day, ex.noteId)?.question ?? ex.question ?? '';
    if (action === 'answer' && input?.trim()) {
      const ok = await q.answerFromNotification(day, ex.noteId, question, input);
      if (ok) {
        const { openDailyNote } = await import('./daily');
        toast('Ответ записан в заметку дня', { label: 'Открыть', run: () => void openDailyNote() });
      } else toast('Не удалось записать ответ');
      return;
    }
    if (action === 'skip') {
      q.dismissFromNotification(day, ex.noteId, question);
      return;
    }
    // нажали само уведомление — вопрос ждёт в «Заметках»
    await toNotes();
    return;
  }
  if (ex.brain === 'cards') {
    const cards = await import('./cards');
    const { ensureNotes } = await import('./store');
    await ensureNotes();
    const exists = (id: ID) => cards.todaysCards().some((c) => c.id === id);
    if (action === 'card-good' && exists(ex.cardId)) {
      cards.gradeCard(ex.cardId, 2 as Grade);
      const next = cards.todaysCards().length;
      const c = (await import('./store')).useNotes.getState().data?.cards?.find((x) => x.id === ex.cardId);
      const when = c ? `Следующий раз — через ${intervalLabel(c.interval)}` : 'Запомнено';
      if (next)
        toast(`${when}. Ещё ${next} ${plural(next, ['карточка', 'карточки', 'карточек'])}`, {
          label: 'Повторить',
          run: () => void toNotes().then(() => cards.openCardsReview()),
        });
      else toast(`${when}. На сегодня всё 🎉`);
      return;
    }
    await toNotes();
    if (exists(ex.cardId)) cards.openCardsAt(ex.cardId, action === 'card-show');
    else if (cards.todaysCards().length) cards.openCardsReview();
    else toast('Карточки на сегодня уже повторены 🎉');
  }
}
