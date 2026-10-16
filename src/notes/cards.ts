/**
 * Карточки для повторения в приложении: ИИ делает вопросы и ответы из заметки, человек повторяет их
 * по графику (интервальное повторение). Карточки хранятся в индексе заметок (cards) — синхронизируются вместе с ними.
 * Правила — cardsCore.ts.
 */
import { create } from 'zustand';
import { streamText } from '../ai/claude';
import type { ID } from '../types';
import { todayYmd } from '../utils/mapTasks';
import { uid } from '../utils/tree';
import { bodyPlainText, type StudyCard } from './model';
import { buildCardsPrompt, CARDS_SYSTEM, dueCards, type Grade, newCard, parseCards, schedule } from './cardsCore';
import { flushNotes, loadNoteBody, mutateNotes, useNotes } from './store';

/** меньше — делать карточки не из чего */
const MIN_WORDS = 15;

export class CardsError extends Error {
  override name = 'CardsError';
}

/** Утреннее уведомление считает карточки на день — пересчитать расписание (с паузой) */
const replan = () => void import('../tasks/sync').then((m) => m.syncSoon(8000)).catch(() => undefined);

const alive = () => new Set((useNotes.getState().data?.notes ?? []).filter((n) => !n.trashed).map((n) => n.id));

/** Карточки заметки */
export const cardsOf = (noteId: ID): StudyCard[] => (useNotes.getState().data?.cards ?? []).filter((c) => c.noteId === noteId);

/** Карточки на сегодня (заметки в корзине — не показываются) */
export function todaysCards(today = todayYmd()): StudyCard[] {
  const ok = alive();
  return dueCards(
    (useNotes.getState().data?.cards ?? []).filter((c) => ok.has(c.noteId)),
    today,
  );
}

/** Сделать карточки из заметки (ИИ). Возвращает, сколько добавлено */
export async function makeCards(noteId: ID, signal?: AbortSignal): Promise<number> {
  await flushNotes();
  const meta = useNotes.getState().data?.notes.find((n) => n.id === noteId);
  if (!meta) throw new CardsError('Заметка не найдена');
  const body = await loadNoteBody(noteId);
  const text = bodyPlainText(body).trim();
  if (text.split(/\s+/).length < MIN_WORDS) throw new CardsError('В заметке мало текста — запоминать пока нечего.');
  const existing = cardsOf(noteId).map((c) => c.q);
  const answer = await streamText({ system: CARDS_SYSTEM, messages: [{ role: 'user', content: buildCardsPrompt(body.title || meta.title, text, existing) }], signal, effort: 'low' });
  const found = parseCards(answer, existing);
  if (!found.length) return 0;
  const today = todayYmd();
  const now = Date.now();
  mutateNotes((d) => {
    const list = (d.cards ??= []);
    for (const f of found) list.push(newCard({ id: uid(), noteId, q: f.q, a: f.a, by: 'ai' }, today, now));
  });
  replan();
  return found.length;
}

/** Своя карточка */
export function addCard(noteId: ID, q: string, a: string): StudyCard | null {
  if (!q.trim() || !a.trim()) return null;
  const c = newCard({ id: uid(), noteId, q: q.trim(), a: a.trim(), by: 'user' }, todayYmd());
  mutateNotes((d) => void (d.cards ??= []).push(c));
  return c;
}

/** Исправить вопрос или ответ */
export function editCard(id: ID, patch: { q?: string; a?: string }) {
  mutateNotes((d) => {
    const c = d.cards?.find((x) => x.id === id);
    if (!c) return;
    if (patch.q?.trim()) c.q = patch.q.trim();
    if (patch.a?.trim()) c.a = patch.a.trim();
    c.updatedAt = Date.now();
  });
}

export function deleteCard(id: ID) {
  mutateNotes((d) => {
    d.cards = (d.cards ?? []).filter((c) => c.id !== id);
    (d.gone ??= {})[`card:${id}`] = Date.now();
  });
}

/** Ответ на карточку: новое время показа. Возвращает прежнее состояние — для «Отменить» */
export function gradeCard(id: ID, g: Grade): StudyCard | null {
  let prev: StudyCard | null = null;
  mutateNotes((d) => {
    const i = d.cards?.findIndex((c) => c.id === id) ?? -1;
    if (i < 0) return;
    prev = { ...d.cards![i] };
    d.cards![i] = schedule(d.cards![i], g, todayYmd());
  });
  replan();
  return prev;
}

/** Вернуть карточку как была (отмена оценки) */
export function restoreCard(c: StudyCard) {
  mutateNotes((d) => {
    const i = d.cards?.findIndex((x) => x.id === c.id) ?? -1;
    if (i >= 0) d.cards![i] = { ...c, updatedAt: Date.now() };
  });
}

// ---------- Окна ----------

interface CardsUi {
  /** идёт повторение */
  review: boolean;
  /** повторение начать с этой карточки */
  first?: ID;
  /** и сразу показать ответ */
  flipped?: boolean;
  /** открыт список карточек заметки */
  noteId: ID | null;
}

export const useCardsUi = create<CardsUi>(() => ({ review: false, noteId: null }));
export const openCardsReview = () => useCardsUi.setState({ review: true, noteId: null, first: undefined, flipped: false });
/** Повторение с этой карточки (из уведомления); flipped — сразу с ответом */
export const openCardsAt = (first: ID, flipped = false) => useCardsUi.setState({ review: true, noteId: null, first, flipped });
export const openNoteCards = (noteId: ID) => useCardsUi.setState({ noteId, review: false });
export const closeCards = () => useCardsUi.setState({ review: false, noteId: null });
