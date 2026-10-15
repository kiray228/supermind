import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Brain, Loader2, Square, Trash2, X } from 'lucide-react';
import { onBack } from '../../ui/dialogs';
import { renderInline } from '../inline';
import { splitCitations } from '../askPrompt';
import { type AskEntry, ask, clearAsk, closeAsk, sourceOf, stopAsk, useAsk } from '../brainAsk';
import { openItem } from '../brain';
import { brainItems } from '../related';
import { parseItemId } from '../brainDocs';
import { KIND_ICON } from './kindIcons';

/** Открыть источник ответа: шторка закрывается, запись открывается в своём разделе */
function openSource(id: string) {
  closeAsk();
  void openItem(id);
}

/** Ответ ИИ: абзацы, списки, заголовки; [1] — ссылки на источники */
function Answer({ entry }: { entry: AskEntry }) {
  const count = entry.sources.length;
  const line = (text: string, key: string): ReactNode[] =>
    splitCitations(text, count).flatMap((p, i) =>
      p.t === 'text'
        ? renderInline(p.s).map((x, j) => <span key={`${key}-${i}-${j}`}>{x}</span>)
        : [
            <span key={`${key}-c${i}`} className="nt-ask-cites">
              {p.n.map((n) => {
                const s = sourceOf(entry, n);
                return (
                  <button key={n} className="nt-ask-cite" onClick={() => s && openSource(s.id)} title={s ? `${s.kind} «${s.title}»` : undefined}>
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
  entry.a.split('\n').forEach((raw, i) => {
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

function Entry({ entry }: { entry: AskEntry }) {
  const [srcOpen, setSrcOpen] = useState(false);
  return (
    <div className="nt-ask-entry">
      <div className="nt-ask-q">{entry.q}</div>
      {entry.state === 'search' && (
        <div className="nt-ask-status">
          <Loader2 size={15} className="spin" /> Ищу в заметках, картах и задачах…
        </div>
      )}
      {entry.sources.length > 0 && (
        <div className="nt-ask-sources">
          <button className="nt-ask-src-toggle" onClick={() => setSrcOpen(!srcOpen)} aria-expanded={srcOpen}>
            Источники: {entry.sources.length}
          </button>
          {(srcOpen ? entry.sources : entry.sources.slice(0, 3)).map((s) => {
            const Icon = KIND_ICON[parseItemId(s.id).kind];
            return (
              <button key={s.n} className="nt-ask-src" onClick={() => openSource(s.id)} title={`${s.kind} «${s.title}»`}>
                <span className="nt-ask-src-n">{s.n}</span>
                <Icon size={13} />
                <span className="ellipsis">{s.title || 'Без названия'}</span>
              </button>
            );
          })}
          {!srcOpen && entry.sources.length > 3 && (
            <button className="nt-ask-src-more" onClick={() => setSrcOpen(true)}>
              ещё {entry.sources.length - 3}
            </button>
          )}
        </div>
      )}
      {entry.a && <Answer entry={entry} />}
      {entry.state === 'answer' && !entry.a && (
        <div className="nt-ask-status">
          <Loader2 size={15} className="spin" /> Думаю…
        </div>
      )}
      {entry.state === 'error' && <div className="nt-ask-error">{entry.error}</div>}
    </div>
  );
}

/** «Спросить у мозга» — вопрос своими словами, ответ по своим записям со ссылками на них */
export function BrainAsk() {
  const { entries, draft } = useAsk();
  const [q, setQ] = useState(draft);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = entries.some((e) => e.state === 'search' || e.state === 'answer');

  useEffect(() => onBack(() => (closeAsk(), true)));
  useEffect(() => input.current?.focus(), []);
  // новый ответ — прокрутить вниз
  const last = entries[entries.length - 1];
  useLayoutEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, last?.a, last?.state, last?.sources.length]);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [q]);

  // примеры вопросов — по недавним записям
  const examples = useMemo(() => {
    const titles = brainItems()
      .filter((i) => i.kind !== 'task' && i.title.trim().length > 3)
      .sort((a, b) => b.at - a.at)
      .slice(0, 3)
      .map((i) => i.title.trim());
    return [...titles.map((t) => `Что у меня есть про «${t}»?`), 'Какие планы я записывал на этот месяц?'].slice(0, 4);
  }, []);

  const send = (text = q) => {
    if (!text.trim() || busy) return;
    setQ('');
    void ask(text);
  };

  return (
    <div className="modal-backdrop nt-ask-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeAsk()}>
      <div className="modal nt-ask" role="dialog" aria-label="Спросить у мозга">
        <div className="nt-ask-head">
          <Brain size={20} className="nt-ask-logo" />
          <h2 className="grow">Спросить у мозга</h2>
          {entries.length > 0 && !busy && (
            <button className="icon-btn" onClick={clearAsk} aria-label="Начать заново" title="Начать заново">
              <Trash2 size={18} />
            </button>
          )}
          <button className="icon-btn" onClick={closeAsk} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="nt-ask-body" ref={scroll}>
          {entries.length === 0 ? (
            <div className="nt-ask-intro">
              <p>Спросите своими словами — ответ соберётся из ваших заметок, карт, задач и целей, со ссылками на них.</p>
              <div className="nt-ask-examples">
                {examples.map((e) => (
                  <button key={e} className="nt-rel-chip nt-ask-example" onClick={() => send(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            entries.map((e) => <Entry key={e.id} entry={e} />)
          )}
        </div>

        <form
          className="nt-ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={input}
            className="nt-ask-input"
            value={q}
            rows={1}
            placeholder={entries.length ? 'Уточните или спросите ещё…' : 'Например: сколько я решил откладывать в подушку?'}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy ? (
            <button type="button" className="nt-ask-send is-stop" onClick={stopAsk} aria-label="Остановить">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="nt-ask-send" disabled={!q.trim()} aria-label="Спросить">
              <ArrowUp size={18} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
