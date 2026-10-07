import { Fragment, type ReactNode } from 'react';

/** Встроенная разметка: **жирный**, *курсив*, `код` */
function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2] ?? m[3]) out.push(<strong key={k}>{m[2] ?? m[3]}</strong>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5]) out.push(<em key={k}>{m[5]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

type Block =
  | { t: 'p'; lines: string[] }
  | { t: 'h'; text: string }
  | { t: 'ul'; items: { text: string; check?: boolean }[] }
  | { t: 'ol'; items: string[]; start: number }
  | { t: 'code'; text: string }
  | { t: 'quote'; text: string }
  | { t: 'hr' };

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let code: string[] | null = null;
  const lastBlock = () => blocks[blocks.length - 1];
  for (const raw of lines) {
    if (code) {
      if (/^\s*```/.test(raw)) {
        blocks.push({ t: 'code', text: code.join('\n') });
        code = null;
      } else code.push(raw);
      continue;
    }
    const s = raw.trim();
    let m: RegExpMatchArray | null;
    if (!s) {
      blocks.push({ t: 'p', lines: [] });
      continue;
    }
    if (/^```/.test(s)) code = [];
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) blocks.push({ t: 'hr' });
    else if ((m = s.match(/^#{1,6}\s+(.*)$/))) blocks.push({ t: 'h', text: m[1] });
    else if ((m = s.match(/^[-*+•]\s+\[( |x|X)\]\s*(.*)$/)) || (m = s.match(/^[-*+•]\s+(.*)$/))) {
      const item = m.length > 2 ? { text: m[2], check: m[1] !== ' ' } : { text: m[1] };
      const lb = lastBlock();
      if (lb?.t === 'ul') lb.items.push(item);
      else blocks.push({ t: 'ul', items: [item] });
    } else if ((m = s.match(/^(\d+)[.)]\s+(.*)$/))) {
      const lb = lastBlock();
      if (lb?.t === 'ol') lb.items.push(m[2]);
      else blocks.push({ t: 'ol', items: [m[2]], start: Number(m[1]) || 1 });
    } else if ((m = s.match(/^>\s?(.*)$/))) blocks.push({ t: 'quote', text: m[1] });
    else {
      const lb = lastBlock();
      if (lb?.t === 'p' && lb.lines.length) lb.lines.push(s);
      else blocks.push({ t: 'p', lines: [s] });
    }
  }
  if (code) blocks.push({ t: 'code', text: code.join('\n') });
  return blocks.filter((b) => b.t !== 'p' || b.lines.length);
}

/** Простая отрисовка Markdown из ответов ИИ (без HTML) */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parse(text);
  return (
    <div className={`as-md${className ? ' ' + className : ''}`}>
      {blocks.map((b, i) => {
        const k = String(i);
        switch (b.t) {
          case 'p':
            return (
              <p key={k}>
                {b.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(l, `${k}-${j}`)}
                  </Fragment>
                ))}
              </p>
            );
          case 'h':
            return <h4 key={k}>{inline(b.text, k)}</h4>;
          case 'ul':
            return (
              <ul key={k}>
                {b.items.map((it, j) => (
                  <li key={j} className={it.check !== undefined ? 'as-md-check' + (it.check ? ' done' : '') : undefined}>
                    {it.check !== undefined && <span className="as-md-box">{it.check ? '✓' : ''}</span>}
                    {inline(it.text, `${k}-${j}`)}
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={k} start={b.start}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${k}-${j}`)}</li>
                ))}
              </ol>
            );
          case 'code':
            return <pre key={k}>{b.text}</pre>;
          case 'quote':
            return <blockquote key={k}>{inline(b.text, k)}</blockquote>;
          case 'hr':
            return <hr key={k} />;
        }
      })}
    </div>
  );
}
