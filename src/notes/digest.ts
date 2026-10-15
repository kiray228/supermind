/**
 * Темы мозга и конспект темы: ИИ собирает записи одной темы графа в обзор (главное, решения, открытые вопросы)
 * со ссылками на источники; конспект можно сохранить заметкой. Запрос и перевод в заметку — digestPrompt.ts.
 */
import { create } from 'zustand';
import { streamText } from '../ai/claude';
import { bestPassages, clusterGraph, clusterTopics, keywordsOf, queryTerms } from './links';
import { type AskSource } from './askPrompt';
import { buildDigestPrompt, DIGEST_SYSTEM, digestToMarkdown } from './digestPrompt';
import { KIND_LABEL, parseItemId } from './brainDocs';
import { itemText } from './brain';
import { markdownToBlocks } from './model';
import { brainGraph, brainItem } from './related';
import { createNote, flushNotes, openNote, useNotes } from './store';

/** сколько записей темы отдавать ИИ и сколько текста из каждой */
const MAX_SOURCES = 20;
const PER_SOURCE = 1600;
const TOTAL = 22000;

export interface BrainTopic {
  /** номер темы (как цвет на графе) */
  c: number;
  name: string;
  /** записи темы — самые связанные первыми */
  ids: string[];
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Темы всего мозга (как «Темы» на графе): от больших к маленьким, не меньше min записей */
export async function brainTopics(min = 3): Promise<BrainTopic[]> {
  const { ix, edges: all } = await brainGraph();
  // заметки дня связаны цепочкой «прошлая запись» — по ней темы не склеиваются
  const days = new Set((useNotes.getState().data?.notes ?? []).filter((n) => n.day).map((n) => n.id));
  const edges = all.filter((e) => !(days.has(e.a) && days.has(e.b)));
  const ids = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
  const clusters = clusterGraph(
    ids,
    edges.map((e) => ({ a: e.a, b: e.b, score: e.score })),
  );
  const names = clusterTopics(ix, clusters);
  // сила связей записи внутри темы — кто в центре
  const weight = new Map<string, number>();
  for (const e of edges)
    if (clusters.get(e.a) === clusters.get(e.b)) {
      weight.set(e.a, (weight.get(e.a) ?? 0) + e.score);
      weight.set(e.b, (weight.get(e.b) ?? 0) + e.score);
    }
  const by = new Map<number, string[]>();
  for (const [id, c] of clusters) (by.get(c) ?? by.set(c, []).get(c)!).push(id);
  return [...by.entries()]
    .filter(([, list]) => list.length >= min)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
    .map(([c, list]) => ({
      c,
      name: capitalize(names.get(c) ?? 'Тема ' + (c + 1)),
      ids: list.sort((x, y) => (weight.get(y) ?? 0) - (weight.get(x) ?? 0)),
    }));
}

export interface DigestState {
  open: boolean;
  topic: string;
  ids: string[];
  state: 'idle' | 'collect' | 'write' | 'done' | 'error';
  text: string;
  sources: AskSource[];
  error?: string;
  /** сохранённая заметка */
  savedId?: string;
}

export const useDigest = create<DigestState>(() => ({ open: false, topic: '', ids: [], state: 'idle', text: '', sources: [] }));

let current: AbortController | null = null;
const fmtDate = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined);

/** Записи темы → источники для ИИ: из каждой — абзацы со словами темы */
export async function digestSources(topic: string, ids: string[]): Promise<AskSource[]> {
  const { ix } = await brainGraph();
  const sources: AskSource[] = [];
  // слова темы: её название и главные слова центральных записей
  const words = [topic, ...ids.slice(0, 6).flatMap((id) => keywordsOf(ix, id, 4))].join(' ');
  const keys = [...queryTerms(ix, words).keys()];
  let total = 0;
  // прошлые конспекты — не источники: ИИ пересказывал бы сам себя
  const digests = new Set((useNotes.getState().data?.notes ?? []).filter((n) => n.digest).map((n) => n.id));
  for (const id of ids) {
    if (sources.length >= MAX_SOURCES || total >= TOTAL) break;
    if (digests.has(id)) continue;
    const item = brainItem(id);
    if (!item) continue;
    const doc = await itemText(id).catch(() => null);
    if (!doc) continue;
    const full = [...(doc.headings ?? []), doc.text].filter(Boolean).join('\n');
    const text = bestPassages(full, keys, Math.min(PER_SOURCE, TOTAL - total), ix.canon) || item.preview;
    if (!text.trim()) continue;
    total += text.length;
    sources.push({ n: sources.length + 1, id, kind: KIND_LABEL[parseItemId(id).kind], title: item.title, date: fmtDate(item.at), text });
  }
  return sources;
}

/** Открыть конспект темы и сразу начать его составлять */
export function openDigest(topic: string, ids: string[]) {
  useDigest.setState({ open: true, topic, ids, state: 'idle', text: '', sources: [], error: undefined, savedId: undefined });
  void runDigest();
}

export function closeDigest() {
  current?.abort();
  useDigest.setState({ open: false });
}

export const stopDigest = () => current?.abort();

/** Составить конспект (заново) */
export async function runDigest(): Promise<void> {
  const { topic, ids } = useDigest.getState();
  current?.abort();
  const ac = new AbortController();
  current = ac;
  const patch = (p: Partial<DigestState>) => current === ac && useDigest.setState(p);
  patch({ state: 'collect', text: '', error: undefined, savedId: undefined });
  try {
    const sources = await digestSources(topic, ids);
    if (!sources.length) return void patch({ state: 'error', error: 'В записях темы пока нет текста — конспектировать нечего.' });
    patch({ sources, state: 'write' });
    const text = await streamText({
      system: DIGEST_SYSTEM,
      messages: [{ role: 'user', content: buildDigestPrompt(topic, sources) }],
      signal: ac.signal,
      effort: 'medium',
      onText: (full) => patch({ text: full }),
    });
    patch({ text, state: 'done' });
  } catch (e) {
    patch({ state: 'error', error: ac.signal.aborted ? 'Остановлено' : e instanceof Error ? e.message : 'Не удалось составить конспект' });
  } finally {
    if (current === ac) current = null;
  }
}

/** Название заметки-конспекта: «Конспект: Тема», а если такое уже есть — с датой */
export function digestTitle(topic: string, now = new Date()): string {
  const base = `Конспект: ${topic}`;
  const taken = (t: string) => (useNotes.getState().data?.notes ?? []).some((n) => !n.trashed && n.title.trim().toLowerCase() === t.toLowerCase());
  if (!taken(base)) return base;
  const date = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  let t = `${base} (${date})`;
  for (let i = 2; taken(t); i++) t = `${base} (${date}, ${i})`;
  return t;
}

/** Сохранить конспект заметкой: ссылки [n] становятся [[ссылками]] на записи темы */
export async function saveDigest(open = true): Promise<string | null> {
  const s = useDigest.getState();
  if (s.state !== 'done' || !s.text.trim()) return null;
  const m = createNote({ title: digestTitle(s.topic), digest: true, blocks: markdownToBlocks(digestToMarkdown(s.text, s.sources)) });
  if (!m) return null;
  await flushNotes();
  useDigest.setState({ savedId: m.id });
  if (open) {
    useDigest.setState({ open: false });
    await openNote(m.id);
    const { nav } = await import('../search/sources');
    await nav('notes');
  }
  return m.id;
}
