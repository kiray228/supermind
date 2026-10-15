/**
 * «Спросить у мозга»: вопрос своими словами → поиск по записям (заметки, карты, задачи, цели)
 * → ИИ отвечает только по найденному, со ссылками на источники.
 * Если прямых совпадений мало, ИИ сначала подсказывает синонимы («бег» → «пробежка», «тренировка»).
 */
import { create } from 'zustand';
import { streamText } from '../ai/claude';
import { bestPassages, queryTerms, searchIndex, type SearchHit } from './links';
import { ASK_SYSTEM, type AskSource, type AskTurn, buildAskMessages, EXPAND_SYSTEM, parseExpansion } from './askPrompt';
import { KIND_LABEL, parseItemId } from './brainDocs';
import { itemText } from './brain';
import { brainItem, ensureLinkIndex } from './related';

/** сколько записей отдавать ИИ и сколько текста из каждой */
const MAX_SOURCES = 8;
const PER_SOURCE = 2200;
const TOTAL = 14000;
/** совпадения слабые — попросить у ИИ синонимы и поискать ещё раз */
const WEAK_SCORE = 0.15;
const MIN_HITS = 3;

export interface AskEntry {
  id: string;
  q: string;
  a: string;
  sources: AskSource[];
  state: 'search' | 'answer' | 'done' | 'error';
  error?: string;
}

interface AskState {
  open: boolean;
  /** вопрос, который подставить в поле (из поиска по приложению) */
  draft: string;
  entries: AskEntry[];
}

export const useAsk = create<AskState>(() => ({ open: false, draft: '', entries: [] }));

export const openAsk = (draft = '') => useAsk.setState({ open: true, draft });
export const closeAsk = () => useAsk.setState({ open: false });
export const clearAsk = () => useAsk.setState({ entries: [] });

const fmtDate = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined);

/** Найти записи по вопросу; при слабых совпадениях — с синонимами от ИИ */
export async function findSources(question: string, history: AskTurn[], signal?: AbortSignal): Promise<{ sources: AskSource[]; expanded: string[] }> {
  const ix = await ensureLinkIndex();
  // короткий уточняющий вопрос («а под какой процент?») ищем вместе с прошлым
  const words = question.trim().split(/\s+/).length;
  const query = words <= 5 && history.length ? history[history.length - 1].q + ' ' + question : question;
  let hits: SearchHit[] = searchIndex(ix, query, { limit: MAX_SOURCES });
  let expanded: string[] = [];
  if (hits.length < MIN_HITS || (hits[0]?.score ?? 0) < WEAK_SCORE) {
    try {
      const raw = await streamText({ system: EXPAND_SYSTEM, messages: [{ role: 'user', content: query }], signal, effort: 'low' });
      expanded = parseExpansion(raw);
    } catch (e) {
      if (signal?.aborted) throw e;
      /* без синонимов — ищем как есть */
    }
    if (expanded.length) {
      const more = searchIndex(ix, query, { limit: MAX_SOURCES, extra: expanded });
      const seen = new Set(hits.map((h) => h.id));
      hits = [...hits, ...more.filter((h) => !seen.has(h.id))].sort((a, b) => b.score - a.score).slice(0, MAX_SOURCES);
    }
  }
  const keys = [...queryTerms(ix, query, expanded).keys()];
  const sources: AskSource[] = [];
  let total = 0;
  for (const h of hits) {
    const item = brainItem(h.id);
    if (!item || total >= TOTAL) continue;
    const doc = await itemText(h.id).catch(() => null);
    if (!doc) continue;
    const full = [...(doc.headings ?? []), doc.text].filter(Boolean).join('\n');
    const text = bestPassages(full, keys, Math.min(PER_SOURCE, TOTAL - total), ix.canon) || item.preview;
    total += text.length;
    sources.push({ n: sources.length + 1, id: h.id, kind: KIND_LABEL[parseItemId(h.id).kind], title: item.title, date: fmtDate(item.at), text });
  }
  return { sources, expanded };
}

let seq = 0;
let current: AbortController | null = null;

/** Остановить текущий ответ */
export const stopAsk = () => current?.abort();

/** Задать вопрос: ответ появляется в useAsk().entries по мере готовности */
export async function ask(question: string): Promise<void> {
  const q = question.trim();
  if (!q) return;
  current?.abort();
  const ac = new AbortController();
  current = ac;
  const id = 'q' + ++seq;
  const history = useAsk
    .getState()
    .entries.filter((e) => e.state === 'done')
    .map((e) => ({ q: e.q, a: e.a }));
  const patch = (p: Partial<AskEntry>) => useAsk.setState((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
  useAsk.setState((s) => ({ entries: [...s.entries, { id, q, a: '', sources: [], state: 'search' }], draft: '' }));
  try {
    const { sources } = await findSources(q, history, ac.signal);
    if (ac.signal.aborted) return patch({ state: 'error', error: 'Остановлено' });
    if (!sources.length) return patch({ state: 'done', sources, a: 'В ваших записях об этом ничего не нашлось. Попробуйте спросить другими словами или назвать тему точнее.' });
    patch({ sources, state: 'answer' });
    const answer = await streamText({
      system: ASK_SYSTEM,
      messages: buildAskMessages(q, sources, history),
      signal: ac.signal,
      effort: 'medium',
      onText: (full) => patch({ a: full }),
    });
    patch({ a: answer, state: 'done' });
  } catch (e) {
    patch({ state: 'error', error: ac.signal.aborted ? 'Остановлено' : e instanceof Error ? e.message : 'Не удалось получить ответ' });
  } finally {
    if (current === ac) current = null;
  }
}

/** Источник ответа по номеру */
export const sourceOf = (entry: AskEntry, n: number): AskSource | undefined => entry.sources.find((s) => s.n === n);
