/**
 * Проверка связей ИИ: важные слова заметки и её связи оцениваются по смыслу.
 * Решения хранятся в индексе заметок (aiTerms, aiLinks) — синхронизируются и попадают в копии вместе с заметками.
 * Решение человека («Вернуть», «Убрать связь») ИИ не меняет.
 */
import { streamText } from '../ai/claude';
import type { ID } from '../types';
import { keywordTerms, keywordsOf, pairKey, relatedTo } from './links';
import { bodyPlainText, type AiLinkReview, type AiTermsReview } from './model';
import { buildReviewPrompt, parseReview, REVIEW_SYSTEM, type ReviewCandidate, type ReviewInput } from './aiReviewPrompt';
import { ensureLinkIndex, rawFeatures } from './related';
import { loadNoteBody, mutateNotes, useNotes } from './store';

/** сколько заметок-кандидатов показывать ИИ: связанные сейчас + близкие, но не дотянувшие до порога */
const CANDIDATES = 10;
/** слабее порога связи: ИИ видит и пары с одним общим словом — среди них бывают настоящие связи */
const NEAR_MIN = 0.015;

export interface ReviewSummary {
  noteId: ID;
  dropped: string[];
  added: string[];
  confirmed: { id: ID; why?: string }[];
  rejected: { id: ID; why?: string }[];
  /** связи, которых алгоритм не видел, а ИИ счёл верными */
  found: { id: ID; why?: string }[];
  /** вернуть всё как было до проверки */
  undo: () => void;
}

export class ReviewError extends Error {}

/** Проверка заметки устарела: заметку меняли после неё */
export function reviewState(id: ID): { review: AiTermsReview; stale: boolean } | null {
  const d = useNotes.getState().data;
  const r = d?.aiTerms?.find((x) => x.id === id);
  const m = d?.notes.find((n) => n.id === id);
  return r && m ? { review: r, stale: r.at !== m.updatedAt } : null;
}

/** Проверить заметку ИИ и применить решения */
export async function reviewNote(id: ID, signal?: AbortSignal): Promise<ReviewSummary> {
  const ix = await ensureLinkIndex();
  const data = useNotes.getState().data;
  const meta = data?.notes.find((n) => n.id === id);
  const raw = rawFeatures(id);
  if (!meta || !raw || !ix.docs.has(id)) throw new ReviewError('В заметке пока мало текста — проверять нечего.');
  const body = await loadNoteBody(id);

  // что видит ИИ: выбор алгоритма без прежних правок и связи без прежних решений
  const keywords = keywordTerms(ix, raw, 10);
  const shown = new Set(relatedTo(ix, id).map((r) => r.id));
  const near = relatedTo(ix, id, { raw: true, loose: true, min: NEAR_MIN, limit: CANDIDATES });
  const pairs = new Map((data?.aiLinks ?? []).map((r) => [r.id, r]));
  // подтверждённые раньше ИИ (но не человеком) — тоже на пересмотр
  for (const r of relatedTo(ix, id)) if (r.confirmed && !near.some((x) => x.id === r.id) && pairs.get(pairKey(id, r.id))?.by !== 'user') near.push(r);
  const candidates: ReviewCandidate[] = near
    .filter((r) => pairs.get(pairKey(id, r.id))?.by !== 'user')
    .slice(0, CANDIDATES + 4)
    .map((r) => {
      const m = data!.notes.find((n) => n.id === r.id);
      return { id: r.id, title: m?.title ?? '', preview: m?.preview ?? '', keywords: keywordsOf(ix, r.id, 6), shared: r.terms, linked: shown.has(r.id) };
    });
  const input: ReviewInput = { title: body.title, text: bodyPlainText(body), keywords, candidates };

  const answer = await streamText({ system: REVIEW_SYSTEM, messages: [{ role: 'user', content: buildReviewPrompt(input) }], signal, effort: 'low' });
  const res = parseReview(answer, input);
  if (!res) throw new ReviewError('ИИ ответил непонятно — попробуйте ещё раз.');

  // запомнить, как было, — для «Отменить»
  const cur = useNotes.getState().data;
  const prevTerms = cur?.aiTerms?.find((r) => r.id === id);
  const touched = res.links.map((l) => pairKey(id, l.id));
  const prevLinks = new Map(touched.map((k) => [k, cur?.aiLinks?.find((r) => r.id === k)]));

  // слово в индексе может объединять несколько форм заметки («тренировка», «тренировок») — убираются все
  const rawOf = new Map(keywords.map((k) => [k.key, k.raw]));
  const dropRaw = [...new Set(res.drop.flatMap((k) => rawOf.get(k) ?? [k]))];

  const now = Date.now();
  const checkedAt = useNotes.getState().data?.notes.find((n) => n.id === id)?.updatedAt ?? meta.updatedAt;
  mutateNotes((d) => {
    const terms = (d.aiTerms ??= []);
    const entry: AiTermsReview = { id, at: checkedAt, drop: dropRaw, add: res.add, checkedAt: now, updatedAt: now };
    const i = terms.findIndex((r) => r.id === id);
    if (i >= 0) terms[i] = entry;
    else terms.push(entry);
    const links = (d.aiLinks ??= []);
    for (const l of res.links) {
      const key = pairKey(id, l.id);
      const j = links.findIndex((r) => r.id === key);
      if (j >= 0 && links[j].by === 'user') continue;
      const v: AiLinkReview = { id: key, ok: l.ok, by: 'ai', updatedAt: now, ...(l.why ? { why: l.why } : {}) };
      if (j >= 0) links[j] = v;
      else links.push(v);
    }
  });
  // человек ждёт результата — пересчитать связи сразу, не дожидаясь паузы
  void ensureLinkIndex().catch(() => undefined);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const dropForms = new Map(keywords.map((k) => [k.key, k.form]));
  return {
    noteId: id,
    dropped: res.drop.map((k) => dropForms.get(k) ?? k),
    added: res.add,
    confirmed: res.links.filter((l) => l.ok && byId.get(l.id)?.linked).map(({ id: x, why }) => ({ id: x, why })),
    rejected: res.links.filter((l) => !l.ok && byId.get(l.id)?.linked).map(({ id: x, why }) => ({ id: x, why })),
    found: res.links.filter((l) => l.ok && !byId.get(l.id)?.linked).map(({ id: x, why }) => ({ id: x, why })),
    undo: () => {
      mutateNotes((d) => {
        d.aiTerms = (d.aiTerms ?? []).filter((r) => r.id !== id);
        if (prevTerms) d.aiTerms.push(prevTerms);
        else (d.gone ??= {})[`aiTerm:${id}`] = Date.now();
        const links = (d.aiLinks ?? []).filter((r) => !prevLinks.has(r.id) || r.by === 'user');
        for (const [k, v] of prevLinks) {
          if (v?.by === 'user') continue;
          if (v) links.push({ ...v, updatedAt: Date.now() });
          else if (!links.some((r) => r.id === k)) (d.gone ??= {})[`aiLink:${k}`] = Date.now();
        }
        d.aiLinks = links;
      });
      void ensureLinkIndex().catch(() => undefined);
    },
  };
}

/** Решение человека по паре: true — связь верна, false — убрать; null — снять решение (как решит алгоритм) */
export function setLinkVerdict(a: ID, b: ID, ok: boolean | null) {
  const key = pairKey(a, b);
  mutateNotes((d) => {
    const links = (d.aiLinks ??= []).filter((r) => r.id !== key);
    if (ok !== null) links.push({ id: key, ok, by: 'user', updatedAt: Date.now() });
    else (d.gone ??= {})[`aiLink:${key}`] = Date.now();
    d.aiLinks = links;
  });
  void ensureLinkIndex().catch(() => undefined);
}

/** Почему ИИ (или человек) так решил по паре */
export function linkVerdict(a: ID, b: ID): AiLinkReview | undefined {
  return useNotes.getState().data?.aiLinks?.find((r) => r.id === pairKey(a, b));
}

/** Заметки, которые стоит проверить: ещё не проверенные или изменённые после проверки (и с текстом) */
export async function notesToReview(ids: ID[]): Promise<ID[]> {
  const ix = await ensureLinkIndex();
  return ids.filter((id) => {
    if (!ix.docs.has(id)) return false;
    const st = reviewState(id);
    return !st || st.stale;
  });
}
