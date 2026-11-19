/**
 * «Текст с фото»: чистая логика без браузера — размер снимка, строки Apple Vision → текст, текст → блоки заметки.
 * Тесты гоняют модуль в Node (tests/ocr.test.ts).
 */
import { type Block, newBlock } from './model';
import { t } from '../i18n/index';

/** Самое большое фото, которое примет сервер (байт; на сервере — OCR_MAX_BYTES) */
export const OCR_MAX_BYTES = 4 * 1024 * 1024;

/** Ступени сжатия: сначала 2000 px, если файл всё ещё велик — меньше */
export const OCR_STEPS: readonly { max: number; quality: number }[] = [
  { max: 2000, quality: 0.85 },
  { max: 1600, quality: 0.8 },
  { max: 1280, quality: 0.72 },
];

/** Уменьшить до max px по большей стороне (не увеличивая), стороны — целые и не меньше 1 */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Байт в base64-строке (без префикса data:) */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** data:image/jpeg;base64,XXXX → { mime, data } */
export function splitDataUrl(url: string): { mime: string; data: string } | null {
  const m = url.match(/^data:([\w/+.-]+);base64,(.*)$/s);
  return m ? { mime: m[1], data: m[2] } : null;
}

// ---------- Apple Vision: строки с рамками → текст ----------

/** Строка, найденная Vision: рамка в долях снимка, начало координат — левый верхний угол */
export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const END = /[.!?…:;»")\]]$/;

/**
 * Строки Vision → текст «как читает человек»: сверху вниз, слова одной высоты — в одну строку (колонки чека),
 * строки абзаца, разорванные переносом, — вместе, большие промежутки — пустая строка между абзацами.
 */
export function layoutLines(lines: readonly OcrLine[]): string {
  const items = lines.filter((l) => l.text.trim() && l.h > 0).map((l) => ({ ...l, text: l.text.trim(), cy: l.y + l.h / 2 }));
  if (!items.length) return '';
  items.sort((a, b) => a.cy - b.cy || a.x - b.x);
  // ряды: центр строки попадает в высоту ряда
  type Row = { parts: typeof items; top: number; bottom: number; left: number; right: number; h: number };
  const rows: Row[] = [];
  for (const it of items) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(it.cy - (r.top + r.bottom) / 2) < Math.min(r.h, it.h) * 0.5) {
      r.parts.push(it);
      r.top = Math.min(r.top, it.y);
      r.bottom = Math.max(r.bottom, it.y + it.h);
      r.left = Math.min(r.left, it.x);
      r.right = Math.max(r.right, it.x + it.w);
      r.h = Math.max(r.h, it.h);
    } else rows.push({ parts: [it], top: it.y, bottom: it.y + it.h, left: it.x, right: it.x + it.w, h: it.h });
  }
  const heights = rows.map((r) => r.h).sort((a, b) => a - b);
  const lineH = heights[Math.floor(heights.length / 2)];
  const widest = Math.max(...rows.map((r) => r.right - r.left));
  const out: string[] = [];
  let prev: Row | null = null;
  for (const r of rows) {
    const text = r.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.text)
      .join(' ');
    if (!prev) {
      out.push(text);
      prev = r;
      continue;
    }
    const gap = r.top - prev.bottom;
    const last = out[out.length - 1];
    // строка шла почти во всю ширину, не закончилась точкой, а следующая — со строчной буквы: перенос внутри абзаца
    const wrapped = prev.parts.length === 1 && r.parts.length === 1 && prev.right - prev.left >= widest * 0.7 && !END.test(last) && /^\p{Ll}/u.test(text) && gap < lineH * 0.8;
    if (wrapped) out[out.length - 1] = /\p{L}-$/u.test(last) ? last.slice(0, -1) + text : `${last} ${text}`;
    else {
      if (gap > lineH * 0.9) out.push('');
      out.push(text);
    }
    prev = r;
  }
  return out.join('\n');
}

/** Текст нескольких снимков — по порядку, через пустую строку */
export function joinTexts(texts: readonly string[]): string {
  return texts
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n');
}

// ---------- Текст → заметка ----------

/** Строки текста → блоки: пункты списка, нумерация и галочки узнаются, остальное — абзацы */
export function ocrTextToBlocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const s = raw.trim();
    if (!s) continue;
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^[-•*–·▪◦]\s+(.+)$/))) out.push(newBlock('bullet', { text: m[1] }));
    else if ((m = s.match(/^\d{1,3}[.)]\s+(.+)$/))) out.push(newBlock('number', { text: m[1] }));
    else if ((m = s.match(/^[☐□]\s*(.+)$/))) out.push(newBlock('todo', { text: m[1] }));
    else if ((m = s.match(/^[☑☒✓✔]\s*(.+)$/))) out.push(newBlock('todo', { text: m[1], checked: true }));
    else out.push(newBlock('p', { text: s }));
  }
  return out;
}

/** Новая заметка: короткая первая строка — название, иначе «Текст с фото» и весь текст в теле */
export function ocrNoteParts(text: string, max = 60): { title: string; blocks: Block[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const i = lines.findIndex((l) => l.trim());
  const first = i >= 0 ? lines[i].trim() : '';
  const isItem = /^([-•*–·▪◦☐□☑☒✓✔]|\d{1,3}[.)])\s/.test(first);
  if (first && first.length <= max && !isItem && !/^https?:\/\//i.test(first)) return { title: first.replace(/[.:]$/, ''), blocks: ocrTextToBlocks(lines.slice(i + 1).join('\n')) };
  return { title: t('Текст с фото'), blocks: ocrTextToBlocks(text) };
}

/** Языки для Apple Vision: язык интерфейса первым, затем русский и английский (казахский — если система его знает) */
export function visionLanguages(lang: 'ru' | 'en' | 'kk'): string[] {
  const base = lang === 'en' ? ['en-US', 'ru-RU'] : ['ru-RU', 'en-US'];
  return lang === 'kk' ? ['kk-KZ', ...base] : base;
}

/** Инструкция модели (свой ключ Claude); на сервере — такая же в server/src/ai.ts */
export const OCR_NONE = '[[NO_TEXT]]';
export const OCR_PROMPT = [
  'Распознай весь текст на изображении (страница, доска, чек, скриншот, вывеска, рукописная записка) и верни ТОЛЬКО этот текст — без вступления, пояснений и markdown-ограждений ```.',
  'Текст может быть на русском, казахском (буквы ә ғ қ ң ө ұ ү һ і), английском или смешанный. Сохраняй язык и написание оригинала: не переводи, не пересказывай, не исправляй слова и цифры.',
  'Строки одного абзаца, разорванные переносом, соединяй в одну строку (перенос слова с дефисом — убери дефис). Абзацы разделяй пустой строкой.',
  'Списки, пункты и строки таблиц или чека оставляй отдельными строками; пункты списка начинай с «- ». Колонки строки чека или таблицы разделяй пробелами.',
  'Неразборчивое слово замени на «…». Порядок — как читает человек: сверху вниз, слева направо, колонки по очереди.',
  `Если текста на изображении нет — ответь ровно ${OCR_NONE}.`,
].join('\n');

/** Ответ модели → текст (как parseOcrText на сервере) */
export function parseOcrReply(s: string): string {
  let x = (s ?? '').replace(/\r\n?/g, '\n').trim();
  const fenced = x.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  if (fenced) x = fenced[1].trim();
  if (!x || (x.includes(OCR_NONE) && x.replace(OCR_NONE, '').trim().length < 3)) return '';
  return x.replace(/\n{3,}/g, '\n\n');
}

/** Ошибка сервера по коду ответа → понятный текст */
export function ocrServerError(status: number | undefined, fallback: string): string {
  if (status === 429) return t('Бесплатный ИИ на сегодня исчерпан. Попробуйте завтра или добавьте свой ключ Claude в Настройках.');
  if (status === 401) return t('Войдите в аккаунт, чтобы распознавать текст с фото.');
  if (status === 413) return t('Фото слишком большое');
  if (status === 503) return t('ИИ сейчас недоступен. Добавьте свой ключ Claude в Настройках или попробуйте позже.');
  if (status === 0) return t('Нет интернета — распознать фото не получится');
  return fallback;
}
