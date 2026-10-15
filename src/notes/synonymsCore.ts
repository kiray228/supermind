/**
 * Синонимы по смыслу: запрос к ИИ со словарём записей, разбор ответа и правила изменения групп.
 * Модуль чистый — тесты гоняют его в Node.
 */
import type { SynonymGroup } from './model';

export const SYN_SYSTEM = `Тебе дан словарь слов из личных заметок. Найди группы СИНОНИМОВ — разных слов для ОДНОГО понятия:
«бег, пробежка», «машина, автомобиль, авто», «заработок, доход», «ИИ, нейросеть».
Не объединяй слова, которые просто относятся к одной теме: «бюджет» и «инвестиции», «бег» и «кроссовки» — разные понятия.
Не объединяй однокоренные слова с разным смыслом и разные формы одного слова.
Бери слова ТОЛЬКО из словаря, как они там написаны. В группе 2–6 слов. Каждое слово — не больше чем в одной группе.
Ответ — ТОЛЬКО JSON-массив групп, без пояснений: [["бег","пробежка"],["доход","заработок"]]. Нет синонимов — [].`;

export function buildSynonymPrompt(words: string[]): string {
  return 'Словарь:\n' + words.join(', ');
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();

/** Первый JSON-массив в ответе (модель могла обернуть его в ```json или добавить слова) */
function extractArray(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : text;
  const a = src.indexOf('[');
  const b = src.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(src.slice(a, b + 1));
  } catch {
    return null;
  }
}

/**
 * Группы из ответа ИИ: только слова словаря (в написании словаря), без повторов,
 * каждое слово — в одной группе, в группе 2–6 слов. keyOf — ключ слова: разные формы одного слова — не синонимы.
 */
export function parseSynonymGroups(text: string, dict: string[], keyOf: (w: string) => string | null = norm): string[][] {
  const arr = extractArray(text);
  if (!Array.isArray(arr)) return [];
  const byNorm = new Map(dict.map((w) => [norm(w), w]));
  const used = new Set<string>();
  const out: string[][] = [];
  for (const g of arr) {
    if (!Array.isArray(g)) continue;
    const words: string[] = [];
    const keys = new Set<string>();
    for (const raw of g) {
      if (typeof raw !== 'string') continue;
      const w = byNorm.get(norm(raw));
      const k = w ? keyOf(w) : null;
      if (!w || !k || used.has(w) || keys.has(k)) continue;
      words.push(w);
      keys.add(k);
      if (words.length >= 6) break;
    }
    if (words.length < 2) continue;
    words.forEach((w) => used.add(w));
    out.push(words);
  }
  return out;
}

/** «бег = пробежка, забег» → ["бег", "пробежка", "забег"] (своя группа, введённая человеком; синоним — одно слово) */
export function parseManualGroup(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[=,;/\s]+|[—–]/)) {
    const w = raw.trim().replace(/^["«'(]+|["»').!?:]+$/g, '');
    if (!w || w === '-' || w.length > 40 || seen.has(norm(w))) continue;
    seen.add(norm(w));
    out.push(w);
  }
  return out.slice(0, 8);
}

// ---------- Изменение групп ----------

type KeyOf = (w: string) => string | null;

/** Ключ пары слов, которую человек убрал из синонимов (synNo) — один на пару */
export const synPair = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);

const keysOf = (words: string[], keyOf: KeyOf) => words.map(keyOf).filter((k): k is string => !!k);

/**
 * Добавить группы от ИИ к имеющимся. Слово, которое уже есть в группе, не повторяется;
 * группа, у которой есть общее слово с имеющейся, дополняет её; пары, убранные человеком, не возвращаются.
 * Возвращает новый список групп и сколько слов добавлено.
 */
export function mergeAiGroups(
  existing: SynonymGroup[],
  found: string[][],
  rejected: Set<string>,
  keyOf: KeyOf,
  now: number,
  newId: () => string,
): { groups: SynonymGroup[]; added: number } {
  const groups = existing.map((g) => ({ ...g, words: [...g.words] }));
  const where = new Map<string, number>();
  groups.forEach((g, i) => keysOf(g.words, keyOf).forEach((k) => where.has(k) || where.set(k, i)));
  const fits = (k: string, keys: string[]) => keys.every((x) => x !== k && !rejected.has(synPair(k, x)));
  let added = 0;
  for (const fg of found) {
    const items = fg.flatMap((w) => {
      const k = keyOf(w);
      return k ? [{ w, k }] : [];
    });
    const hit = items.map((x) => where.get(x.k)).find((i) => i !== undefined);
    if (hit !== undefined) {
      const g = groups[hit];
      const keys = keysOf(g.words, keyOf);
      for (const x of items) {
        if (where.has(x.k) || !fits(x.k, keys)) continue;
        g.words.push(x.w);
        keys.push(x.k);
        where.set(x.k, hit);
        g.updatedAt = now;
        added++;
      }
    } else {
      const words: string[] = [];
      const keys: string[] = [];
      for (const x of items) {
        if (!fits(x.k, keys)) continue;
        words.push(x.w);
        keys.push(x.k);
      }
      if (words.length < 2) continue;
      keys.forEach((k) => where.set(k, groups.length));
      groups.push({ id: newId(), words, by: 'ai', updatedAt: now });
      added += words.length;
    }
  }
  return { groups, added };
}

/** Убрать слово из группы: пары этого слова с остальными запоминаются как «не синонимы»; группа из одного слова исчезает */
export function withoutWord(g: SynonymGroup, word: string, keyOf: KeyOf, now: number): { group: SynonymGroup | null; rejected: string[] } {
  const k = keyOf(word);
  const rest = g.words.filter((w) => w !== word);
  const rejected = k ? [...new Set(keysOf(rest, keyOf).filter((x) => x !== k).map((x) => synPair(k, x)))] : [];
  return { group: rest.length >= 2 ? { ...g, words: rest, updatedAt: now } : null, rejected };
}

/** Все пары слов группы — когда человек удаляет группу целиком */
export function groupPairs(words: string[], keyOf: KeyOf): string[] {
  const keys = [...new Set(keysOf(words, keyOf))];
  const out: string[] = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) out.push(synPair(keys[i], keys[j]));
  return out;
}

/**
 * Своя группа человека. Если её слова уже есть в группах — те группы сливаются с ней в одну (её «автор» — человек).
 * Возвращает новый список групп, удалённые группы (их id) и пары, которые больше не «не синонимы».
 */
export function addManualGroup(
  existing: SynonymGroup[],
  words: string[],
  keyOf: KeyOf,
  now: number,
  newId: () => string,
): { groups: SynonymGroup[]; removed: string[]; allowed: string[] } | null {
  const mine: string[] = [];
  const keys = new Set<string>();
  for (const w of words) {
    const k = keyOf(w);
    if (!k || keys.has(k)) continue;
    keys.add(k);
    mine.push(w);
  }
  if (mine.length < 2) return null;
  const touched = existing.filter((g) => keysOf(g.words, keyOf).some((k) => keys.has(k)));
  const all = [...mine];
  for (const g of touched)
    for (const w of g.words) {
      const k = keyOf(w);
      if (k && !keys.has(k)) {
        keys.add(k);
        all.push(w);
      }
    }
  const keep = touched[0];
  const merged: SynonymGroup = { id: keep?.id ?? newId(), words: all, by: 'user', updatedAt: now };
  const groups = existing.filter((g) => !touched.includes(g));
  groups.push(merged);
  return { groups, removed: touched.slice(1).map((g) => g.id), allowed: groupPairs(mine, keyOf) };
}
