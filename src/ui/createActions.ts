/** «Создать»: меню при удержании микрофона — задача, заметка, карта, привычка, цель, трата */
import { useApp } from '../store/appStore';

export type CreateKind = 'task' | 'note' | 'map' | 'habit' | 'goal' | 'expense';

/** Раздел «Привычки» откроет окно новой привычки, когда смонтируется */
export const NEW_HABIT_EVENT = 'sm-new-habit';

export async function createThing(kind: CreateKind) {
  const { nav, whenShown } = await import('../search/sources');
  switch (kind) {
    case 'task': {
      const { openQuickAdd } = await import('../tasks/store');
      openQuickAdd();
      return;
    }
    case 'note': {
      const { createNote, ensureNotes, openNote } = await import('../notes/store');
      await ensureNotes();
      const m = createNote();
      if (!m) return;
      await openNote(m.id);
      await nav('notes');
      return;
    }
    case 'map': {
      const [{ createAndOpen }, { docFromTemplate, TEMPLATES }] = await Promise.all([import('../actions'), import('../templates')]);
      await createAndOpen(docFromTemplate(TEMPLATES[0]));
      return;
    }
    case 'habit':
      await nav('habits');
      whenShown('.hp-page', () => window.dispatchEvent(new Event(NEW_HABIT_EVENT)));
      return;
    case 'goal': {
      const [{ ensureGoals }, { useSearchUi }] = await Promise.all([import('../goals/store'), import('../search/state')]);
      await ensureGoals();
      await nav('goals');
      whenShown('.gl-page', () => useSearchUi.setState({ newGoal: true }));
      return;
    }
    case 'expense': {
      const [{ ensureFinance }, { openTxSheet }] = await Promise.all([import('../finance/store'), import('../finance/ui/state')]);
      await ensureFinance();
      // окно траты есть на «Сегодня» и в «Финансах»; из других разделов — в Финансы
      const v = useApp.getState().view;
      if (v !== 'today' && v !== 'finance') await nav('finance');
      openTxSheet({ preset: { type: 'expense' } });
      return;
    }
  }
}
