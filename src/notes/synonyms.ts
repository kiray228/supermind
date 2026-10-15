/**
 * Синонимы по смыслу в приложении: ИИ ищет в словаре записей слова одного понятия («бег», «пробежка»),
 * человек правит группы. Группы хранятся в индексе заметок (synonyms) — синхронизируются вместе с заметками;
 * связи и поиск считают слова группы одним словом. Чистая логика — в synonymsCore.ts.
 */
import { streamText } from '../ai/claude';
import { uid } from '../utils/tree';
import { termKey, vocabulary } from './links';
import type { NotesData, SynonymGroup } from './model';
import { addManualGroup, buildSynonymPrompt, groupPairs, mergeAiGroups, parseManualGroup, parseSynonymGroups, SYN_SYSTEM, withoutWord } from './synonymsCore';
import { ensureLinkIndex } from './related';
import { mutateNotes, useNotes } from './store';

/** сколько главных слов показывать ИИ */
const DICT = 300;
/** меньше слов — искать синонимы не из чего */
const MIN_WORDS = 12;

export class SynonymError extends Error {}

export const synonymGroups = (): SynonymGroup[] => useNotes.getState().data?.synonyms ?? [];

const reindex = () => void ensureLinkIndex().catch(() => undefined);

function reject(d: NotesData, pairs: string[], now: number) {
  const list = (d.synNo ??= []);
  const have = new Set(list.map((r) => r.id));
  for (const p of pairs) if (!have.has(p)) list.push({ id: p, updatedAt: now });
}

/** Попросить ИИ найти синонимы среди главных слов всех записей. Возвращает, сколько слов добавлено в группы */
export async function findSynonyms(signal?: AbortSignal): Promise<number> {
  const ix = await ensureLinkIndex();
  const words = vocabulary(ix, DICT).map((v) => v.form);
  if (words.length < MIN_WORDS) throw new SynonymError('В записях пока мало слов — синонимы искать не из чего.');
  const answer = await streamText({ system: SYN_SYSTEM, messages: [{ role: 'user', content: buildSynonymPrompt(words) }], signal, effort: 'low' });
  const found = parseSynonymGroups(answer, words, termKey);
  const rejected = new Set((useNotes.getState().data?.synNo ?? []).map((r) => r.id));
  let added = 0;
  mutateNotes((d) => {
    const r = mergeAiGroups(d.synonyms ?? [], found, rejected, termKey, Date.now(), uid);
    d.synonyms = r.groups;
    added = r.added;
  });
  if (added) reindex();
  return added;
}

/** Убрать слово из группы — ИИ больше не объединит его с остальными словами группы */
export function removeSynonymWord(groupId: string, word: string) {
  mutateNotes((d) => {
    const g = d.synonyms?.find((x) => x.id === groupId);
    if (!g) return;
    const now = Date.now();
    const r = withoutWord(g, word, termKey, now);
    reject(d, r.rejected, now);
    if (r.group) d.synonyms = d.synonyms!.map((x) => (x.id === groupId ? r.group! : x));
    else {
      d.synonyms = d.synonyms!.filter((x) => x.id !== groupId);
      (d.gone ??= {})[`synonym:${groupId}`] = now;
    }
  });
  reindex();
}

/** Удалить группу целиком — её слова ИИ больше не объединит */
export function removeSynonymGroup(groupId: string) {
  mutateNotes((d) => {
    const g = d.synonyms?.find((x) => x.id === groupId);
    if (!g) return;
    const now = Date.now();
    reject(d, groupPairs(g.words, termKey), now);
    d.synonyms = d.synonyms!.filter((x) => x.id !== groupId);
    (d.gone ??= {})[`synonym:${groupId}`] = now;
  });
  reindex();
}

/** Своя группа: «бег = пробежка, забег». null — меньше двух разных слов */
export function addSynonymGroup(text: string): string[] | null {
  const words = parseManualGroup(text);
  let out: string[] | null = null;
  mutateNotes((d) => {
    const now = Date.now();
    const r = addManualGroup(d.synonyms ?? [], words, termKey, now, uid);
    if (!r) return;
    d.synonyms = r.groups;
    for (const id of r.removed) (d.gone ??= {})[`synonym:${id}`] = now;
    // человек сам назвал эти слова синонимами — снять прежние «не синонимы»
    const allowed = new Set(r.allowed);
    if (d.synNo?.some((x) => allowed.has(x.id))) {
      for (const x of d.synNo) if (allowed.has(x.id)) (d.gone ??= {})[`synNo:${x.id}`] = now;
      d.synNo = d.synNo.filter((x) => !allowed.has(x.id));
    }
    out = r.groups[r.groups.length - 1].words;
  });
  if (out) reindex();
  return out;
}
