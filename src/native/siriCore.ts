/** Siri и «Быстрые команды» iPhone: текст из Siri → задача / заметка (без зависимостей — проверяется тестами) */
import type { ParsedTask } from '../tasks/parse';
import type { TaskItem } from '../tasks/model';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Задача из фразы: «позвонить маме завтра в 18:30» — дата и время разбираются как в быстром вводе */
export function taskFromSiri(text: string, parse: (s: string) => ParsedTask): Partial<TaskItem> | null {
  const raw = oneLine(text).slice(0, 500);
  if (!raw) return null;
  let p: ParsedTask | null = null;
  try {
    p = parse(raw);
  } catch {
    p = null;
  }
  const title = oneLine(p?.title ?? '') || raw;
  if (!p) return { title };
  return {
    title,
    ...(p.date ? { date: p.date } : {}),
    ...(p.date && p.time ? { time: p.time } : {}),
    ...(p.date && p.time && p.duration ? { duration: p.duration } : {}),
    ...(p.date && p.repeat ? { repeat: p.repeat } : {}),
    ...(p.priority ? { priority: p.priority } : {}),
    ...(p.tags.length ? { tags: p.tags } : {}),
  };
}

/** Заметка из продиктованного: первая строка (до 80 знаков) — название, весь текст — тело, если он длиннее */
export function noteFromSiri(text: string): { title: string; body?: string } | null {
  const full = text.replace(/\r\n?/g, '\n').trim();
  if (!full) return null;
  const first = oneLine(full.split('\n')[0]);
  const title = first.length > 80 ? first.slice(0, 79).trimEnd() + '…' : first;
  return full === title ? { title } : { title, body: full };
}
