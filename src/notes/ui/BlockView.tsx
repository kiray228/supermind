import { memo, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Check, FileText, Lightbulb, Mic, MoreHorizontal } from 'lucide-react';
import type { ID } from '../../types';
import { type Block, type BlockType, fmtDuration } from '../model';
import { hasMarkup, renderInline } from '../inline';
import { AudioPlayer } from './AudioPlayer';

/** Обработчики редактора (стабильный объект) */
export interface BlockCtx {
  register(id: ID, el: HTMLTextAreaElement | null): void;
  onFocus(id: ID): void;
  onText(id: ID, value: string, el: HTMLTextAreaElement): void;
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, b: Block, el: HTMLTextAreaElement): void;
  onPaste(e: ClipboardEvent<HTMLTextAreaElement>, b: Block, el: HTMLTextAreaElement): void;
  toggle(id: ID): void;
  patch(id: ID, p: Partial<Block>, kind?: 'struct' | 'type'): void;
  menu(id: ID, anchor: HTMLElement): void;
  select(id: ID): void;
  transcriptToText(id: ID): void;
  viewImage(src: string): void;
}

const PH: Partial<Record<BlockType, string>> = {
  p: 'Текст или «/» для команд',
  h1: 'Заголовок 1',
  h2: 'Заголовок 2',
  h3: 'Заголовок 3',
  bullet: 'Пункт списка',
  number: 'Пункт списка',
  todo: 'Что сделать?',
  quote: 'Цитата',
  code: 'Код',
  callout: 'Важная мысль',
};

export const FIELD_SIZING = typeof CSS !== 'undefined' && !!CSS.supports?.('field-sizing', 'content');

export function autosize(el: HTMLTextAreaElement | null) {
  if (!el || FIELD_SIZING) return;
  if (el.classList.contains('is-ghost')) {
    el.style.height = '';
    return;
  }
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function Handle({ id, ctx }: { id: ID; ctx: BlockCtx }) {
  return (
    <button className="nt-handle" onPointerDown={(e) => e.preventDefault()} onClick={(e) => ctx.menu(id, e.currentTarget)} aria-label="Действия с блоком">
      <MoreHorizontal size={16} />
    </button>
  );
}

const TextBlock = memo(function TextBlock({ b, num, sole, ctx }: { b: Block; num: number; sole: boolean; ctx: BlockCtx }) {
  const [editing, setEditing] = useState(false);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const text = b.text ?? '';
  const ghost = !editing && b.type !== 'code' && hasMarkup(text);

  useLayoutEffect(() => autosize(ta.current), [text, ghost, b.type]);

  const placeholder = sole ? 'Начните писать…' : editing || /^h[123]$/.test(b.type) ? PH[b.type] : '';

  return (
    <div className={`nt-b nt-b-${b.type}${b.checked ? ' is-checked' : ''}`} data-id={b.id}>
      <Handle id={b.id} ctx={ctx} />
      {b.type === 'bullet' && <span className="nt-mark nt-bullet" />}
      {b.type === 'number' && <span className="nt-mark nt-num">{num}.</span>}
      {b.type === 'todo' && (
        <button className={`nt-mark nt-check${b.checked ? ' on' : ''}`} onPointerDown={(e) => e.preventDefault()} onClick={() => ctx.toggle(b.id)} aria-label={b.checked ? 'Не выполнено' : 'Выполнено'}>
          {b.checked && <Check size={14} strokeWidth={3} />}
        </button>
      )}
      {b.type === 'callout' && (
        <span className="nt-mark nt-callout-ic">
          <Lightbulb size={18} />
        </span>
      )}
      <div className="nt-tb">
        {ghost && <div className="nt-tb-view">{renderInline(text)}</div>}
        <textarea
          ref={(el) => {
            ta.current = el;
            ctx.register(b.id, el);
          }}
          className={`nt-ta${ghost ? ' is-ghost' : ''}`}
          value={text}
          rows={1}
          placeholder={placeholder}
          spellCheck={b.type !== 'code'}
          autoCapitalize={b.type === 'code' ? 'off' : 'sentences'}
          autoCorrect={b.type === 'code' ? 'off' : 'on'}
          enterKeyHint={b.type === 'code' ? 'enter' : 'next'}
          onFocus={() => {
            setEditing(true);
            ctx.onFocus(b.id);
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => ctx.onText(b.id, e.target.value, e.target)}
          onKeyDown={(e) => ctx.onKeyDown(e, b, e.currentTarget)}
          onPaste={(e) => ctx.onPaste(e, b, e.currentTarget)}
        />
      </div>
    </div>
  );
});

const MediaBlock = memo(function MediaBlock({ b, selected, ctx }: { b: Block; selected: boolean; ctx: BlockCtx }) {
  const [showTr, setShowTr] = useState(false);
  if (b.type === 'divider') {
    return (
      <div className={`nt-b nt-b-divider${selected ? ' is-sel' : ''}`} data-id={b.id} onClick={() => ctx.select(b.id)}>
        <Handle id={b.id} ctx={ctx} />
        <hr />
      </div>
    );
  }
  if (b.type === 'image') {
    return (
      <figure className={`nt-b nt-b-image${selected ? ' is-sel' : ''}`} data-id={b.id}>
        <Handle id={b.id} ctx={ctx} />
        {b.src && (
          <img
            src={b.src}
            alt={b.caption ?? ''}
            loading="lazy"
            onClick={() => {
              ctx.select(b.id);
              ctx.viewImage(b.src!);
            }}
          />
        )}
        <input className="nt-caption" value={b.caption ?? ''} placeholder="Подпись" onFocus={() => ctx.select(b.id)} onChange={(e) => ctx.patch(b.id, { caption: e.target.value }, 'type')} />
      </figure>
    );
  }
  // голосовая запись
  return (
    <div className={`nt-b nt-b-audio${selected ? ' is-sel' : ''}`} data-id={b.id} onClick={() => ctx.select(b.id)}>
      <Handle id={b.id} ctx={ctx} />
      <div className="nt-audio-head">
        <Mic size={15} />
        <span className="grow">Голосовая запись</span>
        <span className="faint tiny">{fmtDuration(b.duration ?? 0)}</span>
      </div>
      {b.src ? <AudioPlayer src={b.src} duration={b.duration} /> : <div className="faint small">Запись недоступна</div>}
      {!!b.transcript?.trim() && (
        <div className="nt-transcript">
          <button className="nt-tr-toggle" onClick={() => setShowTr(!showTr)}>
            <FileText size={14} /> {showTr ? 'Скрыть расшифровку' : 'Расшифровка'}
          </button>
          <button className="nt-tr-toggle" onClick={() => ctx.transcriptToText(b.id)}>
            В текст
          </button>
          {showTr && <p>{b.transcript}</p>}
        </div>
      )}
    </div>
  );
});

export function BlockView({ b, num, sole, selected, ctx }: { b: Block; num: number; sole: boolean; selected: boolean; ctx: BlockCtx }) {
  if (b.type === 'divider' || b.type === 'image' || b.type === 'audio') return <MediaBlock b={b} selected={selected} ctx={ctx} />;
  return <TextBlock b={b} num={num} sole={sole} ctx={ctx} />;
}
