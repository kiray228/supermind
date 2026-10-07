/**
 * Общие помощники слоя импорта/экспорта: экранирование XML, загрузка JSZip,
 * сборка листов/документов без зависимости от стора.
 */
import type JSZipType from 'jszip';
import type { MindDoc, Sheet, StructureType, TaskInfo, Topic } from '../types';
import { uid } from '../utils/tree';

/** Значение accept для <input type="file"> */
export const IMPORT_ACCEPT =
  '.supermind,.2mind,.xmind,.md,.markdown,.txt,.opml,.json,text/markdown,text/plain,text/x-opml,application/json';

// ---------- XML ----------

/** Символы, недопустимые в XML 1.0 (управляющие, одиночные суррогаты, U+FFFE/U+FFFF) */
const INVALID_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

export function stripInvalidXml(s: string): string {
  return s.replace(INVALID_XML, '');
}

/** Экранирование текстового содержимого / значения атрибута (&, <, >, ", ') */
export function escXml(v: unknown): string {
  const s = v == null ? '' : String(v);
  return stripInvalidXml(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Для значений атрибутов: дополнительно сохраняет переводы строк и табы */
export function escAttr(v: unknown): string {
  return escXml(v).replace(/\r\n?/g, '\n').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ---------- JSZip (ленивая загрузка — отдельный чанк) ----------

export type Zip = JSZipType;

export async function loadZip(): Promise<typeof JSZipType> {
  const mod = await import('jszip');
  return mod.default;
}

/** Убрать записи-каталоги (JSZip создаёт их автоматически) — Office/Xmind их не ожидают */
export function stripDirs(zip: Zip): Zip {
  for (const [p, f] of Object.entries(zip.files)) if (f.dir) delete zip.files[p];
  return zip;
}

export async function newZip(): Promise<Zip> {
  const JSZip = await loadZip();
  return new JSZip();
}

// ---------- Модель ----------

export const DEFAULT_ROOT_TEXT = 'Центральная тема';

export function makeSheet(root: Topic, title = 'Лист 1', structure: StructureType = 'map'): Sheet {
  return {
    id: uid(),
    title,
    root,
    floating: [],
    relationships: [],
    boundaries: [],
    summaries: [],
    structure,
    themeId: 'classic',
    rainbow: true,
  };
}

export function makeDoc(title: string, sheets: Sheet[]): MindDoc {
  const now = Date.now();
  return { id: uid(), title, sheets, activeSheet: sheets[0].id, createdAt: now, updatedAt: now };
}

/** Однострочный текст темы (для заголовков, ячеек) */
export function oneLine(s: string | undefined): string {
  return (s ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

export function stripExt(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(0, i) : base;
}

export function fileExt(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

// ---------- Задачи / маркеры (для табличных экспортов) ----------

export const STATUS_TEXT: Record<TaskInfo['status'], string> = {
  todo: 'К выполнению',
  doing: 'В работе',
  done: 'Готово',
};

export const PRIORITY_TEXT: Record<number, string> = { 1: 'Высокий', 2: 'Средний', 3: 'Низкий' };

/** Приоритет темы: из задачи (Высокий/Средний/Низкий) или из маркера priority-N */
export function topicPriority(t: Topic): string {
  const p = t.task?.priority;
  if (p && PRIORITY_TEXT[p]) return PRIORITY_TEXT[p];
  const m = t.markers?.find((x) => /^priority-\d$/.test(x));
  return m ? m.slice('priority-'.length) : '';
}

/** Прогресс темы 0..100 из задачи или маркера progress-N; null — нет данных */
export function topicProgress(t: Topic): number | null {
  if (typeof t.task?.progress === 'number') return Math.max(0, Math.min(100, Math.round(t.task.progress)));
  const m = t.markers?.find((x) => /^progress-[0-4]$/.test(x));
  if (m) return Number(m.slice(-1)) * 25;
  if (t.task?.status === 'done') return 100;
  return null;
}

/** Убрать undefined-поля (чтобы не плодить ключи в JSON) */
export function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}
