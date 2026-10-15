/**
 * «Спросить у мозга»: запрос к ИИ по найденным записям и разбор ссылок на источники в ответе.
 * Модуль чистый — тесты гоняют его в Node.
 */

export interface AskSource {
  /** номер в ответе: [1], [2]… */
  n: number;
  id: string;
  /** «Заметка», «Карта», «Задача», «Цель» */
  kind: string;
  title: string;
  /** когда менялась (для вопросов «когда») */
  date?: string;
  /** выбранные абзацы */
  text: string;
}

export interface AskTurn {
  q: string;
  a: string;
}

export const ASK_SYSTEM = `Ты — «второй мозг» пользователя: отвечаешь на его вопрос по его же записям (заметки, интеллект-карты, задачи, цели).
Правила:
— Отвечай ТОЛЬКО по источникам ниже. Если в них нет ответа — так и скажи одной фразой и подскажи, о чём в записях есть близкое.
— После каждого утверждения ставь номер источника в квадратных скобках: [1], [2] или [1, 3].
— Пиши кратко и по делу, по-русски (или на языке вопроса). Можно списки «- ». Без вступлений и без пересказа вопроса.
— Не придумывай факты, даты и числа, которых нет в источниках.`;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Сообщения для ИИ: прошлые вопросы и ответы (контекст беседы), затем источники и новый вопрос */
export function buildAskMessages(question: string, sources: AskSource[], history: AskTurn[] = []): { role: 'user' | 'assistant'; content: string }[] {
  const msgs: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of history.slice(-3)) {
    msgs.push({ role: 'user', content: t.q });
    msgs.push({ role: 'assistant', content: clip(t.a, 1500) });
  }
  const src = sources.map((s) => [`[${s.n}] ${s.kind} «${clip(s.title.trim() || 'Без названия', 120)}»${s.date ? ` (${s.date})` : ''}`, s.text.trim()].join('\n')).join('\n\n');
  msgs.push({ role: 'user', content: `Источники:\n\n${src}\n\nВопрос: ${question.trim()}` });
  return msgs;
}

export type AnswerPart = { t: 'text'; s: string } | { t: 'cite'; n: number[] };

/** Ответ → куски текста и ссылки на источники ([1], [1, 3], [1][2], [1–3]); номера вне списка выбрасываются */
export function splitCitations(text: string, count: number): AnswerPart[] {
  const out: AnswerPart[] = [];
  const re = /\[(\d{1,2}(?:\s*(?:[,;]|–|-)\s*\d{1,2})*)\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const nums: number[] = [];
    for (const part of m[1].split(/\s*[,;]\s*/)) {
      const r = /^(\d+)\s*[–-]\s*(\d+)$/.exec(part);
      if (r) for (let i = +r[1]; i <= +r[2] && i - +r[1] < 10; i++) nums.push(i);
      else nums.push(+part);
    }
    const ok = [...new Set(nums.filter((x) => x >= 1 && x <= count))];
    if (!ok.length) continue;
    if (m.index! > last) out.push({ t: 'text', s: text.slice(last, m.index) });
    // соседние ссылки [1][2] — одним куском
    const prev = out[out.length - 1];
    if (prev?.t === 'cite' && m.index === last) prev.n = [...new Set([...prev.n, ...ok])];
    else out.push({ t: 'cite', n: ok });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', s: text.slice(last) });
  return out;
}

/** Номера источников, на которые ответ действительно сослался */
export function citedSources(text: string, count: number): number[] {
  const set = new Set<number>();
  for (const p of splitCitations(text, count)) if (p.t === 'cite') p.n.forEach((n) => set.add(n));
  return [...set].sort((a, b) => a - b);
}

export const EXPAND_SYSTEM = `Помоги найти записи по вопросу пользователя. Дай 4–10 слов и коротких словосочетаний,
которыми это могло быть написано в заметках: синонимы, близкие термины, однокоренные слова, названия.
Ответ — ТОЛЬКО список через запятую, без пояснений.`;

/** Слова для расширенного поиска из ответа ИИ (не больше 12, без повторов и мусора) */
export function parseExpansion(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.replace(/\n/g, ',').split(/[,;]/)) {
    const w = raw
      .replace(/^[\s\-–•*\d.)]+/, '')
      .replace(/["«»“”]/g, '')
      .trim();
    const k = w.toLowerCase();
    if (!w || w.length > 40 || w.split(/\s+/).length > 3 || seen.has(k)) continue;
    seen.add(k);
    out.push(w);
    if (out.length >= 12) break;
  }
  return out;
}
