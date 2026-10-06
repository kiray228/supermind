import { memo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { Image as ImageIcon, Mic, MoreHorizontal, Pin, SquareCheck, Trash2 } from 'lucide-react';
import type { ID } from '../../types';
import { confirmDialog } from '../../ui/dialogs';
import { type Folder, FOLDER_COLORS, FOLDER_EMOJIS, type NoteMeta, noteDate } from '../model';
import { addFolder, deleteFolder, updateFolder } from '../store';

/** Долгое нажатие (iOS не присылает contextmenu) */
export function useLongPress(onLong: (p: { x: number; y: number }) => void, ms = 480) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    fired,
    handlers: {
      onPointerDown: (e: RPointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        clear();
        timer.current = setTimeout(() => {
          fired.current = true;
          navigator.vibrate?.(10);
          onLong(start.current!);
        }, ms);
      },
      onPointerMove: (e: RPointerEvent) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (e: { preventDefault(): void; clientX: number; clientY: number }) => {
        e.preventDefault();
        clear();
        if (!fired.current) onLong({ x: e.clientX, y: e.clientY });
        fired.current = true;
      },
    },
  };
}

export const NoteCard = memo(function NoteCard({
  n,
  folder,
  onOpen,
  onMenu,
}: {
  n: NoteMeta;
  folder?: Folder;
  onOpen: (id: ID) => void;
  onMenu: (id: ID, anchor: HTMLElement | { x: number; y: number }) => void;
}) {
  const lp = useLongPress((p) => onMenu(n.id, p));
  return (
    <div
      className={`nt-card${n.trashed ? ' is-trashed' : ''}`}
      role="button"
      tabIndex={0}
      {...lp.handlers}
      onClick={() => {
        if (lp.fired.current) return;
        onOpen(n.id);
      }}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(n.id)}
    >
      <div className="nt-card-top">
        <div className={`nt-card-title${n.title ? '' : ' is-empty'}`}>{n.title || 'Без названия'}</div>
        {n.pinned && !n.trashed && <Pin size={14} className="nt-card-pin" />}
        <button
          className="nt-card-more"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onMenu(n.id, e.currentTarget);
          }}
          aria-label="Действия"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      {n.preview && <div className="nt-card-prev">{n.preview}</div>}
      <div className="nt-card-meta">
        <span>{noteDate(n.updatedAt)}</span>
        {folder && (
          <span className="nt-card-folder" style={{ '--fc': folder.color } as CSSProperties}>
            {folder.emoji ? folder.emoji + ' ' : ''}
            {folder.name}
          </span>
        )}
        <span className="grow" />
        {n.hasAudio && <Mic size={14} aria-label="Есть голосовая запись" />}
        {n.hasImage && <ImageIcon size={14} aria-label="Есть изображения" />}
        {!!n.todoTotal && (
          <span className={`nt-card-todo${n.todoDone === n.todoTotal ? ' done' : ''}`}>
            <SquareCheck size={14} /> {n.todoDone ?? 0}/{n.todoTotal}
          </span>
        )}
      </div>
    </div>
  );
});

/** Создание и изменение папки */
export function FolderDialog({ folder, count, onClose, onSaved }: { folder?: Folder; count?: number; onClose: () => void; onSaved?: (id: ID) => void }) {
  const [name, setName] = useState(folder?.name ?? '');
  const [emoji, setEmoji] = useState(folder?.emoji ?? '');
  const [color, setColor] = useState(folder?.color ?? FOLDER_COLORS[0]);

  const save = () => {
    const n = name.trim();
    if (!n) return;
    if (folder) {
      updateFolder(folder.id, { name: n, emoji, color });
      onSaved?.(folder.id);
    } else {
      const f = addFolder(n, emoji || undefined, color);
      if (f) onSaved?.(f.id);
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal nt-folder-modal">
        <h2>{folder ? 'Папка' : 'Новая папка'}</h2>
        <label className="label">Название</label>
        <div className="nt-folder-name">
          <span className="nt-fdot big" style={{ background: color }}>
            {emoji}
          </span>
          <input className="input" autoFocus={!folder} value={name} placeholder="Например, Идеи" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </div>
        <label className="label">Значок</label>
        <div className="nt-emojis">
          <button className={`nt-emoji${!emoji ? ' active' : ''}`} onClick={() => setEmoji('')} aria-label="Без значка">
            <span className="nt-fdot" style={{ background: color }} />
          </button>
          {FOLDER_EMOJIS.map((em) => (
            <button key={em} className={`nt-emoji${emoji === em ? ' active' : ''}`} onClick={() => setEmoji(em)}>
              {em}
            </button>
          ))}
        </div>
        <label className="label">Цвет</label>
        <div className="nt-colors">
          {FOLDER_COLORS.map((c) => (
            <button key={c} className={`nt-swatch${color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        <div className="modal-actions">
          {folder && (
            <button
              className="btn btn-ghost btn-danger"
              style={{ marginRight: 'auto' }}
              onClick={async () => {
                const ok = await confirmDialog(`Удалить папку «${folder.name}»?`, count ? `Заметки (${count}) останутся во «Всех заметках».` : undefined, { danger: true, okText: 'Удалить' });
                if (!ok) return;
                deleteFolder(folder.id);
                onClose();
              }}
            >
              <Trash2 size={16} /> Удалить
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            {folder ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}
