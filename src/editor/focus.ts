/**
 * Фокус на ветке (как в XMind): на холсте — только выбранная тема с потомками, она в центре.
 * Это вид, а не правка: лист не меняется, правки по id попадают в настоящую карту.
 */
import type { ID, Sheet, Topic } from '../types';
import { findInSheet, pathTo, walk } from '../utils/tree';

/** Лист для показа ветки id. null — такой темы нет (или это и так центр) */
export function focusSheet(sheet: Sheet, id: ID | null): Sheet | null {
  if (!id || id === sheet.root.id) return null;
  const topic = findInSheet(sheet, id)?.topic;
  if (!topic) return null;
  const ids = new Set<ID>();
  walk(topic, (t) => void ids.add(t.id));
  // ветка — центральная тема вида: всегда раскрыта, стороны главных тем — заново
  const root: Topic = { ...topic, collapsed: false };
  delete root.side;
  return {
    ...sheet,
    id: `${sheet.id}~${id}`,
    root,
    floating: [],
    relationships: sheet.relationships.filter((r) => ids.has(r.from) && ids.has(r.to)),
    boundaries: sheet.boundaries.filter((b) => ids.has(b.topicId) && b.topicId !== id),
    summaries: sheet.summaries.filter((s) => ids.has(s.topicId) && s.topicId !== id),
  };
}

/** Путь для строки «Вся карта › … › ветка»: темы от центральной до ветки (без самой центральной) */
export function focusPath(sheet: Sheet, id: ID): Topic[] {
  return pathTo(sheet, id).filter((t) => t.id !== sheet.root.id);
}
