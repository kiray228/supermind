import type { ReactNode } from 'react';
import { parseWiki } from './links';

/**
 * Встроенное оформление в стиле Markdown → React-элементы (без innerHTML):
 * **жирный**, *курсив*, ~~зачёркнутый~~, `код`, ==выделение==, [ссылка](url), голые ссылки,
 * [[ссылка на заметку]] и подсвеченные упоминания названий других заметок.
 */

const SRC = '\\[\\[([^\\[\\]\\n]+?)\\]\\]|`([^`\\n]+)`|\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)|\\*\\*(.+?)\\*\\*|~~(.+?)~~|==(.+?)==|\\*([^*\\s][^*\\n]*?)\\*|(https?:\\/\\/[^\\s<>()]+[^\\s<>().,;:!?"\'»])';

/** Упоминание: часть текста [start, end) — название единицы id */
export interface InlineMention {
  start: number;
  end: number;
  id: string;
}

export interface InlineOpts {
  /** упоминания (позиции — в исходном тексте) */
  mentions?: InlineMention[];
  onMention?: (id: string) => void;
  /** нажали [[ссылку]] */
  onWiki?: (title: string) => void;
  /** есть ли единица с таким названием (нет — ссылка показывается как «ещё не создана») */
  wikiExists?: (title: string) => boolean;
  /** подсказка при наведении на упоминание */
  mentionTitle?: (id: string) => string;
}

export function hasMarkup(text: string): boolean {
  return /\*\S|~~|==|`|\]\(|\[\[|https?:\/\//.test(text);
}

/** Разрешены только безопасные адреса */
export function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^www\./i.test(u)) return 'https://' + u;
  return null;
}

const stop = (e: { stopPropagation(): void; preventDefault(): void }) => {
  e.stopPropagation();
  e.preventDefault();
};

/** Обычный текст с упоминаниями внутри (offset — где этот кусок начинается в исходном тексте) */
function plainWithMentions(s: string, offset: number, opts: InlineOpts | undefined, key: string, out: ReactNode[]) {
  const ms = opts?.mentions?.filter((m) => m.start >= offset && m.end <= offset + s.length);
  if (!ms?.length || !opts?.onMention) {
    out.push(s);
    return;
  }
  let last = 0;
  ms.forEach((m, i) => {
    const a = m.start - offset;
    const b = m.end - offset;
    if (a < last) return;
    if (a > last) out.push(s.slice(last, a));
    out.push(
      <a
        key={`${key}-m${i}`}
        href="#"
        className="nt-mention"
        title={opts.mentionTitle?.(m.id)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          stop(e);
          opts.onMention!(m.id);
        }}
      >
        {s.slice(a, b)}
      </a>,
    );
    last = b;
  });
  if (last < s.length) out.push(s.slice(last));
}

export function renderInline(text: string, depth = 0, opts?: InlineOpts): ReactNode[] {
  const out: ReactNode[] = [];
  if (depth > 4) return [text];
  const re = new RegExp(SRC, 'g');
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  // упоминания — только в тексте верхнего уровня (позиции известны точно)
  const plain = (s: string, at: number) => (depth === 0 ? plainWithMentions(s, at, opts, `${depth}-${k}`, out) : out.push(s));
  while ((m = re.exec(text))) {
    // одиночная звёздочка внутри слова (2*3*4) — не курсив
    if (m[8] !== undefined && m.index > 0 && /\w/.test(text[m.index - 1])) continue;
    if (m.index > last) plain(text.slice(last, m.index), last);
    const key = `${depth}-${k++}`;
    if (m[1] !== undefined) {
      const { title, label } = parseWiki(m[1]);
      const exists = opts?.wikiExists?.(title) ?? true;
      out.push(
        <a
          key={key}
          href="#"
          className={`nt-link nt-wiki${exists ? '' : ' is-new'}`}
          title={exists ? title : `«${title}» — такой заметки ещё нет, нажмите, чтобы создать`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            stop(e);
            opts?.onWiki?.(title);
          }}
        >
          {label}
        </a>,
      );
    } else if (m[2] !== undefined) out.push(<code key={key}>{m[2]}</code>);
    else if (m[3] !== undefined) {
      const href = safeHref(m[4]);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="nt-link" onClick={(e) => e.stopPropagation()}>
            {renderInline(m[3], depth + 1, opts)}
          </a>
        ) : (
          <span key={key}>{m[0]}</span>
        ),
      );
    } else if (m[5] !== undefined) out.push(<strong key={key}>{renderInline(m[5], depth + 1, opts)}</strong>);
    else if (m[6] !== undefined) out.push(<s key={key}>{renderInline(m[6], depth + 1, opts)}</s>);
    else if (m[7] !== undefined) out.push(<mark key={key}>{renderInline(m[7], depth + 1, opts)}</mark>);
    else if (m[8] !== undefined) out.push(<em key={key}>{renderInline(m[8], depth + 1, opts)}</em>);
    else if (m[9] !== undefined)
      out.push(
        <a key={key} href={m[9]} target="_blank" rel="noopener noreferrer" className="nt-link" onClick={(e) => e.stopPropagation()}>
          {m[9]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) plain(text.slice(last), last);
  return out;
}
