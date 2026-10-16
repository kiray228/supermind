/**
 * Переходы по [[ссылкам]] из текста заметки: найти единицу по названию, открыть (раздел — прокрутить к заголовку),
 * а если заметки ещё нет — создать.
 */
import { openItem } from '../brain';
import { normTitle } from '../links';
import { itemByTitle } from '../related';
import { createNote, openLinkedNote, useNotes } from '../store';

/** Единица по названию: по индексу связей, а пока он не собран — среди заметок */
export function findByTitle(title: string): string | undefined {
  const it = itemByTitle(title);
  if (it) return it.id;
  const k = normTitle(title);
  return useNotes.getState().data?.notes.find((n) => !n.trashed && normTitle(n.title) === k)?.id;
}

/** Раздел, к которому прокрутить заметку после открытия */
let pendingSection: { noteId: string; section: string } | null = null;

/** Забрать раздел для только что открытой заметки (один раз) */
export function takeSection(noteId: string): string | null {
  const p = pendingSection;
  if (!p || p.noteId !== noteId) return null;
  pendingSection = null;
  return p.section;
}

/** [[Ссылка]]: открыть (с разделом — прокрутить к нему), а если такой заметки нет — создать её (в той же папке) и открыть */
export function openWiki(title: string, section?: string) {
  const id = findByTitle(title);
  if (id) {
    pendingSection = section ? { noteId: id, section } : null;
    return void openItem(id, { fromNote: true });
  }
  const s = useNotes.getState();
  const folderId = s.data?.notes.find((n) => n.id === s.openId)?.folderId;
  const m = createNote({ title: title.trim(), folderId });
  if (m) openLinkedNote(m.id);
}
