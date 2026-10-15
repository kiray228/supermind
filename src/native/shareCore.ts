/**
 * «Поделиться → SuperMind»: присланный текст и картинки → блоки заметки. Модуль чистый — тесты гоняют его в Node.
 */
import { type Block, newBlock } from '../notes/model';

/** Текст — абзацами (пустые строки пропускаются), затем картинки */
export function sharedBlocks(text: string, images: string[] = []): Block[] {
  const out: Block[] = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => newBlock('p', { text: l }));
  for (const src of images) out.push(newBlock('image', { src }));
  return out;
}

/** Название новой заметки: первая строка текста (не ссылка), заголовок письма/страницы или «Фото» */
export function sharedTitle(text: string, title?: string, images = 0, max = 80): string {
  const first = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);
  let t = first && !isUrl(first) ? first : title?.trim() || first || '';
  if (!t && images) t = images > 1 ? `Фото (${images})` : 'Фото';
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** Блоки новой заметки: без строки, ставшей названием */
export function sharedNoteBlocks(text: string, title: string, images: string[] = []): Block[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const i = lines.findIndex(Boolean);
  const rest = i >= 0 && lines[i] === title ? lines.slice(i + 1).join('\n') : text;
  return sharedBlocks(rest, images);
}
