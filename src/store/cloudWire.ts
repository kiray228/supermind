/** Подключение разделов приложения к синхронизации: что сохранить перед ней и что перечитать после */
import type { LockedDoc, MindDoc } from '../types';
import { useApp, toast } from './appStore';
import { initCloud, onBeforeSync, onRemoteChange, syncSoon } from './cloud';
import { get } from './kv';

let done = false;

export async function setupCloud() {
  if (done) return;
  done = true;

  onBeforeSync(async () => (await import('./docStore')).flushSave());
  onBeforeSync(async () => (await import('../tasks/store')).flushTasks());
  onBeforeSync(async () => (await import('../finance/store')).flushFinance());
  onBeforeSync(async () => (await import('../goals/store')).flushGoals());
  onBeforeSync(async () => (await import('../notes/store')).flushNotes());

  onRemoteChange(
    (k) => k === 'tasks',
    async () => {
      const m = await import('../tasks/store');
      // есть несохранённые правки — сначала они уйдут на сервер, потом перечитаем
      if (!(await m.reloadTasksFromSync())) syncSoon(3000);
    },
  );

  onRemoteChange(
    (k) => k === 'docs:index' || k.startsWith('doc:'),
    async (keys) => {
      useApp.setState({ docsVersion: Date.now() });
      const { useDoc, hasPendingSave } = await import('./docStore');
      const st = useDoc.getState();
      if (!st.doc || !keys.includes(`doc:${st.doc.id}`) || hasPendingSave() || st.editingId) return;
      const raw = await get<MindDoc | LockedDoc>(`doc:${st.doc.id}`);
      if (!raw) return;
      let doc: MindDoc | null = null;
      if ('locked' in raw) {
        if (st.password) doc = await (await import('../utils/crypto')).decryptDoc(raw, st.password).catch(() => null);
      } else doc = raw;
      if (doc && doc.updatedAt > st.doc.updatedAt) {
        st.open(doc, st.password);
        toast('Карта обновлена с другого устройства');
      }
    },
  );

  onRemoteChange(
    (k) => k === 'finance',
    async () => (await import('../finance/store')).reloadFinance(),
  );
  onRemoteChange(
    (k) => k === 'goals',
    async () => (await import('../goals/store')).reloadGoals(),
  );
  onRemoteChange(
    (k) => k === 'notes' || k.startsWith('note:'),
    async () => (await import('../notes/store')).reloadNotes(),
  );
  onRemoteChange(
    (k) => k === 'planner',
    () => void window.dispatchEvent(new Event('sm-planner-changed')),
  );
  onRemoteChange(
    (k) => k === 'board',
    () => void window.dispatchEvent(new Event('sm-board-changed')),
  );

  // копия до первой синхронизации — если что-то пойдёт не так, будет из чего вернуть
  await (await import('./safety')).startupSafety();
  await initCloud();
}
