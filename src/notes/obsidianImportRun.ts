/**
 * Импорт хранилища Obsidian в приложение: архив .zip или отдельные .md (и картинки).
 * Разбор — obsidianImport.ts; здесь — чтение файлов, папки, картинки и создание заметок.
 */
import type { ID } from '../types';
import { loadZip } from '../io/common';
import { imageFileToDataUrl } from './media';
import { normTitle } from './links';
import { bodyPlainText, type Block, newBlock } from './model';
import { IMG_REF, isImagePath, parseVault, type VaultInput } from './obsidianImport';
import { ensureLinkIndex } from './related';
import { addFolder, createNote, ensureNotes, flushNotes, loadNoteBody, mutateNotes, useNotes } from './store';

export interface ImportResult {
  created: number;
  /** такие же заметки уже есть */
  skipped: number;
  folders: number;
  images: number;
}

export class ImportError extends Error {
  override name = 'ImportError';
}

/** больше — картинка не переносится (вместо неё — подпись) */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_NOTES = 5000;

type Source = { input?: VaultInput; image?: { path: string; load: () => Promise<Blob> } };

async function readFiles(files: File[]): Promise<{ md: VaultInput[]; images: Map<string, () => Promise<Blob>> }> {
  const md: VaultInput[] = [];
  const images = new Map<string, () => Promise<Blob>>();
  const add = (s: Source) => {
    if (s.input) md.push(s.input);
    if (s.image) images.set(s.image.path, s.image.load);
  };
  for (const f of files) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (/\.zip$/i.test(f.name)) {
      const JSZip = await loadZip();
      let zip;
      try {
        zip = await JSZip.loadAsync(f);
      } catch {
        throw new ImportError(`Не удалось открыть архив «${f.name}»`);
      }
      for (const e of Object.values(zip.files)) {
        if (e.dir) continue;
        if (/\.md$/i.test(e.name)) add({ input: { path: e.name, text: await e.async('string'), date: e.date?.getTime() } });
        else if (isImagePath(e.name)) add({ image: { path: e.name, load: () => e.async('blob') } });
      }
    } else if (/\.md$/i.test(f.name) || f.type === 'text/markdown') add({ input: { path, text: await f.text(), date: f.lastModified || undefined } });
    else if (isImagePath(f.name)) add({ image: { path, load: async () => f } });
  }
  return { md, images };
}

const mimeOf = (p: string) => {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  return ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
};

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(b);
  });
}

/** Картинка → data URL: сжатая, как при вставке фото; svg и gif — как есть (сжатие их испортит) */
async function imageData(path: string, load: () => Promise<Blob>): Promise<string | null> {
  try {
    const raw = await load();
    if (raw.size > MAX_IMAGE_BYTES) return null;
    const blob = raw.type ? raw : new Blob([raw], { type: mimeOf(path) });
    if (/\.(svg|gif)$/i.test(path)) return blob.size <= 2 * 1024 * 1024 ? await blobToDataUrl(blob) : null;
    return await imageFileToDataUrl(blob);
  } catch {
    return null;
  }
}

const plain = (blocks: Block[]) => bodyPlainText({ title: '', blocks, updatedAt: 0 }).replace(/\s+/g, ' ').trim();

/** Импортировать файлы хранилища Obsidian. Повторный импорт не создаёт копий: такие же заметки пропускаются */
export async function importObsidian(files: File[], onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  await ensureNotes();
  await flushNotes();
  const { md, images } = await readFiles(files);
  if (!md.length) throw new ImportError('Заметок не нашлось — выберите архив хранилища (.zip) или файлы .md');
  const notes = parseVault(md, [...images.keys()]).slice(0, MAX_NOTES);

  // такие же заметки (название и текст) уже есть — не повторять
  const d = useNotes.getState().data!;
  const sameTitle = new Map<string, ID[]>();
  for (const n of d.notes) if (!n.trashed) sameTitle.set(normTitle(n.title), [...(sameTitle.get(normTitle(n.title)) ?? []), n.id]);
  const existsLike = async (title: string, blocks: Block[]) => {
    const ids = sameTitle.get(normTitle(title));
    if (!ids) return false;
    const text = plain(blocks);
    for (const id of ids) {
      const body = await loadNoteBody(id).catch(() => null);
      if (body && plain(body.blocks) === text) return true;
    }
    return false;
  };

  const folderIds = new Map(d.folders.map((f) => [f.name.trim().toLowerCase(), f.id]));
  const res: ImportResult = { created: 0, skipped: 0, folders: 0, images: 0 };
  const dates: { id: ID; createdAt?: number; updatedAt?: number }[] = [];
  const cache = new Map<string, string | null>();
  let done = 0;
  for (const n of notes) {
    onProgress?.(done++, notes.length);
    // теги шапки — строкой в конце заметки
    const tagLine = n.tags.length ? [newBlock('p', { text: n.tags.map((t) => '#' + t.replace(/\s+/g, '_')).join(' ') })] : [];
    if (await existsLike(n.title, [...n.blocks, ...tagLine])) {
      res.skipped++;
      continue;
    }
    // картинки: из файлов хранилища в саму заметку
    const blocks: Block[] = [];
    for (const b of n.blocks) {
      if (b.type !== 'image' || !b.src?.startsWith(IMG_REF)) {
        blocks.push(b);
        continue;
      }
      const path = b.src.slice(IMG_REF.length);
      if (!cache.has(path)) cache.set(path, images.has(path) ? await imageData(path, images.get(path)!) : null);
      const src = cache.get(path);
      if (src) {
        blocks.push({ ...b, src });
        res.images++;
      } else blocks.push(newBlock('p', { text: `*[Изображение: ${b.caption || path.slice(path.lastIndexOf('/') + 1)}]*` }));
    }
    blocks.push(...tagLine);
    if (!blocks.length) blocks.push(newBlock('p'));

    let folderId: ID | undefined;
    if (n.folder) {
      const k = n.folder.trim().toLowerCase();
      folderId = folderIds.get(k);
      if (!folderId) {
        const f = addFolder(n.folder);
        if (f) {
          folderId = f.id;
          folderIds.set(k, f.id);
          res.folders++;
        }
      }
    }
    const meta = createNote({ title: n.title, blocks, folderId });
    if (!meta) continue;
    res.created++;
    if (n.createdAt || n.updatedAt) dates.push({ id: meta.id, createdAt: n.createdAt, updatedAt: n.updatedAt });
    // большие хранилища — сохранять по частям, чтобы не держать всё в памяти
    if (res.created % 50 === 0) await flushNotes();
  }
  await flushNotes();
  // исходные даты: «создано» и «изменено» — как в Obsidian
  if (dates.length)
    mutateNotes((x) => {
      for (const t of dates) {
        const m = x.notes.find((n) => n.id === t.id);
        if (!m) continue;
        const created = t.createdAt ?? t.updatedAt!;
        m.createdAt = Math.min(created, t.updatedAt ?? created);
        if (t.updatedAt) m.updatedAt = Math.max(t.updatedAt, m.createdAt);
      }
    });
  onProgress?.(notes.length, notes.length);
  void ensureLinkIndex().catch(() => undefined);
  return res;
}
