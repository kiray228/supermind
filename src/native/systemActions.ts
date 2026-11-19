/** Действия из Siri и Spotlight iPhone (очередь виджетов → applyPending в widget.ts) */
import type { PendingAction } from './widget';
import { toast } from '../store/appStore';
import { addTask, ensureTasks } from '../tasks/store';
import { parseTask } from '../tasks/parse';
import { syncSoon } from '../tasks/sync';
import { createNote, ensureNotes, openNote } from '../notes/store';
import { markdownToBlocks } from '../notes/model';
import { uid } from '../utils/tree';
import { noteFromSiri, taskFromSiri } from './siriCore';
import { t } from '../i18n/index';

type SystemAction = Extract<PendingAction, { type: 'add_task' | 'add_note' | 'open_note' }>;

export async function applySystemAction(a: SystemAction) {
  switch (a.type) {
    case 'add_task': {
      await ensureTasks();
      const p = taskFromSiri(a.title ?? '', (s) => parseTask(s));
      const task = p ? addTask(p) : null;
      if (!task) return;
      syncSoon(800);
      toast(t('Задача из Siri: {title}', { title: task.title }));
      break;
    }
    case 'add_note': {
      await ensureNotes();
      const n = noteFromSiri(a.text ?? '');
      if (!n) return;
      const blocks = n.body ? (/\n/.test(n.body) ? markdownToBlocks(n.body) : [{ id: uid(), type: 'p' as const, text: n.body }]) : [];
      if (createNote({ title: n.title, blocks })) toast(t('Заметка из Siri сохранена'));
      break;
    }
    case 'open_note': {
      const d = await ensureNotes();
      if (!d.notes.some((x) => x.id === a.id && !x.trashed)) return;
      await openNote(a.id);
      const { nav } = await import('../search/sources');
      await nav('notes');
      break;
    }
  }
}
