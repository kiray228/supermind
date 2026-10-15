/**
 * Экспорт «второго мозга» в Obsidian: папка заметок (.md) с [[ссылками]] между ними —
 * архив распаковывается и открывается в Obsidian как хранилище (vault).
 * Модуль без браузерных зависимостей — тесты гоняют его в Node; запуск из приложения — obsidianExport.ts.
 */
import { safeFilename } from '../io/download';
import { normTitle, parseWiki } from './links';
import { type Block, type NoteBody, noteToMarkdown } from './model';

export interface VaultNote {
  id: string;
  title: string;
  /** название папки (подпапка в хранилище) */
  folder?: string;
  body: NoteBody;
  createdAt: number;
  updatedAt: number;
}

export interface VaultFile {
  path: string;
  /** текст (.md) */
  text?: string;
  /** содержимое картинки (base64) */
  base64?: string;
}

export interface VaultOpts {
  /** связанные заметки по id (как в приложении) */
  related?: Map<string, string[]>;
  /** темы заметки — станут тегами */
  keywords?: Map<string, string[]>;
}

/** Тег Obsidian: без пробелов и знаков, хотя бы одна буква */
export function obsidianTag(s: string): string | null {
  const t = s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_\-/]/gu, '');
  return /\p{L}/u.test(t) ? t : null;
}

const yamlStr = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const iso = (ms: number) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '');

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

/** Картинка data:URL → { ext, base64 } (другие адреса не вкладываются) */
export function dataUrlImage(src: string): { ext: string; base64: string } | null {
  const m = /^data:([\w/+.-]+);base64,([\s\S]+)$/.exec(src);
  if (!m) return null;
  const ext = IMAGE_EXT[m[1].toLowerCase()];
  return ext ? { ext, base64: m[2] } : null;
}

/** Собрать файлы хранилища: заметки, вложения и «Связанные» в конце каждой заметки */
export function buildVault(notes: VaultNote[], opts: VaultOpts = {}): VaultFile[] {
  // имена файлов — уникальные во всём хранилище: Obsidian находит [[ссылку]] по имени
  const nameOf = new Map<string, string>();
  const used = new Set<string>();
  for (const n of notes) {
    const base = safeFilename(n.title.trim() || 'Без названия').replace(/[#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Без названия';
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})`;
    used.add(name.toLowerCase());
    nameOf.set(n.id, name);
  }
  // название → имя файла (для [[ссылок]] в тексте)
  const byTitle = new Map<string, string>();
  for (const n of notes) {
    const k = normTitle(n.title);
    if (k && !byTitle.has(k)) byTitle.set(k, nameOf.get(n.id)!);
  }
  const link = (name: string, label: string) => (name === label ? `[[${name}]]` : `[[${name}|${label}]]`);

  const files: VaultFile[] = [];
  for (const n of notes) {
    const name = nameOf.get(n.id)!;
    const dir = n.folder ? safeFilename(n.folder) + '/' : '';
    // картинки — отдельными файлами в attachments, в тексте — ![[…]]
    let img = 0;
    const blocks: Block[] = n.body.blocks.map((b) => {
      if (b.type !== 'image' || !b.src) return b;
      const pic = dataUrlImage(b.src);
      if (!pic) return { ...b, type: 'p', text: b.caption ? `*[Изображение: ${b.caption}]*` : '*[Изображение]*' } as Block;
      const file = `attachments/${name} ${++img}.${pic.ext}`;
      files.push({ path: file, base64: pic.base64 });
      return { id: b.id, type: 'p', text: `![[${file}]]` + (b.caption ? `\n*${b.caption}*` : '') } as Block;
    });
    let md = noteToMarkdown({ ...n.body, blocks }, { noTitle: true });
    // [[Название]] → [[имя файла|Название]], если имя файла отличается
    md = md.replace(/\[\[([^[\]\n]+?)\]\]/g, (all, inner: string) => {
      if (inner.startsWith('attachments/')) return all;
      const { title, label } = parseWiki(inner);
      const target = byTitle.get(normTitle(title));
      return target ? link(target, label) : all;
    });

    const tags = [...new Set((opts.keywords?.get(n.id) ?? []).map(obsidianTag).filter((t): t is string => !!t))];
    const front = ['---', `title: ${yamlStr(n.title || 'Без названия')}`];
    if (iso(n.createdAt)) front.push(`created: ${iso(n.createdAt)}`);
    if (iso(n.updatedAt)) front.push(`updated: ${iso(n.updatedAt)}`);
    if (tags.length) front.push('tags:', ...tags.map((t) => `  - ${t}`));
    front.push('---', '');

    const rel = (opts.related?.get(n.id) ?? []).filter((id) => nameOf.has(id) && id !== n.id);
    const relMd = rel.length ? '\n## Связанные заметки\n\n' + rel.map((id) => `- ${link(nameOf.get(id)!, notes.find((x) => x.id === id)!.title || nameOf.get(id)!)}`).join('\n') + '\n' : '';
    files.push({ path: `${dir}${name}.md`, text: front.join('\n') + md.trimEnd() + '\n' + relMd });
  }
  return files;
}
