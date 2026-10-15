/**
 * Обзор мозга за неделю: заметки без связей, забытые, но связанные с тем, над чем человек работает сейчас,
 * дубли, длинные заметки (разбить по разделам) и темы для конспекта. Правила — reviewCore.ts.
 */
import type { ID } from '../types';
import { normTitle } from './links';
import { newBlock, type Block } from './model';
import { type Forgotten, LONG_WORDS, linkableTitle, RECENT_DAYS, reviewFindings, splitByHeadings } from './reviewCore';
import { allDuplicates } from './mentionsRuntime';
import { brainTopics, type BrainTopic } from './digest';
import { brainGraph, brainItems, ensureLinkIndex, rawFeatures } from './related';
import { createNote, editOpenBody, flushNotes, loadNoteBody, saveNoteBody, useNotes } from './store';

const DAY = 86400000;
/** напоминать об обзоре раз в столько дней */
export const REVIEW_EVERY_DAYS = 7;
const SEEN_KEY = 'sm-brain-review-at';
const MAX_LONG = 8;

export interface LongNote {
  id: ID;
  words: number;
  /** на сколько заметок разобьётся */
  parts: number;
}

export interface BrainReview {
  orphans: ID[];
  forgotten: Forgotten[];
  dups: number;
  long: LongNote[];
  topics: BrainTopic[];
}

/** Собрать обзор */
export async function collectReview(now = Date.now()): Promise<BrainReview> {
  await flushNotes();
  // связи — из графа (он считается один раз и обновляется по частям), а не заново для каждой заметки
  const { edges } = await brainGraph();
  const near = new Map<string, { id: string; score: number }[]>();
  for (const e of edges) {
    (near.get(e.a) ?? near.set(e.a, []).get(e.a)!).push({ id: e.b, score: e.score });
    (near.get(e.b) ?? near.set(e.b, []).get(e.b)!).push({ id: e.a, score: e.score });
  }
  for (const list of near.values()) list.sort((x, y) => y.score - x.score);
  const notes = (useNotes.getState().data?.notes ?? []).filter((n) => !n.trashed);
  const items = brainItems();
  // названия, на которые есть [[ссылки]], и записи, в которых они есть
  const linkedTitles = new Set<string>();
  const hasOut = new Set<string>();
  for (const it of items) {
    const w = rawFeatures(it.id)?.wiki ?? [];
    if (w.length) hasOut.add(it.id);
    for (const t of w) linkedTitles.add(normTitle(t));
  }
  const recent = new Map<string, number>();
  for (const it of items) if (it.at > now - RECENT_DAYS * DAY) recent.set(it.id, it.at);
  const related = (id: string) => (near.get(id) ?? []).map((x) => x.id);
  const found = reviewFindings({
    notes: notes.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt, wordCount: n.wordCount ?? 0 })),
    related,
    wiki: (id) => hasOut.has(id) || linkedTitles.has(normTitle(notes.find((n) => n.id === id)?.title ?? '')),
    recent,
    now,
  });
  const [dups, topics] = await Promise.all([allDuplicates().catch(() => []), brainTopics().catch(() => [])]);
  // длинные заметки с разделами
  const long: LongNote[] = [];
  for (const n of notes.filter((x) => (x.wordCount ?? 0) >= LONG_WORDS && !x.day && !x.digest).sort((a, b) => (b.wordCount ?? 0) - (a.wordCount ?? 0))) {
    if (long.length >= MAX_LONG) break;
    const body = await loadNoteBody(n.id).catch(() => null);
    const s = body && splitByHeadings(body);
    if (s) long.push({ id: n.id, words: n.wordCount ?? 0, parts: s.parts.length });
  }
  return { ...found, dups: dups.length, long, topics: topics.slice(0, 8) };
}

/** Сколько всего поводов заглянуть в обзор (для напоминания) */
export const reviewCount = (r: BrainReview) => r.orphans.length + r.forgotten.length + r.dups + r.long.length;

/** Пора ли напомнить об обзоре (на этом устройстве) */
export function reviewDue(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(SEEN_KEY)) || 0;
    if (!at) {
      // первый раз — не сразу после установки: через неделю
      localStorage.setItem(SEEN_KEY, String(now - (REVIEW_EVERY_DAYS - 1) * DAY));
      return false;
    }
    return now - at >= REVIEW_EVERY_DAYS * DAY;
  } catch {
    return false;
  }
}

/** Обзор просмотрен (или напоминание закрыто) — следующее через неделю */
export function markReviewSeen(now = Date.now()) {
  try {
    localStorage.setItem(SEEN_KEY, String(now));
  } catch {
    /* напомнит ещё раз — не страшно */
  }
}

/**
 * Разбить заметку по разделам: каждый раздел — отдельная заметка в той же папке,
 * в исходной остаются вступление и [[ссылки]] на разделы. Возвращает, сколько заметок создано.
 */
export async function splitNote(id: ID): Promise<number> {
  await flushNotes();
  const s = useNotes.getState();
  const meta = s.data?.notes.find((n) => n.id === id);
  if (!meta) return 0;
  const open = s.openId === id && s.openBody;
  const body = open ? s.openBody! : await loadNoteBody(id);
  const split = splitByHeadings(body);
  if (!split) return 0;
  const taken = new Set((s.data?.notes ?? []).filter((n) => !n.trashed).map((n) => normTitle(n.title)));
  const links: string[] = [];
  for (const p of split.parts) {
    // название раздела занято другой заметкой — уточнить названием исходной
    let title = linkableTitle(p.title) || 'Раздел';
    if (taken.has(normTitle(title))) title = linkableTitle(`${title} (${body.title || meta.title})`);
    for (let i = 2; taken.has(normTitle(title)); i++) title = linkableTitle(`${p.title} ${i}`);
    taken.add(normTitle(title));
    const blocks: Block[] = p.blocks.map((b) => ({ ...newBlock(b.type), ...b, id: newBlock().id }));
    if (createNote({ title, blocks: blocks.length ? blocks : undefined, folderId: meta.folderId })) links.push(title);
  }
  const blocks: Block[] = [...split.intro, newBlock('h2', { text: 'Разделы' }), ...links.map((t) => newBlock('bullet', { text: `[[${t}]]` }))];
  if (open) editOpenBody((bd) => void (bd.blocks = blocks));
  else saveNoteBody(id, { ...body, blocks });
  await flushNotes();
  void ensureLinkIndex().catch(() => undefined);
  return links.length;
}
