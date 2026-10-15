/**
 * Утренняя сводка из мозга: сколько карточек повторить и какую давнюю заметку стоит перечитать —
 * она связана с задачами дня (или с тем, что вы правили в последние дни). Добавляется в «План на день».
 */
import { relatedTo, type LinkIndex } from './links';
import { itemId, parseItemId } from './brainDocs';
import { dueCards } from './cardsCore';
import type { NoteMeta, StudyCard } from './model';

const DAY = 86400000;
/** «давняя» — не открывали столько дней */
export const REREAD_DAYS = 21;
/** «недавняя» заметка — для подбора, если задач на день нет */
const RECENT_DAYS = 3;

export interface BrainBrief {
  /** карточек на этот день */
  cards: number;
  /** что перечитать */
  reread?: { id: string; title: string };
}

export interface BriefInput {
  day: string;
  now: number;
  notes: NoteMeta[];
  cards: StudyCard[];
  /** id задач этого дня (как в списке задач) */
  taskIds: string[];
  ix: LinkIndex | null;
}

/** Сводка на день (чистая функция — тесты гоняют её в Node) */
export function brainBriefOf(inp: BriefInput): BrainBrief {
  const alive = new Map(inp.notes.filter((n) => !n.trashed).map((n) => [n.id, n]));
  const cards = dueCards(
    inp.cards.filter((c) => alive.has(c.noteId)),
    inp.day,
  ).length;
  if (!inp.ix) return { cards };
  const ix = inp.ix;
  const old = inp.now - REREAD_DAYS * DAY;
  // давняя обычная заметка (не заметка дня и не конспект)
  const fits = (id: string) => {
    if (parseItemId(id).kind !== 'note') return false;
    const n = alive.get(id);
    return !!n && !n.day && !n.digest && n.updatedAt < old && !!n.title.trim();
  };
  const best = (sources: string[]): string | undefined => {
    const score = new Map<string, number>();
    for (const s of sources) for (const r of relatedTo(ix, s, { limit: 8 })) if (fits(r.id)) score.set(r.id, Math.max(score.get(r.id) ?? 0, r.score));
    return [...score.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  };
  let id = best(inp.taskIds.map((t) => itemId('task', t)));
  if (!id) {
    const recent = [...alive.values()].filter((n) => n.updatedAt > inp.now - RECENT_DAYS * DAY && !n.day).map((n) => n.id);
    id = best(recent);
  }
  return id ? { cards, reread: { id, title: alive.get(id)!.title.trim() } } : { cards };
}

/** Сводка из текущих данных приложения (индекс связей — если уже собран или соберётся быстро) */
export async function brainBriefFor(day: string, taskIds: string[]): Promise<BrainBrief | null> {
  try {
    const { ensureNotes, useNotes } = await import('./store');
    await ensureNotes();
    const d = useNotes.getState().data;
    if (!d) return null;
    const { ensureLinkIndex, linkIndex } = await import('./related');
    // индекс: готовый или не дольше 4 секунд — уведомления не должны ждать
    const ix = linkIndex() ?? (await Promise.race([ensureLinkIndex().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]));
    return brainBriefOf({ day, now: Date.now(), notes: d.notes, cards: d.cards ?? [], taskIds, ix });
  } catch {
    return null;
  }
}

/** Хвост текста утреннего уведомления: «карточек: 5», «Перечитать: «…»» */
export function briefParts(b: BrainBrief | null): { part?: string; tail?: string } {
  if (!b) return {};
  return { ...(b.cards ? { part: `карточек: ${b.cards}` } : {}), ...(b.reread ? { tail: `Перечитать: «${b.reread.title}»` } : {}) };
}
