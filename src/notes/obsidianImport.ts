/**
 * Импорт из Obsidian: файлы хранилища (.md и картинки) → заметки с папками, датами и [[ссылками]].
 * Модуль без браузерных зависимостей — тесты гоняют его в Node; чтение архива и создание заметок — obsidianImportRun.ts.
 */
import { normTitle, parseWiki } from './links';
import { type Block, markdownToBlocks, newBlock } from './model';

export interface ImportedNote {
  /** путь файла в хранилище (без корневой папки архива) */
  path: string;
  title: string;
  /** папка: подпапки через « / » */
  folder?: string;
  blocks: Block[];
  createdAt?: number;
  updatedAt?: number;
  /** теги из шапки (YAML) */
  tags: string[];
}

export interface VaultInput {
  path: string;
  text: string;
  /** время изменения файла (из архива), мс */
  date?: number;
}

/** Картинка в заметке до загрузки: src = IMG_REF + путь файла в хранилище */
export const IMG_REF = 'vault:';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
export const isImagePath = (p: string) => IMAGE_RE.test(p);

/** Служебные файлы и папки, которые не переносятся */
export function isSkippedPath(p: string): boolean {
  return p.split('/').some((s) => s === '.obsidian' || s === '.trash' || s === '__MACOSX' || s === '.git' || (s.startsWith('.') && s !== '.' && s !== '..'));
}

const slash = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\/+/, '');
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const stripMd = (p: string) => p.replace(/\.md$/i, '');

/** Общая корневая папка всех путей («Мой vault/…» в архиве) — её не нужно делать папкой */
export function commonRoot(paths: string[]): string {
  if (!paths.length) return '';
  const first = paths[0].split('/');
  if (first.length < 2) return '';
  const root = first[0];
  return paths.every((p) => p.startsWith(root + '/')) ? root + '/' : '';
}

// ---------- Шапка YAML ----------

interface Front {
  title?: string;
  created?: number;
  updated?: number;
  tags: string[];
  aliases: string[];
}

const unquote = (s: string) => {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return t;
};

/** «2024-05-01», «2024-05-01T10:00:00Z», «2024-05-01 10:00» → мс; непонятное — undefined */
export function parseDate(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const t = unquote(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (!m) return undefined;
  const ms = /Z|[+-]\d{2}:?\d{2}$/.test(t) ? Date.parse(t) : new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/** Список в шапке: «[a, b]», «a, b» или строки «- a» */
function yamlList(inline: string, items: string[]): string[] {
  const v = inline.trim();
  const raw = v ? v.replace(/^\[|\]$/g, '').split(',') : items;
  return raw.map((x) => unquote(x).replace(/^#/, '').trim()).filter(Boolean);
}

/** Отделить шапку YAML (--- … ---) от текста */
export function splitFrontmatter(text: string): { front: Front; body: string } {
  const front: Front = { tags: [], aliases: [] };
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(t);
  if (!m) return { front, body: t };
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const items: string[] = [];
    while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) items.push(lines[++i].replace(/^\s+-\s+/, ''));
    if (key === 'title') front.title = unquote(kv[2]) || undefined;
    else if (key === 'created' || key === 'date' || key === 'created_at' || key === 'creation_date') front.created ??= parseDate(kv[2]);
    else if (key === 'updated' || key === 'modified' || key === 'updated_at' || key === 'last_modified') front.updated ??= parseDate(kv[2]);
    else if (key === 'tags' || key === 'tag') front.tags.push(...yamlList(kv[2], items));
    else if (key === 'aliases' || key === 'alias') front.aliases.push(...yamlList(kv[2], items));
  }
  return { front, body: t.slice(m[0].length) };
}

// ---------- Текст ----------

/** Раздел «## Связанные заметки» из экспорта SuperMind: в приложении связи и так считаются сами */
export function dropOwnRelated(md: string): string {
  return md.replace(/\n*^## Связанные заметки\n+(?:^- \[\[[^\n]*\]\][ \t]*(?:\n|$))+\s*(?![\s\S])/m, '\n');
}

/** Ссылки и картинки по кускам вне блоков кода */
function outsideCode(md: string, fn: (s: string) => string): string {
  return md
    .split(/(^```[\s\S]*?(?:^```[^\n]*$|(?![\s\S])))/m)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join('');
}

const PH = '';
const phRe = new RegExp(`^${PH}(\\d+)${PH}$`);

export interface ResolveCtx {
  /** путь заметки (для относительных путей картинок) */
  path: string;
  /** найти картинку по ссылке: путь в хранилище или undefined */
  image: (ref: string, from: string) => string | undefined;
  /** имя файла заметки → её название (если в шапке своё название) */
  titleOf: (target: string) => string | undefined;
}

/** [[цель#раздел|подпись]] → [[Название|подпись]] (раздел и блок отбрасываются, путь — тоже) */
export function convertWiki(inner: string, titleOf: (t: string) => string | undefined): string {
  const { title, label } = parseWiki(inner);
  const hash = title.search(/[#^]/);
  const file = baseName(stripMd((hash >= 0 ? title.slice(0, hash) : title).trim()));
  const section = hash >= 0 ? title.slice(hash + 1).replace(/^[#^]+/, '').trim() : '';
  // ссылка на раздел этой же заметки — просто текст
  if (!file) return label !== title ? label : section;
  const target = titleOf(file) ?? file;
  const shown = label !== title ? label : file !== target ? file : '';
  return shown && shown !== target ? `[[${target}|${shown}]]` : `[[${target}]]`;
}

/** Markdown Obsidian → блоки заметки. Картинки — блоки image с src = IMG_REF + путь (или текст, если файла нет) */
export function obsidianToBlocks(md: string, ctx: ResolveCtx): Block[] {
  const images: { path?: string; name: string; caption?: string }[] = [];
  const img = (ref: string, caption?: string) => {
    const path = ctx.image(ref, ctx.path);
    images.push({ path, name: baseName(ref), caption: caption?.trim() || undefined });
    return `\n${PH}${images.length - 1}${PH}\n`;
  };
  let s = dropOwnRelated(md);
  s = outsideCode(s, (part) =>
    part
      // комментарии Obsidian
      .replace(/%%[\s\S]*?%%/g, '')
      // ![[файл|подпись или размер]]
      .replace(/!\[\[([^[\]\n]+?)\]\]/g, (_, inner: string) => {
        const [target, ...rest] = inner.split('|');
        const file = target.split('#')[0].trim();
        const alt = rest.join('|').trim();
        if (isImagePath(file)) return img(file, /^\d+(x\d+)?$/.test(alt) ? '' : alt);
        // встроенная заметка — ссылкой на неё
        return convertWiki(inner, ctx.titleOf);
      })
      // ![подпись](путь)
      .replace(/!\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g, (all, alt: string, src: string) => {
        if (/^https?:/i.test(src)) return alt ? `[${alt}](${src})` : src;
        let ref = src;
        try {
          ref = decodeURI(src);
        } catch {
          /* оставить как есть */
        }
        return isImagePath(ref) ? img(ref, alt) : all;
      })
      // [[ссылки]]
      .replace(/\[\[([^[\]\n]+?)\]\]/g, (_, inner: string) => convertWiki(inner, ctx.titleOf))
      // ^id блоков в конце строки
      .replace(/[ \t]+\^[\w-]+[ \t]*$/gm, '')
      // выноски: «> [!note] Заголовок» → «> 💡 Заголовок»
      .replace(/^>[ \t]*\[![\w-]+\][+-]?[ \t]*(.*)$/gm, (_, title: string) => `> 💡 ${title}`),
  );
  const blocks = markdownToBlocks(s);
  const out: Block[] = [];
  for (const b of blocks) {
    const m = b.type === 'p' && b.text ? phRe.exec(b.text) : null;
    if (m) {
      const im = images[+m[1]];
      if (im.path) out.push(newBlock('image', { src: IMG_REF + im.path, ...(im.caption ? { caption: im.caption } : {}) }));
      else out.push(newBlock('p', { text: `*[Изображение: ${im.caption || im.name}]*` }));
      continue;
    }
    if (b.type === 'callout' && b.text) b.text = b.text.replace(/^\s+/, '');
    out.push(b);
  }
  return out;
}

// ---------- Хранилище целиком ----------

/**
 * Разобрать хранилище: заметки (.md) с папками и датами; картинки — по путям imagePaths.
 * Пути — как в архиве; общая корневая папка и служебные папки (.obsidian, .trash) пропускаются.
 */
export function parseVault(files: VaultInput[], imagePaths: string[] = []): ImportedNote[] {
  const md = files.map((f) => ({ ...f, path: slash(f.path) })).filter((f) => /\.md$/i.test(f.path) && !isSkippedPath(f.path));
  const imgs = imagePaths.map(slash).filter((p) => isImagePath(p) && !isSkippedPath(p));
  const root = commonRoot([...md.map((f) => f.path), ...imgs]);
  const rel = (p: string) => (root && p.startsWith(root) ? p.slice(root.length) : p);

  // картинки: точный путь и имя файла (Obsidian по умолчанию ссылается по имени)
  const byPath = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const p of imgs) {
    byPath.set(rel(p).toLowerCase(), p);
    const n = baseName(p).toLowerCase();
    if (!byName.has(n)) byName.set(n, p);
  }
  const image = (ref: string, from: string) => {
    const r = slash(ref).toLowerCase();
    const dir = dirName(rel(from)).toLowerCase();
    const joined = normPath(dir ? dir + '/' + r : r);
    return byPath.get(joined) ?? byPath.get(normPath(r)) ?? byName.get(baseName(r));
  };

  const parsed = md.map((f) => {
    const { front, body } = splitFrontmatter(f.text);
    const p = rel(f.path);
    const file = stripMd(baseName(p));
    return { f, p, file, front, body, title: (front.title ?? file).trim() };
  });
  // имя файла → название (ссылки в Obsidian — по имени файла, в приложении — по названию)
  const titles = new Map<string, string>();
  for (const x of parsed) {
    const k = normTitle(x.file);
    if (!titles.has(k)) titles.set(k, x.title);
    for (const a of x.front.aliases) if (!titles.has(normTitle(a))) titles.set(normTitle(a), x.title);
  }
  const titleOf = (t: string) => titles.get(normTitle(t));

  return parsed.map((x) => {
    const dir = dirName(x.p);
    return {
      path: x.p,
      title: x.title,
      ...(dir ? { folder: dir.split('/').join(' / ') } : {}),
      blocks: obsidianToBlocks(x.body, { path: x.f.path, image, titleOf }),
      ...(x.front.created ? { createdAt: x.front.created } : {}),
      ...((x.front.updated ?? x.f.date) ? { updatedAt: x.front.updated ?? x.f.date } : {}),
      tags: [...new Set(x.front.tags)],
    };
  });
}

/** «a/./b/../c» → «a/c» */
function normPath(p: string): string {
  const out: string[] = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return out.join('/');
}
