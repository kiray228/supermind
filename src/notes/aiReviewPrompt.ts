/**
 * Проверка связей ИИ: запрос и разбор ответа. Модуль чистый (без импортов времени выполнения) — тесты гоняют его в Node.
 *
 * ИИ получает заметку, важные слова, которые выбрал алгоритм, и заметки-кандидаты со своими общими словами,
 * и по смыслу решает: какие слова действительно о теме, каких тем не хватает, какие связи верны, а какие случайны.
 */
// с расширением: тесты в Node подключают модуль напрямую
import { termKey } from './links.ts';

export interface ReviewCandidate {
  id: string;
  title: string;
  /** начало текста */
  preview: string;
  /** важные слова той заметки */
  keywords: string[];
  /** общие слова, по которым алгоритм их связал */
  shared: string[];
  /** сейчас показывается как связанная */
  linked: boolean;
}

export interface ReviewInput {
  title: string;
  text: string;
  keywords: { key: string; form: string }[];
  candidates: ReviewCandidate[];
}

export interface ReviewResult {
  /** ключи неважных слов */
  drop: string[];
  /** пропущенные темы (как в тексте) */
  add: string[];
  /** решения по кандидатам (только те, о которых ИИ сказал) */
  links: { id: string; ok: boolean; why?: string }[];
}

/** Сколько текста заметки отправлять */
export const TEXT_LIMIT = 5000;
const MAX_ADD = 5;

export const REVIEW_SYSTEM = `Ты проверяешь автоматические связи между заметками в приложении «второй мозг».
Алгоритм сам выделил важные слова заметки и нашёл похожие заметки по общим словам. Оцени это по смыслу.

Ответь ТОЛЬКО одним JSON-объектом, без пояснений и без Markdown:
{"keywords":[{"n":1,"keep":true}],"missing":["тема"],"links":[{"n":1,"ok":true,"why":"коротко почему"}]}

keywords — оцени КАЖДОЕ слово из списка: keep=true, если оно отражает тему заметки и по нему стоит искать связи;
keep=false — если оно случайное, служебное или слишком общее («решил», «половину», «важно», «сегодня»).
missing — до 5 важных тем или терминов, которые ЕСТЬ в тексте заметки, но алгоритм их пропустил.
Пиши дословно как в тексте, 1–3 слова. Ничего не выдумывай. Нет таких — пустой список.
links — оцени КАЖДУЮ заметку-кандидата: ok=true, если по смыслу заметки связаны (общая тема, одна дополняет
или упоминает другую, их полезно открыть вместе); ok=false, если совпадение слов случайное.
why — до 8 слов, по-русски. Не добавляй заметок, которых нет в списке.`;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function buildReviewPrompt(inp: ReviewInput): string {
  const lines: string[] = [];
  lines.push(`Заметка «${inp.title.trim() || 'Без названия'}»:`, '"""', clip(inp.text.trim(), TEXT_LIMIT), '"""', '');
  lines.push('Важные слова, которые выбрал алгоритм:');
  inp.keywords.forEach((k, i) => lines.push(`${i + 1}. ${k.form}`));
  if (!inp.keywords.length) lines.push('(нет)');
  lines.push('', 'Заметки-кандидаты для связи:');
  inp.candidates.forEach((c, i) => {
    const parts = [`${i + 1}. «${clip(c.title.trim() || 'Без названия', 80)}»`];
    if (c.preview.trim()) parts.push(`начало: ${clip(c.preview.trim(), 160)}`);
    if (c.keywords.length) parts.push(`её темы: ${c.keywords.slice(0, 6).join(', ')}`);
    parts.push(c.shared.length ? `общие слова: ${c.shared.join(', ')}` : 'общих слов мало');
    parts.push(c.linked ? 'сейчас связаны' : 'сейчас не связаны');
    lines.push(parts.join(' — '));
  });
  if (!inp.candidates.length) lines.push('(нет)');
  return lines.join('\n');
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Первый JSON-объект в ответе: модель могла обернуть его в ```json … ``` или добавить слова */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf('{');
  if (start < 0) return null;
  // ищем парную скобку с учётом строк
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(src.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const idx = (v: unknown, len: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= len ? n - 1 : null;
};
const bool = (v: unknown): boolean | null => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);

/** Разобрать ответ ИИ. null — ответ не получилось понять */
export function parseReview(text: string, inp: ReviewInput): ReviewResult | null {
  const j = extractJson(text);
  if (!isObj(j)) return null;
  const out: ReviewResult = { drop: [], add: [], links: [] };

  // слова: убираем только явно отклонённые; все сразу убрать нельзя — самые весомые (до трёх, не меньше половины) остаются
  const drop = new Set<number>();
  if (Array.isArray(j.keywords))
    for (const k of j.keywords) {
      if (!isObj(k)) continue;
      const i = idx(k.n, inp.keywords.length);
      if (i !== null && bool(k.keep) === false) drop.add(i);
    }
  const keepMin = Math.min(3, Math.ceil(inp.keywords.length / 2));
  const order = [...drop].sort((a, b) => b - a);
  while (inp.keywords.length - order.length < keepMin && order.length) order.pop();
  out.drop = order.sort((a, b) => a - b).map((i) => inp.keywords[i].key);

  // пропущенные темы: только то, что действительно есть в тексте и даёт хоть один важный термин
  const body = norm(inp.title + '\n' + inp.text);
  const known = new Set(inp.keywords.map((k) => norm(k.form)));
  if (Array.isArray(j.missing))
    for (const m of j.missing) {
      if (typeof m !== 'string') continue;
      const phrase = m.trim().replace(/^[«"']+|[»"'.]+$/g, '');
      const words = phrase.split(/\s+/).filter(Boolean);
      if (!words.length || words.length > 3 || phrase.length > 60) continue;
      if (!body.includes(norm(phrase)) || known.has(norm(phrase))) continue;
      if (!words.some((w) => termKey(w))) continue;
      if (out.add.some((a) => norm(a) === norm(phrase))) continue;
      out.add.push(phrase);
      if (out.add.length >= MAX_ADD) break;
    }

  // связи: по номеру кандидата, повторы — первое решение
  const seen = new Set<number>();
  if (Array.isArray(j.links))
    for (const l of j.links) {
      if (!isObj(l)) continue;
      const i = idx(l.n, inp.candidates.length);
      const ok = bool(l.ok);
      if (i === null || ok === null || seen.has(i)) continue;
      seen.add(i);
      const why = typeof l.why === 'string' ? clip(l.why.trim().replace(/\s+/g, ' '), 90) : '';
      out.links.push(why ? { id: inp.candidates[i].id, ok, why } : { id: inp.candidates[i].id, ok });
    }
  return out;
}
