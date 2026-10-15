/**
 * Экспорт всех заметок в архив для Obsidian (запуск из приложения). Сборка файлов — obsidian.ts.
 */
import { downloadBlob } from '../io/download';
import { newZip } from '../io/common';
import { keywordsOf, relatedTo } from './links';
import { buildVault, type VaultNote } from './obsidian';
import { ensureLinkIndex } from './related';
import { ensureNotes, flushNotes, loadNoteBody } from './store';

/** Сохранить архив хранилища Obsidian. Возвращает число заметок */
export async function exportObsidianVault(onProgress?: (done: number, total: number) => void): Promise<number> {
  await flushNotes();
  const d = await ensureNotes();
  const folders = new Map(d.folders.map((f) => [f.id, f.name]));
  const alive = d.notes.filter((n) => !n.trashed);
  const ix = await ensureLinkIndex().catch(() => null);
  const ids = new Set(alive.map((n) => n.id));
  const notes: VaultNote[] = [];
  const related = new Map<string, string[]>();
  const keywords = new Map<string, string[]>();
  let done = 0;
  for (const n of alive) {
    const body = await loadNoteBody(n.id).catch(() => null);
    if (body) notes.push({ id: n.id, title: n.title, folder: n.folderId ? folders.get(n.folderId) : undefined, body, createdAt: n.createdAt, updatedAt: n.updatedAt });
    if (ix) {
      // в хранилище — только заметки: карты, задачи и цели остаются в приложении
      related.set(
        n.id,
        relatedTo(ix, n.id, { limit: 8 })
          .map((r) => r.id)
          .filter((id) => ids.has(id)),
      );
      keywords.set(n.id, keywordsOf(ix, n.id, 5));
    }
    onProgress?.(++done, alive.length);
  }
  const zip = await newZip();
  for (const f of buildVault(notes, { related, keywords })) {
    if (f.base64 !== undefined) zip.file('SuperMind/' + f.path, f.base64, { base64: true });
    else zip.file('SuperMind/' + f.path, f.text ?? '');
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  await downloadBlob(blob, 'SuperMind — Obsidian.zip');
  return notes.length;
}
