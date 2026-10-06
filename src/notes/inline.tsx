import type { ReactNode } from 'react';

/**
 * Встроенное оформление в стиле Markdown → React-элементы (без innerHTML):
 * **жирный**, *курсив*, ~~зачёркнутый~~, `код`, ==выделение==, [ссылка](url) и голые ссылки.
 */

const SRC = '`([^`\\n]+)`|\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)|\\*\\*(.+?)\\*\\*|~~(.+?)~~|==(.+?)==|\\*([^*\\s][^*\\n]*?)\\*|(https?:\\/\\/[^\\s<>()]+[^\\s<>().,;:!?"\'»])';

export function hasMarkup(text: string): boolean {
  return /\*\S|~~|==|`|\]\(|https?:\/\//.test(text);
}

/** Разрешены только безопасные адреса */
export function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^www\./i.test(u)) return 'https://' + u;
  return null;
}

export function renderInline(text: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  if (depth > 4) return [text];
  const re = new RegExp(SRC, 'g');
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // одиночная звёздочка внутри слова (2*3*4) — не курсив
    if (m[7] !== undefined && m.index > 0 && /\w/.test(text[m.index - 1])) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${depth}-${k++}`;
    if (m[1] !== undefined) out.push(<code key={key}>{m[1]}</code>);
    else if (m[2] !== undefined) {
      const href = safeHref(m[3]);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="nt-link" onClick={(e) => e.stopPropagation()}>
            {renderInline(m[2], depth + 1)}
          </a>
        ) : (
          <span key={key}>{m[0]}</span>
        ),
      );
    } else if (m[4] !== undefined) out.push(<strong key={key}>{renderInline(m[4], depth + 1)}</strong>);
    else if (m[5] !== undefined) out.push(<s key={key}>{renderInline(m[5], depth + 1)}</s>);
    else if (m[6] !== undefined) out.push(<mark key={key}>{renderInline(m[6], depth + 1)}</mark>);
    else if (m[7] !== undefined) out.push(<em key={key}>{renderInline(m[7], depth + 1)}</em>);
    else if (m[8] !== undefined)
      out.push(
        <a key={key} href={m[8]} target="_blank" rel="noopener noreferrer" className="nt-link" onClick={(e) => e.stopPropagation()}>
          {m[8]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
