/** Подключение разделов приложения к синхронизации: что сохранить перед ней и что перечитать после */
import type { LockedDoc, MindDoc } from '../types';
import { useApp, toast } from './appStore';
import { initCloud, onBeforeSync, onRemoteChange, syncSoon } from './cloud';
import { get } from './kv';
import { mark, whenIdle } from '../perf';

let done = false;

/** Открытую карту изменили на другом устройстве: показать новую версию (когда пользователь не печатает) */
async function refreshOpenDoc(keys: string[], attempt = 0): Promise<void> {
  const { useDoc, hasPendingSave, flushSave } = await import('./docStore');
  const st = useDoc.getState();
  if (!st.doc || !keys.includes(`doc:${st.doc.id}`)) return;
  if (st.editingId) {
    // сейчас редактируется тема — повторим чуть позже, ничего не теряя
    if (attempt < 60) setTimeout(() => void refreshOpenDoc(keys, attempt + 1), 2000);
    return;
  }
  // свои несохранённые правки — сначала записать (другая версия при этом сохранится отдельной картой)
  if (hasPendingSave()) await flushSave();
  const raw = await get<MindDoc | LockedDoc>(`doc:${st.doc.id}`);
  const cur = useDoc.getState();
  if (!raw || !cur.doc || cur.doc.id !== st.doc.id) return;
  let doc: MindDoc | null = null;
  if ('locked' in raw) {
    if (cur.password) doc = await (await import('../utils/crypto')).decryptDoc(raw, cur.password).catch(() => null);
  } else doc = raw;
  if (doc && doc.updatedAt > cur.doc.updatedAt) {
    cur.open(doc, cur.password);
    toast('Карта обновлена с другого устройства');
  }
}

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
      await refreshOpenDoc(keys);
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

  // копия до первой синхронизации — если что-то пойдёт не так, будет из чего вернуть.
  // Делается в фоне после первой отрисовки: экран не ждёт её, а синхронизация (initCloud) — ждёт.
  const snapshot = new Promise<void>((resolve) =>
    whenIdle(() => {
      void import('./safety')
        .then((m) => m.startupSafety())
        .catch(() => {})
        .then(() => {
          mark('snapshot-done');
          resolve();
        });
    }, 1000),
  );
  await initCloud(snapshot);
  // для проверок в режиме разработки: те же экземпляры модулей, что у приложения
  if (import.meta.env.DEV)
    (window as unknown as { __sm: unknown }).__sm = {
      cloud: await import('./cloud'),
      kv: await import('./kv'),
      db: await import('./db'),
      safety: await import('./safety'),
      tasks: await import('../tasks/store'),
      finance: await import('../finance/store'),
      notes: await import('../notes/store'),
      docStore: await import('./docStore'),
    };
}
