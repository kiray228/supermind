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
