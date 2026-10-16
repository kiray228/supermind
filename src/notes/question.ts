/**
 * Вопрос дня в приложении: выбрать давнюю заметку, спросить ИИ (без ИИ — простой вопрос), принять ответ:
 * в заметку дня и, если человек хочет, — обновлением в саму заметку. Правила — questionCore.ts.
 */
import { create } from 'zustand';
import type { ID } from '../types';
import { todayYmd } from '../utils/mapTasks';
import { buildQuestionPrompt, fallbackQuestion, parseQuestion, pickQuestionNote, QUESTION_SYSTEM } from './questionCore';
import { bodyPlainText, newBlock } from './model';

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

/** Вопрос на сегодня (готовит, если его ещё нет). null — спросить не о чем */
export async function ensureQuestion(skip = 0, now = Date.now()): Promise<DayQuestion | null> {
  const day = todayYmd();
  const cur = useQuestion.getState().q;
  if (cur?.day === day && cur.skip === skip) return cur;
  if (useQuestion.getState().busy) return cur?.day === day ? cur : null;
  useQuestion.setState({ busy: true });
  try {
    const { ensureNotes, loadNoteBody } = await import('./store');
    const d = await ensureNotes();
    const asked = load<Record<string, number>>(ASKED_KEY, {});
    const note = pickQuestionNote(
      d.notes.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt, wordCount: n.wordCount ?? 0, day: n.day, digest: n.digest, trashed: n.trashed })),
      day,
      now,
      asked,
      skip,
    );
    if (!note) {
      if (cur?.day !== day) set(null);
      return null;
    }
    let question = fallbackQuestion(note.title);
    const { aiReady } = await import('./aiQueue');
    if (await aiReady()) {
      try {
        const body = await loadNoteBody(note.id);
        const { streamText } = await import('../ai/claude');
        const days = Math.round((now - note.updatedAt) / 86400000);
        const answer = await streamText({ system: QUESTION_SYSTEM, messages: [{ role: 'user', content: buildQuestionPrompt(note.title, bodyPlainText(body), days) }], effort: 'low', signal: AbortSignal.timeout(20000) });
        question = parseQuestion(answer) ?? question;
      } catch {
        /* без ИИ — простой вопрос */
      }
    }
    const q: DayQuestion = { day, noteId: note.id, title: note.title, question, skip, state: 'open' };
    set(q);
    return q;
  } finally {
    useQuestion.setState({ busy: false });
  }
}

/** Другой вопрос (по следующей заметке) */
export const nextQuestion = () => ensureQuestion((useQuestion.getState().q?.skip ?? 0) + 1);

/** Не сегодня */
export function dismissQuestion() {
  const q = useQuestion.getState().q;
  if (q) set({ ...q, state: 'dismissed' });
}

/**
 * Ответить: «❓ вопрос — ответ» в заметку дня; toNote — ещё и «Обновление …: ответ» в конец самой заметки.
 * Заметка отмечается спрошенной — повторится не раньше чем через полтора месяца.
 */
export async function answerQuestion(text: string, toNote: boolean): Promise<boolean> {
  const q = useQuestion.getState().q;
  const a = text.trim();
  if (!q || !a) return false;
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
  set({ ...q, state: 'answered' });
  return true;
}
