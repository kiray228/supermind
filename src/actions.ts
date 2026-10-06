import { loadDoc, saveDoc } from './store/db';
import { useApp, toast, type View } from './store/appStore';
import { useDoc, flushSave } from './store/docStore';
import { decryptDoc } from './utils/crypto';
import type { MindDoc } from './types';
import { askPassword } from './ui/dialogs';

/** Открыть документ в редакторе (и, при необходимости, сфокусироваться на теме) */
export async function openDoc(id: string, focusTopicId?: string): Promise<void> {
  await flushSave();
  const raw = await loadDoc(id);
  if (!raw) {
    toast('Документ не найден');
    return;
  }
  let doc: MindDoc;
  let password: string | null = null;
  if ('locked' in raw) {
    for (;;) {
      const p = await askPassword('Документ защищён паролем');
      if (p == null) return;
      try {
        doc = await decryptDoc(raw, p);
        password = p;
        break;
      } catch {
        toast('Неверный пароль');
      }
    }
  } else doc = raw;
  useDoc.getState().open(doc!, password);
  useApp.getState().go('editor');
  if (focusTopicId) {
    const sheet = doc!.sheets.find((s) => JSON.stringify(s.root).includes(`"${focusTopicId}"`) || s.floating.some((f) => JSON.stringify(f).includes(`"${focusTopicId}"`)));
    if (sheet && sheet.id !== doc!.activeSheet) useDoc.getState().setActiveSheet(sheet.id);
    setTimeout(() => useDoc.getState().focusTopic(focusTopicId), 50);
  }
}

/** Создать и открыть новый документ */
export async function createAndOpen(doc: MindDoc) {
  await saveDoc(doc);
  useDoc.getState().open(doc);
  // новая карта: центральная тема выбрана — сразу видно «+» и что нажать дальше
  const root = doc.sheets.find((x) => x.id === doc.activeSheet)?.root;
  if (root) useDoc.getState().select(root.id);
  useApp.getState().go('editor');
}

/** Выйти из редактора в раздел */
export async function leaveEditor(view: Exclude<View, 'editor'> = 'home') {
  await flushSave();
  useDoc.getState().close();
  useApp.getState().go(view);
}
