/**
 * Карточки для повторения: интервальное повторение (упрощённый SM-2, как в Anki), выбор карточек на сегодня,
 * запрос к ИИ «сделай карточки из заметки» и разбор ответа. Модуль чистый — тесты гоняют его в Node.
 */
import type { StudyCard } from './model';

/** Оценка ответа: 0 — не вспомнил, 1 — с трудом, 2 — вспомнил, 3 — легко */
export type Grade = 0 | 1 | 2 | 3;

export const GRADE_LABEL: Record<Grade, string> = { 0: 'Снова', 1: 'Трудно', 2: 'Хорошо', 3: 'Легко' };

const MIN_EASE = 1.3;
const MAX_EASE = 3;
const MAX_INTERVAL = 365;

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

const clampEase = (e: number) => Math.round(Math.min(MAX_EASE, Math.max(MIN_EASE, e)) * 100) / 100;

/** Через сколько дней показать снова при такой оценке (для подписи кнопки) */
export function nextInterval(c: Pick<StudyCard, 'interval' | 'ease' | 'reps'>, g: Grade): number {
  if (g === 0) return 0;
  let days: number;
  if (g === 1) days = c.reps === 0 ? 1 : Math.max(1, Math.round(c.interval * 1.2));
  else if (g === 2) days = c.reps === 0 ? 1 : c.reps === 1 ? 3 : Math.round(c.interval * c.ease);
  else days = c.reps === 0 ? 4 : Math.round(c.interval * c.ease * 1.3);
  // «хорошо» и «легко» — всегда дальше прежнего
  if (g >= 2) days = Math.max(days, c.interval + 1);
  return Math.min(MAX_INTERVAL, days);
}

/** Новое состояние карточки после ответа */
export function schedule(c: StudyCard, g: Grade, today: string, now = Date.now()): StudyCard {
  const interval = nextInterval(c, g);
  const ease = clampEase(c.ease + (g === 0 ? -0.2 : g === 1 ? -0.15 : g === 3 ? 0.15 : 0));
  return {
    ...c,
    interval,
    ease,
    reps: g === 0 ? 0 : c.reps + 1,
    lapses: g === 0 && c.reps > 0 ? c.lapses + 1 : c.lapses,
    due: addDays(today, interval),
    updatedAt: now,
  };
}

/** Подпись интервала: «сейчас», «1 д», «3 нед», «2 мес» */
export function intervalLabel(days: number): string {
  if (days <= 0) return 'сейчас';
  if (days < 14) return `${days} д`;
  if (days < 60) return `${Math.round(days / 7)} нед`;
  if (days < 365) return `${Math.round(days / 30)} мес`;
  return `${Math.round(days / 365)} г`;
}

/** Карточки на сегодня: сначала просроченные (давние первыми), потом новые — не больше limitNew новых */
export function dueCards(cards: StudyCard[], today: string, limitNew = 20): StudyCard[] {
  const due = cards.filter((c) => c.due <= today);
  const old = due.filter((c) => c.reps > 0 || c.lapses > 0).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.interval - b.interval));
  const fresh = due.filter((c) => c.reps === 0 && c.lapses === 0).sort((a, b) => a.createdAt - b.createdAt);
  return [...old, ...fresh.slice(0, limitNew)];
}

/** Новая карточка: показать сегодня */
export function newCard(p: { id: string; noteId: string; q: string; a: string; by: 'ai' | 'user' }, today: string, now = Date.now()): StudyCard {
  return { ...p, due: today, interval: 0, ease: 2.5, reps: 0, lapses: 0, createdAt: now, updatedAt: now };
}

// ---------- ИИ ----------

export const CARDS_SYSTEM = `Ты делаешь карточки для интервального повторения из личной заметки человека.
Каждая карточка — вопрос и короткий ответ, которые помогут запомнить главное из заметки: факты, цифры, решения, определения, выводы.
Правила:
- от 3 до 8 карточек, только по-настоящему важное; пустяки и очевидное не нужны;
- вопрос — один, конкретный, понятный без заметки (назови, о чём речь); ответ — до двух предложений;
- только то, что есть в заметке, ничего не придумывай;
- не повторяй карточки из списка «Уже есть».
Ответ — ТОЛЬКО JSON-массив: [{"q":"вопрос","a":"ответ"}]. Если запоминать нечего — [].`;

export function buildCardsPrompt(title: string, text: string, existing: string[] = []): string {
  const have = existing.length ? `\n\nУже есть:\n${existing.map((q) => '- ' + q).join('\n')}` : '';
  return `Заметка «${title || 'Без названия'}»:\n\n${text.slice(0, 12000)}${have}`;
}

const normQ = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Карточки из ответа ИИ: только с вопросом и ответом, без повторов (и без тех, что уже есть), не больше max */
export function parseCards(text: string, existing: string[] = [], max = 8): { q: string; a: string }[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : text;
  const a = src.indexOf('[');
  const b = src.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(src.slice(a, b + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set(existing.map(normQ));
  const out: { q: string; a: string }[] = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const q = typeof o.q === 'string' ? o.q.trim() : typeof o.question === 'string' ? o.question.trim() : '';
    const ans = typeof o.a === 'string' ? o.a.trim() : typeof o.answer === 'string' ? o.answer.trim() : '';
    if (!q || !ans || q.length > 300 || ans.length > 600 || seen.has(normQ(q))) continue;
    seen.add(normQ(q));
    out.push({ q, a: ans });
    if (out.length >= max) break;
  }
  return out;
}
