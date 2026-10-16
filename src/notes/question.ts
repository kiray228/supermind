/**
 * Вопрос дня в приложении: выбрать давнюю заметку, спросить ИИ (без ИИ — простой вопрос), принять ответ:
 * в заметку дня и, если человек хочет, — обновлением в саму заметку. Правила — questionCore.ts.
 * Вопросы выбираются заранее на неделю (план): утреннее уведомление спрашивает то же, что и приложение.
 */
import { create } from 'zustand';
import type { ID } from '../types';
import { addDaysYmd, todayYmd } from '../utils/mapTasks';
import { buildQuestionPrompt, fillQuestionPlan, parseQuestion, pickQuestionNote, type PlannedQuestion, type QNote, QUESTION_SYSTEM, type QuestionPlan } from './questionCore';
import { bodyPlainText, type NotesData, newBlock } from './model';

export interface DayQuestion {
  day: string;
  noteId: ID;
  title: string;
  question: string;
  /** сколько раз просили другой */
  skip: number;
  state: 'open' | 'answered' | 'dismissed';
}

const KEY = 'sm-question-day';
const ASKED_KEY = 'sm-question-asked';
const PLAN_KEY = 'sm-question-plan';
/** на сколько дней вперёд выбирать вопросы (для уведомлений) */
export const QUESTION_PLAN_DAYS = 7;

const load = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* не страшно */
  }
};

export const useQuestion = create<{ q: DayQuestion | null; busy: boolean }>(() => ({ q: load<DayQuestion | null>(KEY, null), busy: false }));

function set(q: DayQuestion | null) {
  useQuestion.setState({ q });
  save(KEY, q);
}

/** Заметки, о которых можно спросить (шаблоны — нет) */
async function questionNotes(d: NotesData): Promise<QNote[]> {
  const { isTemplateNote, templateFolderIds } = await import('./templates');
  const tpl = templateFolderIds(d);
  return d.notes.filter((n) => !isTemplateNote(n, tpl)).map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt, wordCount: n.wordCount ?? 0, day: n.day, digest: n.digest, trashed: n.trashed }));
}

/** Дни плана: с сегодняшнего */
const planDays = (from = todayYmd(), n = QUESTION_PLAN_DAYS) => Array.from({ length: n }, (_, i) => addDaysYmd(from, i));

/** План вопросов на неделю (дополняется и сохраняется) */
export async function questionPlan(days = planDays(), now = Date.now()): Promise<QuestionPlan> {
  const { ensureNotes } = await import('./store');
  const d = await ensureNotes();
  const plan = fillQuestionPlan(load<QuestionPlan>(PLAN_KEY, {}), days, await questionNotes(d), now, load<Record<string, number>>(ASKED_KEY, {}));
  save(PLAN_KEY, plan);
  return plan;
}

function savePlanned(day: string, p: PlannedQuestion) {
  const plan = load<QuestionPlan>(PLAN_KEY, {});
  plan[day] = p;
  save(PLAN_KEY, plan);
}

/** Вопрос по заметке от ИИ (null — ИИ недоступен или не ответил) */
async function aiQuestion(noteId: ID, title: string, updatedAt: number, now: number): Promise<string | null> {
  const { aiReady } = await import('./aiQueue');
  if (!(await aiReady())) return null;
  try {
    const { loadNoteBody } = await import('./store');
    const body = await loadNoteBody(noteId);
    const { streamText } = await import('../ai/claude');
    const days = Math.round((now - updatedAt) / 86400000);
    const answer = await streamText({ system: QUESTION_SYSTEM, messages: [{ role: 'user', content: buildQuestionPrompt(title, bodyPlainText(body), days) }], effort: 'low', signal: AbortSignal.timeout(20000) });
    return parseQuestion(answer);
  } catch {
    return null;
  }
}

/** Вопрос на сегодня (готовит, если его ещё нет; skip — номер «другого вопроса»). null — спросить не о чем */
export async function ensureQuestion(want?: number, now = Date.now()): Promise<DayQuestion | null> {
  const day = todayYmd();
  const cur = useQuestion.getState().q;
  // без номера — уже выбранный сегодня вопрос (в том числе «другой»)
  if (cur?.day === day && (want === undefined || cur.skip === want)) return cur;
  const skip = want ?? 0;
  if (useQuestion.getState().busy) return cur?.day === day ? cur : null;
  useQuestion.setState({ busy: true });
  try {
    const { ensureNotes } = await import('./store');
    const d = await ensureNotes();
    let q: DayQuestion | null = null;
    if (skip === 0) {
      // вопрос дня — тот же, что в утреннем уведомлении
      const p = (await questionPlan(planDays(day), now))[day];
      if (p) {
        const meta = d.notes.find((n) => n.id === p.noteId);
        const question = p.ai ? p.question : ((meta && (await aiQuestion(p.noteId, p.title, meta.updatedAt, now))) ?? p.question);
        if (!p.ai && question !== p.question) savePlanned(day, { ...p, question, ai: true });
        q = { day, noteId: p.noteId, title: p.title, question, skip, state: 'open' };
      }
    } else {
      const note = pickQuestionNote(await questionNotes(d), day, now, load<Record<string, number>>(ASKED_KEY, {}), skip);
      if (note) q = { day, noteId: note.id, title: note.title, question: (await aiQuestion(note.id, note.title, note.updatedAt, now)) ?? `«${note.title}» — это всё ещё так? Что изменилось с тех пор?`, skip, state: 'open' };
    }
    if (!q) {
      if (cur?.day !== day) set(null);
      return null;
    }
    set(q);
    // завтрашний вопрос — заранее от ИИ, чтобы утреннее уведомление было живым
    void prepareTomorrow(now);
    return q;
  } finally {
    useQuestion.setState({ busy: false });
  }
}

let preparing = false;

/** Подготовить вопрос на завтра у ИИ (раз в день) и обновить расписание уведомлений */
export async function prepareTomorrow(now = Date.now()): Promise<boolean> {
  if (preparing) return false;
  preparing = true;
  try {
    const tomorrow = addDaysYmd(todayYmd(), 1);
    const p = (await questionPlan(planDays(), now))[tomorrow];
    if (!p || p.ai) return false;
    const { useNotes } = await import('./store');
    const meta = useNotes.getState().data?.notes.find((n) => n.id === p.noteId);
    const question = meta && (await aiQuestion(p.noteId, p.title, meta.updatedAt, now));
    if (!question) return false;
    savePlanned(tomorrow, { ...p, question, ai: true });
    void import('../tasks/sync').then((m) => m.syncSoon(2000)).catch(() => undefined);
    return true;
  } finally {
    preparing = false;
  }
}

/**
 * Вопросы для утренних уведомлений: по дням плана. Сегодняшний — только если на него ещё не ответили
 * и не отложили (и в приложении спрашивается то же самое).
 */
export async function plannedQuestions(days: string[], now = Date.now()): Promise<Record<string, PlannedQuestion>> {
  if (!days.length) return {};
  const plan = await questionPlan(days, now);
  const today = todayYmd();
  const q = useQuestion.getState().q;
  if (q?.day === today && (q.state !== 'open' || q.noteId !== plan[today]?.noteId)) delete plan[today];
  return Object.fromEntries(days.filter((d) => plan[d]).map((d) => [d, plan[d]]));
}

/** Другой вопрос (по следующей заметке) */
export const nextQuestion = () => ensureQuestion((useQuestion.getState().q?.skip ?? 0) + 1);

/** Не сегодня */
export function dismissQuestion() {
  const q = useQuestion.getState().q;
  if (q) set({ ...q, state: 'dismissed' });
  void import('../tasks/sync').then((m) => m.syncSoon(2000)).catch(() => undefined);
}

/** Записать ответ на вопрос q */
async function answer(q: Pick<DayQuestion, 'noteId' | 'question'>, text: string, toNote: boolean): Promise<boolean> {
  const a = text.trim();
  if (!a) return false;
  const { appendToDaily, appendToNote } = await import('./daily');
  const r = await appendToDaily(`❓ ${q.question} — ${a}`, 'thoughts');
  if (!r) return false;
  if (toNote) {
    const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    await appendToNote(q.noteId, [newBlock('p', { text: `**Обновление ${date}:** ${a}` })]);
  }
  const asked = load<Record<string, number>>(ASKED_KEY, {});
  asked[q.noteId] = Date.now();
  save(ASKED_KEY, asked);
  return true;
}

/**
 * Ответить: «❓ вопрос — ответ» в заметку дня; toNote — ещё и «Обновление …: ответ» в конец самой заметки.
 * Заметка отмечается спрошенной — повторится не раньше чем через полтора месяца.
 */
export async function answerQuestion(text: string, toNote: boolean): Promise<boolean> {
  const q = useQuestion.getState().q;
  if (!q || !(await answer(q, text, toNote))) return false;
  set({ ...q, state: 'answered' });
  return true;
}

/** Вопрос дня из уведомления: что спрашивали в этот день (по плану) */
export function notifiedQuestion(day: string, noteId: ID): PlannedQuestion | null {
  const p = load<QuestionPlan>(PLAN_KEY, {})[day];
  return p && p.noteId === noteId ? p : null;
}

/** Ответ прямо из уведомления */
export async function answerFromNotification(day: string, noteId: ID, question: string, text: string): Promise<boolean> {
  if (!(await answer({ noteId, question }, text, false))) return false;
  const q = useQuestion.getState().q;
  const title = notifiedQuestion(day, noteId)?.title ?? '';
  if (day === todayYmd()) set(q?.day === day && q.noteId === noteId ? { ...q, state: 'answered' } : { day, noteId, title, question, skip: 0, state: 'answered' });
  return true;
}

/** «Не сегодня» из уведомления */
export function dismissFromNotification(day: string, noteId: ID, question: string) {
  if (day !== todayYmd()) return;
  const q = useQuestion.getState().q;
  set(q?.day === day && q.noteId === noteId ? { ...q, state: 'dismissed' } : { day, noteId, title: notifiedQuestion(day, noteId)?.title ?? '', question, skip: 0, state: 'dismissed' });
}
