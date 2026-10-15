import type { ReactNode } from 'react';
import { renderInline } from '../inline';
import { type AskSource, splitCitations } from '../askPrompt';

/** Ответ ИИ: абзацы, списки, заголовки; [1] — кнопки-ссылки на источники */
export function CitedText({ text, sources, onOpen }: { text: string; sources: AskSource[]; onOpen: (id: string) => void }) {
  const count = sources.length;
  const sourceOf = (n: number) => sources.find((s) => s.n === n);
  const line = (s: string, key: string): ReactNode[] =>
    splitCitations(s, count).flatMap((p, i) =>
      p.t === 'text'
        ? renderInline(p.s).map((x, j) => <span key={`${key}-${i}-${j}`}>{x}</span>)
        : [
            <span key={`${key}-c${i}`} className="nt-ask-cites">
              {p.n.map((n) => {
                const src = sourceOf(n);
                return (
                  <button key={n} className="nt-ask-cite" onClick={() => src && onOpen(src.id)} title={src ? `${src.kind} «${src.title}»` : undefined}>
                    {n}
                  </button>
                );
              })}
            </span>,
          ],
    );
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    blocks.push(list.ordered ? <ol key={'l' + blocks.length}>{list.items}</ol> : <ul key={'l' + blocks.length}>{list.items}</ul>);
    list = null;
  };
  text.split('\n').forEach((raw, i) => {
    const s = raw.trim();
    if (!s) return flush();
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^[-*•]\s+(.*)$/)) || (m = s.match(/^(\d+)[.)]\s+(.*)$/))) {
      const ordered = /^\d/.test(s);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(<li key={i}>{line(m[m.length - 1], 'li' + i)}</li>);
      return;
    }
    flush();
    if ((m = s.match(/^#{1,4}\s+(.*)$/))) blocks.push(<div key={i} className="nt-ask-h">{line(m[1], 'h' + i)}</div>);
    else blocks.push(<p key={i}>{line(s, 'p' + i)}</p>);
  });
  flush();
  return <div className="nt-ask-answer">{blocks}</div>;
}
