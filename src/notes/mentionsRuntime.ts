/**
 * «Упоминается в» и дубли в приложении: где упоминается название записи, как сделать упоминание ссылкой,
 * какие заметки почти одинаковы и как их объединить. Чистая логика — в backlinks.ts.
 */
import type { ID } from '../types';
import { DUP_SCORE, duplicatesOf, findDuplicates, normTitle, pairKey, tokenize } from './links';
import { hasWikiTo, linkOccurrence, mergeBodies, retargetWiki, snippetAround, titleMentions } from './backlinks';
import { parseItemId, type BrainKind } from './brainDocs';
import { itemText } from './brain';
import { brainItem, brainItems, ensureLinkIndex, linkIndex, rawFeatures } from './related';
import { editOpenBody, flushNotes, loadNoteBody, mutateNotes, saveNoteBody, trashNote, useNotes } from './store';

export interface Backlink {
  id: string;
  kind: BrainKind;
  title: string;
  /** есть явная [[ссылка]] */
  linked: boolean;
  /** упоминаний без ссылки */
  count: number;
  /** первое упоминание без ссылки — для показа и «Сделать ссылкой» */
  snippet?: { before: string; match: string; after: string };
  /** где оно (только у заметок — их можно править) */
  at?: { blockId: string; start: number; end: number };
}

const MAX = 30;
/** сколько текста вокруг упоминания: само слово должно уместиться в две строки карточки */
const SNIPPET = 32;

/** Записи, которые ссылаются на эту или упоминают её название */
export async function findBacklinks(id: ID): Promise<Backlink[]> {
  const ix = await ensureLinkIndex();
  const me = brainItem(id);
  const title = me?.title.trim();
  if (!me || !title) return [];
  const k = normTitle(title);
  // значимые слова названия (ключи индекса) — быстро отсеять записи, где их нет вовсе
  const keys = [...new Set(tokenize(title).flatMap((t) => (t ? [ix.canon(t.key)] : [])))];
  const out: Backlink[] = [];
  for (const it of brainItems()) {
    if (it.id === id || out.length >= MAX) continue;
    const f = rawFeatures(it.id);
    const linked = !!f?.wiki?.some((w) => normTitle(w) === k);
    const doc = ix.docs.get(it.id);
    const maybe = keys.length > 0 && !!doc && keys.every((x) => doc.w.has(x));
    if (!linked && !maybe) continue;
    let count = 0;
    let first: Backlink['snippet'];
    let at: Backlink['at'];
    if (it.kind === 'note') {
      const body = await loadNoteBody(it.id).catch(() => null);
      for (const b of body?.blocks ?? []) {
        if (!b.text || b.type === 'code') continue;
        const occ = titleMentions(b.text, title, ix.canonLex);
        count += occ.length;
        if (occ.length && !first) {
          first = snippetAround(b.text, occ[0], SNIPPET);
          at = { blockId: b.id, ...occ[0] };
        }
      }
    } else if (maybe) {
      const d = await itemText(it.id).catch(() => null);
      const text = d ? [d.title, ...(d.headings ?? []), d.text].join('\n') : '';
      const occ = titleMentions(text, title, ix.canonLex);
      count = occ.length;
      if (occ.length) first = snippetAround(text, occ[0], SNIPPET);
    }
    if (!linked && !count) continue;
    out.push({ id: it.id, kind: it.kind, title: it.title, linked, count, ...(first ? { snippet: first } : {}), ...(at ? { at } : {}) });
  }
  // сначала явные ссылки, потом — по числу упоминаний
  return out.sort((a, b) => Number(b.linked) - Number(a.linked) || b.count - a.count || a.title.localeCompare(b.title, 'ru'));
}

/** «Сделать ссылкой»: упоминание в заметке sourceId → [[Название|как написано]] */
export async function linkMention(sourceId: ID, at: NonNullable<Backlink['at']>, title: string): Promise<boolean> {
  const { kind, raw } = parseItemId(sourceId);
  if (kind !== 'note') return false;
  const open = useNotes.getState().openId === raw;
  const body = open ? useNotes.getState().openBody : await loadNoteBody(raw);
  const b = body?.blocks.find((x) => x.id === at.blockId);
  if (!body || !b?.text) return false;
  // текст могли изменить — ищем упоминание заново, ближайшее к старому месту
  const occ = titleMentions(b.text, title).sort((x, y) => Math.abs(x.start - at.start) - Math.abs(y.start - at.start))[0];
  if (!occ) return false;
  const text = linkOccurrence(b.text, occ, title);
  if (open) editOpenBody((bd) => void (bd.blocks = bd.blocks.map((x) => (x.id === b.id ? { ...x, text } : x))));
  else saveNoteBody(raw, { ...body, blocks: body.blocks.map((x) => (x.id === b.id ? { ...x, text } : x)) });
  await flushNotes();
  void ensureLinkIndex().catch(() => undefined);
  return true;
}

// ---------- Дубли ----------

const ignored = () => new Set((useNotes.getState().data?.notDup ?? []).map((r) => r.id));
const isNoteAlive = (id: string) => useNotes.getState().data?.notes.some((n) => n.id === id && !n.trashed) ?? false;

/** Почти одинаковые заметки для этой заметки (кроме отмеченных «не дубль») */
export function noteDuplicates(id: ID): { id: string; score: number }[] {
  const ix = linkIndex();
  if (!ix || parseItemId(id).kind !== 'note') return [];
  const skip = ignored();
  return duplicatesOf(ix, id, DUP_SCORE).filter((d) => parseItemId(d.id).kind === 'note' && isNoteAlive(d.id) && !skip.has(pairKey(id, d.id)));
}

/** Все пары дублей среди заметок */
export async function allDuplicates(): Promise<{ a: string; b: string; score: number }[]> {
  const ix = await ensureLinkIndex();
  const skip = ignored();
  const notes = (useNotes.getState().data?.notes ?? []).filter((n) => !n.trashed).map((n) => n.id);
  return findDuplicates(ix, notes, DUP_SCORE).filter((p) => !skip.has(pairKey(p.a, p.b)));
}

/** «Не дубль» — больше не предлагать объединить */
export function markNotDuplicate(a: ID, b: ID) {
  const id = pairKey(a, b);
  mutateNotes((d) => {
    const list = (d.notDup ??= []).filter((r) => r.id !== id);
    list.push({ id, updatedAt: Date.now() });
    d.notDup = list;
  });
}

/**
 * Объединить: содержимое drop — в конец keep, drop — в корзину (можно вернуть),
 * [[ссылки]] на drop в других заметках ведут теперь на keep.
 */
export async function mergeNotes(keep: ID, drop: ID): Promise<void> {
  await flushNotes();
  const s = useNotes.getState();
  const keepMeta = s.data?.notes.find((n) => n.id === keep);
  const dropMeta = s.data?.notes.find((n) => n.id === drop);
  if (!keepMeta || !dropMeta || keep === drop) return;
  const dropBody = await loadNoteBody(drop);
  if (s.openId === keep) editOpenBody((bd) => mergeBodies(bd, dropBody));
  else saveNoteBody(keep, mergeBodies(await loadNoteBody(keep), dropBody));
  // ссылки на старое название — на новое
  const keepTitle = (s.openId === keep ? useNotes.getState().openBody?.title : keepMeta.title) || keepMeta.title;
  const dropTitle = dropMeta.title;
  if (dropTitle.trim() && keepTitle.trim() && normTitle(dropTitle) !== normTitle(keepTitle)) {
    for (const n of useNotes.getState().data?.notes ?? []) {
      if (n.id === drop || n.trashed) continue;
      const f = rawFeatures(n.id);
      if (!f?.wiki?.some((w) => normTitle(w) === normTitle(dropTitle))) continue;
      const open = useNotes.getState().openId === n.id;
      const body = open ? useNotes.getState().openBody! : await loadNoteBody(n.id);
      if (!body.blocks.some((b) => b.text && hasWikiTo(b.text, dropTitle))) continue;
      const blocks = body.blocks.map((b) => (b.text && hasWikiTo(b.text, dropTitle) ? { ...b, text: retargetWiki(b.text, dropTitle, keepTitle) } : b));
      if (open) editOpenBody((bd) => void (bd.blocks = blocks));
      else saveNoteBody(n.id, { ...body, blocks });
    }
  }
  await flushNotes();
  trashNote(drop);
  void ensureLinkIndex().catch(() => undefined);
}
