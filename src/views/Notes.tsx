import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, FolderInput, FolderPlus, LayoutGrid, MoreHorizontal, Pencil, Pin, PinOff, Plus, RotateCcw, Search, StickyNote, Trash2, Waypoints, X } from 'lucide-react';
import type { ID } from '../types';
import { confirmDialog } from '../ui/dialogs';
import { isBodyEmpty, type NoteMeta, type NotesSort } from '../notes/model';
import {
  createNote,
  duplicateNote,
  emptyNotesTrash,
  ensureNotes,
  flushNotes,
  moveFolder,
  moveNote,
  openNote,
  purgeNote,
  restoreNote,
  searchNotes,
  sortedFolders,
  togglePin,
  trashNote,
  useNotes,
} from '../notes/store';
import { NoteEditor } from '../notes/ui/NoteEditor';
import { NotesGraph } from '../notes/ui/NotesGraph';
import { useLinks } from '../notes/related';
import { FolderDialog, NoteCard } from '../notes/ui/ListParts';
import { MenuItem, MenuLabel, MenuSep, NtMenu, type MenuAnchor } from '../notes/ui/Menu';
import './notes.css';
import { IconTile } from '../ui/icons';

type Sel = { k: 'all' } | { k: 'pinned' } | { k: 'trash' } | { k: 'folder'; id: ID };
type MenuState = { kind: 'note' | 'move'; id: ID; anchor: MenuAnchor } | { kind: 'page'; anchor: MenuAnchor } | { kind: 'folder'; id: ID; anchor: MenuAnchor } | null;

const TRASH_DAYS = 30;
const NO_IDS = new Set<ID>();
const SORTS: [NotesSort, string][] = [
  ['updated', 'По изменению'],
  ['created', 'По созданию'],
  ['title', 'По названию'],
];

function readLS<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* хранилище недоступно */
  }
}

function sortNotes(list: NoteMeta[], by: NotesSort): NoteMeta[] {
  const s = [...list];
  if (by === 'title') s.sort((a, b) => (a.title || '￿').localeCompare(b.title || '￿', 'ru'));
  else if (by === 'created') s.sort((a, b) => b.createdAt - a.createdAt);
  else s.sort((a, b) => b.updatedAt - a.updatedAt);
  return s;
}

export default function Notes() {
  const data = useNotes((s) => s.data);
  const openId = useNotes((s) => s.openId);
  const [sel, setSelState] = useState<Sel>(() => readLS<Sel>('sm-notes-sel', { k: 'all' }));
  const [sort, setSortState] = useState<NotesSort>(() => readLS<NotesSort>('sm-notes-sort', 'updated'));
  const [query, setQuery] = useState<string | null>(null);
  const [found, setFound] = useState<Set<ID> | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const [folderDlg, setFolderDlg] = useState<{ id?: ID } | null>(null);
  const [mode, setModeState] = useState<'list' | 'graph'>(() => readLS<'list' | 'graph'>('sm-notes-mode', 'list'));
  const [graphSel, setGraphSel] = useState<ID | null>(null);
  const graphFocus = useLinks((s) => s.graphFocus);

  useEffect(() => {
    void ensureNotes().then((d) => {
      // корзина очищается сама через 30 дней
      const old = Date.now() - TRASH_DAYS * 86400000;
      for (const n of d.notes) if (n.trashed && n.trashed < old) purgeNote(n.id);
    });
    return () => {
      // пустая заметка не остаётся, если ушли в другой раздел
      const o = useNotes.getState().openBody;
      if (o && isBodyEmpty(o)) void openNote(null);
      void flushNotes();
    };
  }, []);

  const setSel = (s: Sel) => {
    setSelState(s);
    writeLS('sm-notes-sel', s);
    setDrawer(false);
    setQuery(null);
  };
  const setSort = (s: NotesSort) => (setSortState(s), writeLS('sm-notes-sort', s));
  const setMode = (m: 'list' | 'graph') => {
    setModeState(m);
    writeLS('sm-notes-mode', m);
    setGraphSel(null);
  };

  // «Показать на графе» из заметки: закрыть её и открыть граф (со всеми заметками, если её нет в текущей папке)
  useEffect(() => {
    if (!graphFocus) return;
    const n = useNotes.getState().data?.notes.find((x) => x.id === graphFocus);
    if (n && (sel.k === 'trash' || (sel.k === 'pinned' && !n.pinned) || (sel.k === 'folder' && n.folderId !== sel.id))) setSel({ k: 'all' });
    setMode('graph');
    void openNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphFocus]);

  // папку удалили — назад ко всем заметкам
  useEffect(() => {
    if (data && sel.k === 'folder' && !data.folders.some((f) => f.id === sel.id)) setSel({ k: 'all' });
  }, [data, sel]);

  // поиск с задержкой (тела заметок читаются лениво)
  const q = query?.trim() ?? '';
  useEffect(() => {
    if (!q || !data) {
      setFound(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void searchNotes(
        q,
        data.notes.filter((n) => !n.trashed),
      ).then((r) => alive && setFound(r));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, pinned: 0, trash: 0 };
    for (const n of data?.notes ?? []) {
      if (n.trashed) {
        c.trash++;
        continue;
      }
      c.all++;
      if (n.pinned) c.pinned++;
      if (n.folderId) c['f:' + n.folderId] = (c['f:' + n.folderId] ?? 0) + 1;
    }
    return c;
  }, [data]);

  const open = useCallback((id: ID) => {
    const n = useNotes.getState().data?.notes.find((x) => x.id === id);
    if (!n) return;
    if (n.trashed) {
      const el = document.querySelector<HTMLElement>(`[data-note="${id}"] .nt-card-more`);
      setMenu({ kind: 'note', id, anchor: el ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 } });
      return;
    }
    void openNote(id);
  }, []);
  const onCardMenu = useCallback((id: ID, anchor: MenuAnchor) => setMenu({ kind: 'note', id, anchor }), []);

  if (!data) {
    return (
      <div className="page">
        <div className="page-header">
          <IconTile section="notes" size="sm" className="ph-tile" />
          <h1>Заметки</h1>
        </div>
        <div className="loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  const folders = sortedFolders(data);
  const curFolder = sel.k === 'folder' ? data.folders.find((f) => f.id === sel.id) : undefined;
  const isTrash = sel.k === 'trash' && !q;
  const graphMode = mode === 'graph' && sel.k !== 'trash';
  const title = q ? 'Поиск' : sel.k === 'pinned' ? 'Закреплённые' : sel.k === 'trash' ? 'Корзина' : curFolder ? (curFolder.emoji ? curFolder.emoji + ' ' : '') + curFolder.name : 'Заметки';

  const inSel = (n: NoteMeta) => {
    if (sel.k === 'trash') return !!n.trashed;
    if (n.trashed) return false;
    if (sel.k === 'pinned') return !!n.pinned;
    if (sel.k === 'folder') return n.folderId === sel.id;
    return true;
  };
  const list = sortNotes(
    data.notes.filter((n) => (q ? !n.trashed && !!found?.has(n.id) : inSel(n))),
    sort,
  );
  const groupPinned = !q && (sel.k === 'all' || sel.k === 'folder');
  const pinned = groupPinned ? list.filter((n) => n.pinned) : [];
  const rest = groupPinned ? list.filter((n) => !n.pinned) : list;
  const folderOf = (n: NoteMeta) => (sel.k === 'folder' && !q ? undefined : data.folders.find((f) => f.id === n.folderId));

  const create = () => {
    const m = createNote({ folderId: sel.k === 'folder' ? sel.id : undefined, pinned: sel.k === 'pinned' });
    if (sel.k === 'trash') setSel({ k: 'all' });
    setQuery(null);
    if (m) void openNote(m.id);
  };

  const navItem = (key: string, s: Sel, icon: ReactNode, name: string, count: number, color?: string, extra?: ReactNode) => {
    const on = !q && JSON.stringify(s) === JSON.stringify(sel);
    return (
      <div key={key} className={`nt-nav-item${on ? ' active' : ''}`} style={color ? ({ '--nc': color } as CSSProperties) : undefined}>
        <button className="nt-nav-btn" onClick={() => setSel(s)}>
          <span className="nt-nav-ico">{icon}</span>
          <span className="grow ellipsis">{name}</span>
          {!!count && <span className="nt-nav-count">{count}</span>}
        </button>
        {extra}
      </div>
    );
  };

  const nav = (
    <div className="nt-nav-inner">
      {navItem('all', { k: 'all' }, <StickyNote size={18} />, 'Все заметки', counts.all, 'var(--accent)')}
      {navItem('pinned', { k: 'pinned' }, <Pin size={18} />, 'Закреплённые', counts.pinned, '#f59e0b')}
      <div className="nt-nav-sec">
        <span>Папки</span>
        <button className="icon-btn" onClick={() => setFolderDlg({})} aria-label="Новая папка">
          <Plus />
        </button>
      </div>
      {folders.length === 0 && <div className="nt-nav-hint tiny faint">Раскладывайте заметки по папкам: идеи, учёба, работа…</div>}
      {folders.map((f) =>
        navItem(
          'f:' + f.id,
          { k: 'folder', id: f.id },
          f.emoji ? <span className="nt-emoji-ic">{f.emoji}</span> : <i className="nt-fdot" style={{ background: f.color }} />,
          f.name,
          counts['f:' + f.id] ?? 0,
          f.color,
          <button className="nt-nav-more" onClick={(e) => setMenu({ kind: 'folder', id: f.id, anchor: e.currentTarget })} aria-label="Действия с папкой">
            <MoreHorizontal size={16} />
          </button>,
        ),
      )}
      <div className="nt-nav-sep" />
      {navItem('trash', { k: 'trash' }, <Trash2 size={18} />, 'Корзина', counts.trash, '#94a3b8')}
    </div>
  );

  const cards = (ns: NoteMeta[]) => (
    <div className="nt-grid">
      {ns.map((n) => (
        <div key={n.id} data-note={n.id} className="nt-cell">
          <NoteCard n={n} folder={folderOf(n)} onOpen={open} onMenu={onCardMenu} />
        </div>
      ))}
    </div>
  );

  const menuNote = menu && (menu.kind === 'note' || menu.kind === 'move') ? data.notes.find((n) => n.id === menu.id) : undefined;
  const menuFolder = menu?.kind === 'folder' ? data.folders.find((f) => f.id === menu.id) : undefined;

  return (
    <div className="page nt-page">
      <div className="page-header nt-header">
        <IconTile section="notes" size="sm" className="ph-tile" />
        <button className="nt-title-btn" onClick={() => setDrawer(true)}>
          <h1 className="ellipsis">{title}</h1>
          <ChevronDown size={18} className="nt-mobile-only" />
        </button>
        <div className="grow" />
        {sel.k !== 'trash' && (
          <button className={`icon-btn${mode === 'graph' ? ' active' : ''}`} onClick={() => setMode(mode === 'graph' ? 'list' : 'graph')} aria-label={mode === 'graph' ? 'Показать списком' : 'Граф заметок'} title={mode === 'graph' ? 'Списком' : 'Граф связей'}>
            {mode === 'graph' ? <LayoutGrid /> : <Waypoints />}
          </button>
        )}
        {query !== null ? (
          <div className="nt-search">
            <Search size={16} />
            <input autoFocus value={query} placeholder="Поиск по заметкам" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery(null)} />
            <button className="icon-btn" onClick={() => setQuery(null)} aria-label="Закрыть поиск">
              <X />
            </button>
          </div>
        ) : (
          <button className="icon-btn" onClick={() => setQuery('')} aria-label="Поиск">
            <Search />
          </button>
        )}
        <button className="icon-btn" onClick={(e) => setMenu({ kind: 'page', anchor: e.currentTarget })} aria-label="Ещё">
          <MoreHorizontal />
        </button>
      </div>

      <div className="nt-layout">
        <aside className="nt-nav">{nav}</aside>
        <div className={`nt-main${openId ? ' has-editor' : ''}`}>
          {graphMode && (
            <NotesGraph
              notes={data.notes.filter((n) => (q ? !n.trashed : inSel(n)))}
              folders={data.folders}
              highlight={q ? (found ?? NO_IDS) : null}
              focusId={graphFocus}
              onFocused={() => useLinks.setState({ graphFocus: null })}
              onOpen={(id) => void openNote(id)}
              onSelect={setGraphSel}
            />
          )}
          <div className="page-body nt-list" hidden={graphMode}>
            {isTrash && list.length > 0 && <div className="nt-trash-hint small faint">Заметки в корзине удаляются навсегда через {TRASH_DAYS} дней.</div>}
            {list.length === 0 ? (
              <div className="empty">
                {isTrash ? <Trash2 size={40} /> : q ? <Search size={40} /> : <IconTile section="notes" size="lg" />}
                <div>{isTrash ? 'Корзина пуста' : q ? (found ? 'Ничего не найдено' : 'Ищу…') : sel.k === 'pinned' ? 'Закрепите важные заметки — они будут здесь' : 'Здесь пока нет заметок. Нажмите «+», чтобы создать первую'}</div>
                {!isTrash && !q && (
                  <button className="btn btn-primary" onClick={create}>
                    <Plus size={16} /> Новая заметка
                  </button>
                )}
              </div>
            ) : pinned.length ? (
              <>
                <div className="nt-sec-title">Закреплённые</div>
                {cards(pinned)}
                {rest.length > 0 && <div className="nt-sec-title">Заметки</div>}
                {cards(rest)}
              </>
            ) : (
              cards(rest)
            )}
          </div>
          {openId && <NoteEditor key={openId} onClose={() => void openNote(null)} />}
        </div>
      </div>

      {!openId && !(graphMode && graphSel) && (
        <button className="nt-fab" onClick={create} aria-label="Новая заметка">
          <Plus size={26} />
        </button>
      )}

      {drawer && (
        <div className="modal-backdrop nt-drawer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div className="nt-drawer">{nav}</div>
        </div>
      )}

      {folderDlg && (
        <FolderDialog
          folder={folderDlg.id ? data.folders.find((f) => f.id === folderDlg.id) : undefined}
          count={folderDlg.id ? counts['f:' + folderDlg.id] : 0}
          onClose={() => setFolderDlg(null)}
          onSaved={(id) => !folderDlg.id && setSel({ k: 'folder', id })}
        />
      )}

      {menu?.kind === 'page' && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
          <MenuLabel>Сортировка</MenuLabel>
          {SORTS.map(([k, l]) => (
            <MenuItem key={k} icon={sort === k ? <Check size={17} /> : null} label={l} active={sort === k} onClick={() => setSort(k)} />
          ))}
          <MenuSep />
          <MenuItem icon={<FolderPlus size={17} />} label="Новая папка" onClick={() => setFolderDlg({})} />
          {curFolder && <MenuItem icon={<Pencil size={17} />} label="Изменить папку" onClick={() => setFolderDlg({ id: curFolder.id })} />}
          {sel.k === 'trash' && counts.trash > 0 && (
            <MenuItem
              icon={<Trash2 size={17} />}
              label="Очистить корзину"
              danger
              onClick={async () => {
                if (await confirmDialog('Очистить корзину?', 'Заметки будут удалены навсегда.', { danger: true, okText: 'Очистить' })) emptyNotesTrash();
              }}
            />
          )}
        </NtMenu>
      )}

      {menu?.kind === 'folder' && menuFolder && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
          <MenuItem icon={<Pencil size={17} />} label="Изменить" onClick={() => setFolderDlg({ id: menuFolder.id })} />
          {folders[0]?.id !== menuFolder.id && <MenuItem icon={<ArrowUp size={17} />} label="Выше" onClick={() => moveFolder(menuFolder.id, -1)} />}
          {folders[folders.length - 1]?.id !== menuFolder.id && <MenuItem icon={<ArrowDown size={17} />} label="Ниже" onClick={() => moveFolder(menuFolder.id, 1)} />}
        </NtMenu>
      )}

      {menu?.kind === 'note' && menuNote && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
          {menuNote.trashed ? (
            <>
              <MenuItem icon={<RotateCcw size={17} />} label="Восстановить" onClick={() => restoreNote(menuNote.id)} />
              <MenuItem
                icon={<Trash2 size={17} />}
                label="Удалить навсегда"
                danger
                onClick={async () => {
                  if (await confirmDialog('Удалить заметку навсегда?', 'Это действие нельзя отменить.', { danger: true, okText: 'Удалить' })) purgeNote(menuNote.id);
                }}
              />
            </>
          ) : (
            <>
              <MenuItem icon={menuNote.pinned ? <PinOff size={17} /> : <Pin size={17} />} label={menuNote.pinned ? 'Открепить' : 'Закрепить'} onClick={() => togglePin(menuNote.id)} />
              <MenuItem icon={<FolderInput size={17} />} label="Переместить в папку" onClick={() => setTimeout(() => setMenu({ kind: 'move', id: menuNote.id, anchor: menu.anchor }), 0)} />
              <MenuItem icon={<Copy size={17} />} label="Дублировать" onClick={() => void duplicateNote(menuNote.id)} />
              <MenuItem icon={<Trash2 size={17} />} label="Удалить" danger onClick={() => trashNote(menuNote.id)} />
            </>
          )}
        </NtMenu>
      )}

      {menu?.kind === 'move' && menuNote && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
          <MenuLabel>Переместить в папку</MenuLabel>
          <MenuItem icon={<FolderInput size={17} />} label="Без папки" active={!menuNote.folderId} onClick={() => moveNote(menuNote.id, undefined)} />
          {folders.map((f) => (
            <MenuItem
              key={f.id}
              icon={
                <span className="nt-fdot" style={{ background: f.color }}>
                  {f.emoji}
                </span>
              }
              label={f.name}
              active={menuNote.folderId === f.id}
              onClick={() => moveNote(menuNote.id, f.id)}
            />
          ))}
          <MenuSep />
          <MenuItem icon={<FolderPlus size={17} />} label="Новая папка…" onClick={() => setFolderDlg({})} />
        </NtMenu>
      )}
    </div>
  );
}
