/**
 * Вопрос дня: какую давнюю заметку вспомнить сегодня и какой вопрос по ней задать.
 * Модуль чистый — тесты гоняют его в Node; хранение и ответ — question.ts.
 */

const DAY = 86400000;
/** заметка «давняя» — не менялась столько дней */
export const QUESTION_MIN_AGE = 14;
/** и в ней есть о чём спросить */
export const QUESTION_MIN_WORDS = 30;
/** одну и ту же заметку — не чаще раза в столько дней */
export const QUESTION_REPEAT_DAYS = 45;

export interface QNote {
  id: string;
  title: string;
  updatedAt: number;
  wordCount: number;
  day?: string;
  digest?: boolean;
  trashed?: number;
}

/** Число из строки (для выбора «на сегодня»: один день — один выбор) */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Заметка для вопроса: давняя, содержательная, обычная (не день и не конспект), без недавних вопросов.
 * Чем больше текста и чем дольше не открывали — тем вероятнее; выбор на день постоянный (по дате), skip — пропустить первые.
 */
export function pickQuestionNote(notes: QNote[], day: string, now: number, asked: Record<string, number> = {}, skip = 0): QNote | null {
  const old = now - QUESTION_MIN_AGE * DAY;
  const fresh = now - QUESTION_REPEAT_DAYS * DAY;
  const pool = notes
    .filter((n) => !n.trashed && !n.day && !n.digest && n.title.trim() && n.wordCount >= QUESTION_MIN_WORDS && n.updatedAt < old && !((asked[n.id] ?? 0) > fresh))
    .map((n) => ({ n, w: Math.log(n.wordCount) * Math.log(2 + (now - n.updatedAt) / DAY) }))
    .sort((a, b) => b.w - a.w || (a.n.id < b.n.id ? -1 : 1))
    .slice(0, 30);
  if (!pool.length) return null;
  // взвешенный выбор: детерминированно по дате (и номеру «другой вопрос»)
  const order: QNote[] = [];
  const left = [...pool];
  let seed = hash(day);
  while (left.length) {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0;
    let r = (seed / 4294967296) * left.reduce((s, x) => s + x.w, 0);
    let i = 0;
    while (i < left.length - 1 && r >= left[i].w) r -= left[i++].w;
    order.push(left.splice(i, 1)[0].n);
  }
  return order[skip % order.length];
}

export const QUESTION_SYSTEM = `Ты помогаешь человеку возвращаться к своим старым записям. По заметке задай ОДИН короткий вопрос (до 140 символов),
который заставит задуматься: актуально ли это сейчас, что изменилось, что из этого сделано, какой следующий шаг.
Обращайся на «ты», по-русски, конкретно по содержанию заметки (упомяни её суть). Без вступлений и кавычек — только сам вопрос.`;

export function buildQuestionPrompt(title: string, text: string, days: number): string {
  return `Заметка «${title}» (не открывалась ${days} дн.):\n\n${text.slice(0, 4000)}`;
}

/** Вопрос из ответа ИИ: первая содержательная строка, без кавычек и нумерации, с «?» в конце */
export function parseQuestion(answer: string): string | null {
  const line = answer
    .split('\n')
    .map((l) => l.trim().replace(/^(?:вопрос\s*:?\s*|[-*\d.)]+\s*)/i, '').replace(/^[«"“']+|[»"”']+$/g, '').trim())
    .find((l) => l.length >= 8);
  if (!line) return null;
  const q = line.length > 200 ? line.slice(0, 199).trimEnd() + '…' : line;
  return /[?？]$/.test(q) ? q : q.replace(/[.!…]+$/, '') + '?';
}

/** Вопрос без ИИ */
export const fallbackQuestion = (title: string) => `«${title}» — это всё ещё так? Что изменилось с тех пор?`;

/** Вопрос, заранее выбранный на день (для утреннего уведомления); ai — вопрос уже от ИИ */
export interface PlannedQuestion {
  noteId: string;
  title: string;
  question: string;
  ai?: boolean;
}
export type QuestionPlan = Record<string, PlannedQuestion>;

/**
 * Заполнить план на дни: выбранное не меняется (пока заметка жива), новые дни — каждый со своей заметкой,
 * без повторов с уже выбранными и недавно спрошенными. Прошедшие дни (раньше first) убираются.
 */
export function fillQuestionPlan(plan: QuestionPlan, days: string[], notes: QNote[], now: number, asked: Record<string, number> = {}): QuestionPlan {
  const alive = new Map(notes.filter((n) => !n.trashed).map((n) => [n.id, n]));
  const first = [...days].sort()[0] ?? '';
  const out: QuestionPlan = {};
  for (const [day, p] of Object.entries(plan)) if (day >= first && alive.has(p.noteId)) out[day] = { ...p, title: alive.get(p.noteId)!.title };
  const taken: Record<string, number> = { ...asked };
  for (const p of Object.values(out)) taken[p.noteId] = now;
  for (const day of [...days].sort()) {
    if (out[day]) continue;
    const n = pickQuestionNote(notes, day, now, taken);
    if (!n) continue;
    out[day] = { noteId: n.id, title: n.title, question: fallbackQuestion(n.title) };
    taken[n.id] = now;
  }
  return out;
}
