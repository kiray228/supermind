import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, FileText, Mic, Pencil, Plus } from 'lucide-react';
import type { ID } from '../../types';
import { type Block, fmtDuration, type NoteBody } from '../model';
import { renderInline } from '../inline';
import { normTitle } from '../links';
import { embedBlocks, type EmbedRef, parseEmbed, sectionBlocks } from '../embedCore';
import { listNumbers } from './editorOps';
import { loadNoteBody, useNotes } from '../store';
import { findByTitle, openWiki } from './wikiNav';

const INLINE = { onWiki: openWiki, wikiExists: (t: string) => !!findByTitle(t) };

/** Блок встроенной заметки — только для чтения */
function EmbedBlock({ b, num }: { b: Block; num: number }) {
  const text = b.text ?? '';
  if (b.type === 'divider') return <hr className="nt-embed-hr" />;
  if (b.type === 'image') return b.src ? <img className="nt-embed-img" src={b.src} alt={b.caption ?? ''} loading="lazy" /> : null;
  if (b.type === 'audio')
    return (
      <div className="nt-embed-line faint">
        <Mic size={14} /> Голосовая запись {fmtDuration(b.duration ?? 0)}
        {b.transcript?.trim() ? ` — ${b.transcript.trim().slice(0, 160)}` : ''}
      </div>
    );
  // встраивание внутри встраивания — ссылкой (без вложенности: она могла бы зациклиться)
  const inner = b.type === 'p' ? parseEmbed(text) : null;
  if (inner)
    return (
      <div className="nt-embed-line">
        <a
          href="#"
          className="nt-link nt-wiki"
          onClick={(e) => {
            e.preventDefault();
            openWiki(inner.title, inner.section);
          }}
        >
          ↪ {inner.title}
          {inner.section ? ` › ${inner.section}` : ''}
        </a>
      </div>
    );
  if (b.type === 'code') return <pre className="nt-embed-code">{text}</pre>;
  if (!text.trim() && b.type === 'p') return null;
  return (
    <div className={`nt-embed-b nt-b-${b.type}${b.checked ? ' is-checked' : ''}`}>
      {b.type === 'bullet' && <span className="nt-mark nt-bullet" />}
      {b.type === 'number' && <span className="nt-mark nt-num">{num}.</span>}
      {b.type === 'todo' && <span className={`nt-mark nt-embed-check${b.checked ? ' on' : ''}`}>{b.checked ? '✓' : ''}</span>}
      <div className="nt-tb-view">{renderInline(text, 0, INLINE)}</div>
    </div>
  );
}

/** Встроенная заметка (или её раздел): содержимое прямо в тексте, обновляется само */
export function NoteEmbed({ target, selfId, onEdit }: { target: EmbedRef; selfId: ID | null; onEdit: () => void }) {
  const key = normTitle(target.title);
  const id = useNotes((s) => s.data?.notes.find((n) => !n.trashed && normTitle(n.title) === key)?.id);
  const at = useNotes((s) => (id ? s.data?.notes.find((n) => n.id === id)?.updatedAt : undefined));
  const [body, setBody] = useState<{ id: ID; body: NoteBody } | null>(null);

  useEffect(() => {
    if (!id || id === selfId) return;
    let alive = true;
    void loadNoteBody(id).then((b) => alive && setBody({ id, body: b }));
    return () => {
      alive = false;
    };
  }, [id, at, selfId]);

  const shown = useMemo(() => {
    if (!body || body.id !== id) return null;
    const part = target.section ? sectionBlocks(body.body.blocks, target.section) : body.body.blocks;
    return part ? embedBlocks(part) : null;
  }, [body, id, target.section]);
  const nums = useMemo(() => (shown ? listNumbers(shown.blocks) : []), [shown]);

  const other = !id ? findByTitle(target.title) : undefined;
  const head = (
    <div className="nt-embed-head">
      <button className="nt-embed-title" onClick={() => openWiki(target.title, target.section)} title="Открыть заметку">
        <FileText size={14} />
        <span className="ellipsis">
          {target.title}
          {target.section ? ` › ${target.section}` : ''}
        </span>
        <ArrowUpRight size={14} />
      </button>
      <button className="icon-btn nt-embed-edit" onClick={onEdit} aria-label="Изменить встраивание" title="Изменить">
        <Pencil size={14} />
      </button>
    </div>
  );

  let content;
  if (id && id === selfId) content = <div className="nt-embed-note faint">Заметку нельзя встроить в саму себя</div>;
  else if (!id)
    content = other ? (
      <div className="nt-embed-note faint">Встроить можно только заметку — нажмите на название, чтобы открыть</div>
    ) : (
      <div className="nt-embed-note">
        <span className="faint">Такой заметки ещё нет</span>
        <button className="nt-ai-btn" onClick={() => openWiki(target.title)}>
          <Plus size={14} /> Создать
        </button>
      </div>
    );
  else if (!body || body.id !== id) content = <div className="nt-embed-note faint">Загружаю…</div>;
  else if (!shown) content = <div className="nt-embed-note faint">Раздела «{target.section}» в заметке нет</div>;
  else if (!shown.blocks.length) content = <div className="nt-embed-note faint">{target.section ? 'Раздел пуст' : 'Заметка пуста'}</div>;
  else
    content = (
      <>
        {shown.blocks.map((b, i) => (
          <EmbedBlock key={b.id} b={b} num={nums[i]} />
        ))}
        {shown.more > 0 && (
          <button className="nt-embed-more" onClick={() => openWiki(target.title, target.section)}>
            Ещё {shown.more} — открыть заметку
          </button>
        )}
      </>
    );

  return (
    <div className="nt-embed" onPointerDown={(e) => e.stopPropagation()}>
      {head}
      <div className="nt-embed-body">{content}</div>
    </div>
  );
}
