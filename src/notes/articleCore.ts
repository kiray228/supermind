/**
 * Статья по ссылке: разбор страницы (название, сайт, описание, текст статьи без меню и рекламы),
 * запрос к ИИ «главные мысли» и текст заметки. Модуль чистый — тесты гоняют его в Node.
 */

export interface Article {
  url: string;
  title: string;
  site: string;
  description?: string;
  image?: string;
  /** текст статьи: абзацы через пустую строку, подзаголовки — «## », пункты — «- » */
  text: string;
}

const URL_RE = /https?:\/\/[^\s<>"'«»]+[^\s<>"'«».,;:!?)\]]/i;

/** Первая ссылка в тексте */
export function firstUrl(text: string): string | null {
  return URL_RE.exec(text)?.[0] ?? null;
}

// ---------- Кодировка ----------

/** Кодировка из заголовка Content-Type или <meta charset> */
export function charsetOf(contentType: string | undefined, head: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  return (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();
}

/** Байты страницы → текст в её кодировке (windows-1251 и т. п.) */
export function decodePage(bytes: Uint8Array, contentType?: string): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const cs = charsetOf(contentType, head);
  try {
    return new TextDecoder(cs, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// ---------- Разбор HTML ----------

const ENT: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', laquo: '«', raquo: '»', hellip: '…',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', bdquo: '„', copy: '©', reg: '®', trade: '™', times: '×', minus: '−', middot: '·', bull: '•', shy: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENT[e.toLowerCase()] ?? all;
  });
}

/** Тег целиком — и когда в значениях атрибутов есть «>» (data-атрибуты Википедии и т. п.) */
const TAG = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const TAG_RE = new RegExp(`<${TAG}>`, 'g');
const clean = (s: string) => decodeEntities(s.replace(TAG_RE, ' ')).replace(/\s+/g, ' ').trim();

/** Атрибуты тега: <meta property="og:title" content="…"> → { property, content } */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

function metas(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const a = attrs(m[0]);
    const k = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (k && a.content && !out.has(k)) out.set(k, decodeEntities(a.content).trim());
  }
  return out;
}

const abs = (u: string | undefined, base: string) => {
  if (!u) return undefined;
  try {
    const r = new URL(u, base);
    return r.protocol === 'http:' || r.protocol === 'https:' ? r.href : undefined;
  } catch {
    return undefined;
  }
};

/** Убрать теги вместе с содержимым (скрипты, меню, подвал…) */
function drop(html: string, tags: string[]): string {
  let s = html;
  for (const t of tags) s = s.replace(new RegExp(`<${t}\\b${TAG}>[\\s\\S]*?</${t}\\s*>`, 'gi'), ' ');
  return s;
}

/** Самый большой <article> (или <main>, или body) */
function container(html: string): string {
  const pick = (tag: string) => {
    let best = '';
    for (const m of html.matchAll(new RegExp(`<${tag}\\b${TAG}>([\\s\\S]*?)</${tag}\\s*>`, 'gi'))) if (m[1].length > best.length) best = m[1];
    return best;
  };
  const article = pick('article');
  if (clean(article).length > 400) return article;
  const main = pick('main');
  if (clean(main).length > 400) return main;
  return /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
}

/** Текст статьи: подзаголовки, абзацы, пункты; короткие обрывки меню и кнопок отбрасываются */
export function articleText(html: string, max = 20000): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ');
  s = drop(s, ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas', 'select', 'button']);
  s = container(s);
  s = drop(s, ['nav', 'header', 'footer', 'aside', 'form', 'menu', 'dialog']);
  s = s
    .replace(new RegExp(`<h([1-6])\\b${TAG}>([\\s\\S]*?)</h\\1\\s*>`, 'gi'), (_, __, t: string) => `\n\uE001H${clean(t)}\n`)
    .replace(new RegExp(`<li\\b${TAG}>`, 'gi'), '\n\uE001L')
    .replace(new RegExp(`<(?:br|hr)\\b${TAG}>`, 'gi'), '\n')
    .replace(new RegExp(`</?(?:p|div|section|blockquote|pre|tr|table|ul|ol|dl|dd|dt|figure|figcaption|article|main)\\b${TAG}>`, 'gi'), '\n');
  const out: string[] = [];
  let len = 0;
  for (const raw of s.split('\n')) {
    const kind = raw.startsWith('\uE001H') ? 'h' : raw.startsWith('\uE001L') ? 'l' : 'p';
    const t = clean(raw.replace(/^\uE001[HL]/, ''));
    if (!t) continue;
    if (kind === 'h' && (t.length < 3 || t.length > 160)) continue;
    if (kind === 'l' && t.length < 15) continue;
    // абзац: достаточно длинный или законченное предложение
    if (kind === 'p' && t.length < 40 && !(t.length >= 20 && /[.!?…»"]$/.test(t))) continue;
    const line = kind === 'h' ? `## ${t}` : kind === 'l' ? `- ${t}` : t;
    if (out[out.length - 1] === line) continue;
    out.push(line);
    len += line.length;
    if (len > max) break;
  }
  // подзаголовок без текста после него — не нужен
  return out.filter((l, i) => !(l.startsWith('## ') && (i === out.length - 1 || out[i + 1].startsWith('## ')))).join('\n\n');
}

/** Страница → статья */
export function extractArticle(html: string, url: string): Article {
  const m = metas(html);
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  })();
  const site = m.get('og:site_name') || host;
  const firstH1 = clean(new RegExp(`<h1\\b${TAG}>([\\s\\S]*?)</h1>`, 'i').exec(html)?.[1] ?? '');
  let title = m.get('og:title') || m.get('twitter:title') || clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '') || firstH1 || host;
  // «Название — Сайт», «Название | Сайт» → «Название»
  const tail = new RegExp(`\\s*[|—–:-]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  if (tail.test(title) && title.replace(tail, '').length > 3) title = title.replace(tail, '');
  const parts = title.split(/\s+[|—–-]\s+/);
  if (parts.length > 1 && firstH1) {
    const head = parts.slice(0, -1).join(' — ');
    if (head.toLowerCase() === firstH1.toLowerCase() || parts[0].toLowerCase() === firstH1.toLowerCase()) title = firstH1;
  }
  const description = m.get('og:description') || m.get('description') || m.get('twitter:description') || undefined;
  return { url, title: title.slice(0, 200), site, ...(description ? { description: description.slice(0, 500) } : {}), ...(abs(m.get('og:image'), url) ? { image: abs(m.get('og:image'), url) } : {}), text: articleText(html) };
}

// ---------- ИИ ----------

export const ARTICLE_SYSTEM = `Ты помогаешь сохранить статью в личную базу знаний («второй мозг»).
Пиши по-русски (статья на другом языке — переводи), кратко, в markdown, без вступлений и без заголовка-названия:
— первая строка: 1–2 предложения, о чём статья;
— «## Главные мысли» — 3–7 пунктов, самое ценное;
— «## Цифры и факты» — до 5 пунктов, если в статье есть конкретика;
— «## Что применить» — 1–3 пункта, если статья практическая.
Раздел, для которого нет материала, пропусти. Пиши только то, что есть в статье.`;

export function buildArticlePrompt(a: Article): string {
  return `Статья «${a.title}» (${a.site})${a.description ? `\nОписание: ${a.description}` : ''}\n\n${a.text.slice(0, 18000)}`;
}

/** Текст заметки: источник, пересказ (или, без ИИ, — описание и начало статьи) */
export function articleMarkdown(a: Article, summary?: string): string {
  const src = `Источник: [${a.site}](${a.url})`;
  if (summary?.trim()) return `${src}\n\n${summary.trim()}\n`;
  const parts = [src];
  if (a.description) parts.push(a.description);
  const start = a.text
    .split('\n\n')
    .filter((l) => !l.startsWith('## '))
    .slice(0, 3)
    .join('\n\n');
  if (start) parts.push('## Начало статьи', start);
  return parts.join('\n\n') + '\n';
}
