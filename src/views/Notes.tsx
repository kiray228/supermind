import { LOCALE, t } from '../i18n/index';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Brain, Check, ChevronDown, Compass, Copy, CopyCheck, Download, Equal, GraduationCap, Newspaper, NotebookPen, FolderInput, FolderPlus, LayoutGrid, LayoutTemplate, MoreHorizontal, Pencil, Pin, PinOff, Plus, RotateCcw, Search, StickyNote, Trash2, Upload, Waypoints, X } from 'lucide-react';
import type { ID } from '../types';
import { confirmDialog } from '../ui/dialogs';
import { toast } from '../store/appStore';
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
import { BrainAsk } from '../notes/ui/BrainAsk';
import { DuplicatesSheet } from '../notes/ui/DuplicatesSheet';
import { SynonymsSheet } from '../notes/ui/SynonymsSheet';
import { BrainReviewSheet } from '../notes/ui/BrainReviewSheet';
import { TopicDigest } from '../notes/ui/TopicDigest';
import { CardsLayer } from '../notes/ui/CardsLayer';
import { TemplatesLayer } from '../notes/ui/TemplatesSheet';
import { isTemplateNote, listTemplates, openTemplates, templateFolderIds } from '../notes/templates';
import { QuestionCard } from '../notes/ui/QuestionCard';
import { BrainHome } from '../notes/ui/BrainHome';
import { BrainHub } from '../notes/ui/BrainHub';
import { hubSeen, markHubSeen } from '../notes/hub';
import { openCardsReview, todaysCards } from '../notes/cards';
import { collectReview, markReviewSeen, reviewCount, reviewDue } from '../notes/brainReview';
import { openAsk, useAsk } from '../notes/brainAsk';
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
  ['updated', t('По изменению')],
  ['created', t('По созданию')],
  ['title', t('По названию')],
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
  if (by === 'title') s.sort((a, b) => (a.title || '￿').localeCompare(b.title || '￿', LOCALE));
  else if (by === 'created') s.sort((a, b) => b.createdAt - a.createdAt);
  else s.sort((a, b) => b.updatedAt - a.updatedAt);
  return s;
}

/** Импорт из Obsidian: выбрать архив или файлы .md */
async function importObsidianFiles() {
  const { pickFiles } = await import('../io/download');
  const files = await pickFiles('.zip,.md,text/markdown,image/*');
  if (!files.length) return;
  toast('Импортирую заметки…');
  try {
    const m = await import('../notes/obsidianImportRun');
    const r = await m.importObsidian(files);
    const parts = [`Добавлено заметок: ${r.created}`];
    if (r.folders) parts.push(`папок: ${r.folders}`);
    if (r.images) parts.push(`картинок: ${r.images}`);
    if (r.skipped) parts.push(`уже были: ${r.skipped}`);
    toast(parts.join(', '));
  } catch (e) {
    toast(e instanceof Error && e.name === 'ImportError' ? e.message : 'Не удалось импортировать заметки');
  }
}

/** Один раз — приглашение посмотреть, что умеет второй мозг (когда заметок уже несколько) */
function HubNudge({ count, onOpen }: { count: number; onOpen: () => void }) {
  const [hidden, setHidden] = useState(hubSeen);
  if (hidden || count < 3) return null;
  return (
    <div className="nt-rv-nudge">
      <Brain size={18} />
      <span className="grow">{t('Второй мозг: связи, конспекты, карточки, дневник — что он умеет, за минуту')}</span>
      <button className="nt-ai-btn" onClick={onOpen}>
        {t('Посмотреть')}
      </button>
      <button
        className="icon-btn"
        onClick={() => {
          markHubSeen();
          setHidden(true);
        }}
        aria-label={t('Скрыть')}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/** Заметка дня: открыть (создав по шаблону) */
const openDaily = () =>
  import('../notes/daily')
    .then((m) => m.openDailyNote())
    .catch(() => toast(t('Не удалось открыть заметку дня')));

/** Карточки на сегодня — повторить */
function CardsNudge() {
  const cards = useNotes((s) => s.data?.cards);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const n = useMemo(() => todaysCards().length, [cards]);
  if (!n) return null;
  return (
    <div className="nt-rv-nudge">
      <GraduationCap size={18} />
      <span className="grow">{t('Карточек на сегодня: {n}', { n })}</span>
      <button className="nt-ai-btn" onClick={openCardsReview}>
        {t('Повторить')}
      </button>
    </div>
  );
}

/** Раз в неделю — напоминание об обзоре мозга (если есть что посмотреть) */
function ReviewNudge({ onOpen }: { onOpen: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!reviewDue()) return;
    let alive = true;
    // не мешать первому показу списка
    const t = setTimeout(() => {
      void collectReview()
        .then((r) => alive && setN(reviewCount(r)))
        .catch(() => undefined);
    }, 1500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);
  if (!n) return null;
  return (
    <div className="nt-rv-nudge">
      <Compass size={18} />
      <span className="grow">{t('Обзор мозга за неделю: забытые и несвязанные заметки, дубли — поводов заглянуть: {n}', { n })}</span>
      <button
        className="nt-ai-btn"
        onClick={() => {
          setN(0);
          onOpen();
        }}
      >
        {t('Открыть')}
      </button>
      <button
        className="icon-btn"
        onClick={() => {
          markReviewSeen();
          setN(0);
        }}
        aria-label={t('Скрыть до следующей недели')}
      >
        <X size={16} />
      </button>
    </div>
  );
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
  const askOpen = useAsk((s) => s.open);
  const [dupSheet, setDupSheet] = useState(false);
  const [synSheet, setSynSheet] = useState(false);
  const [reviewSheet, setReviewSheet] = useState(false);
  const [hub, setHub] = useState(false);
  // «Второй мозг» из поиска по приложению
  useEffect(() => {
    const open = () => setHub(true);
    window.addEventListener('sm-open-brain-hub', open);
    return () => window.removeEventListener('sm-open-brain-hub', open);
  }, []);

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
    // тот же режим — ничего не сбрасывать (выделение на графе уже могло появиться)
    if (m === mode) return;
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
        () => alive,
      ).then((r) => alive && setFound(r));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, pinned: 0, trash: 0 };
    const tpl = templateFolderIds(data);
    for (const n of data?.notes ?? []) {
      if (n.trashed) {
        c.trash++;
        continue;
      }
      // шаблоны — в своей папке, не во «Всех заметках»
      if (!isTemplateNote(n, tpl)) c.all++;
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
          <h1>{t('Заметки')}</h1>
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
  const title = q ? t('Поиск') : sel.k === 'pinned' ? t('Закреплённые') : sel.k === 'trash' ? t('Корзина') : curFolder ? (curFolder.emoji ? curFolder.emoji + ' ' : '') + curFolder.name : t('Заметки');

  const tplFolders = templateFolderIds(data);
  const inSel = (n: NoteMeta) => {
    if (sel.k === 'trash') return !!n.trashed;
    if (n.trashed) return false;
    if (sel.k === 'all' && isTemplateNote(n, tplFolders)) return false;
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

  const hasTemplates = listTemplates(data).length > 0;
  const fromTemplate = () => {
    if (sel.k === 'trash') setSel({ k: 'all' });
    setQuery(null);
    openTemplates({ folderId: sel.k === 'folder' ? sel.id : undefined });
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
      {navItem('all', { k: 'all' }, <StickyNote size={18} />, t('Все заметки'), counts.all, 'var(--accent)')}
      {navItem('pinned', { k: 'pinned' }, <Pin size={18} />, t('Закреплённые'), counts.pinned, '#f59e0b')}
      <div className="nt-nav-sec">
        <span>{t('Папки')}</span>
        <button className="icon-btn" onClick={() => setFolderDlg({})} aria-label={t('Новая папка')}>
          <Plus />
        </button>
      </div>
      {folders.length === 0 && <div className="nt-nav-hint tiny faint">{t('Раскладывайте заметки по папкам: идеи, учёба, работа…')}</div>}
      {folders.map((f) =>
        navItem(
          'f:' + f.id,
          { k: 'folder', id: f.id },
          f.emoji ? <span className="nt-emoji-ic">{f.emoji}</span> : <i className="nt-fdot" style={{ background: f.color }} />,
          f.name,
          counts['f:' + f.id] ?? 0,
          f.color,
          <button className="nt-nav-more" onClick={(e) => setMenu({ kind: 'folder', id: f.id, anchor: e.currentTarget })} aria-label={t('Действия с папкой')}>
            <MoreHorizontal size={16} />
          </button>,
        ),
      )}
      <div className="nt-nav-sep" />
      {navItem('trash', { k: 'trash' }, <Trash2 size={18} />, t('Корзина'), counts.trash, '#94a3b8')}
    </div>
  );

  // group — свой ключ у «Закреплённых» и остальных: оба списка стоят рядом, а ключ ещё и сбрасывает подгрузку при смене папки, поиска, сортировки
  const cards = (ns: NoteMeta[], group: 'pinned' | 'rest') => (
    <GrowList key={group + '|' + JSON.stringify(sel) + '|' + (q ?? '') + '|' + sort} items={ns} className="nt-grid">
      {(n) => (
        <div key={n.id} data-note={n.id} className="nt-cell">
          <NoteCard n={n} folder={folderOf(n)} onOpen={open} onMenu={onCardMenu} />
        </div>
      )}
    </GrowList>
  );

  const menuNote = menu && (menu.kind === 'note' || menu.kind === 'move') ? data.notes.find((n) => n.id === menu.id) : undefined;
  const menuFolder = menu?.kind === 'folder' ? data.folders.find((f) => f.id === menu.id) : undefined;

  return (
    <div className="page nt-page">
      <div className="page-header nt-header">
        <IconTile section="notes" size="sm" className="ph-tile" />
        <button className="nt-title-btn" onClick={() => setDrawer(true)}>
          <h1 className="ellipsis">
            {/* на телефоне вкладка «Мозг»: все заметки — это «Второй мозг» */}
            {title === t('Заметки') && !curFolder ? (
              <>
                <span className="nt-desk-only">{t('Заметки')}</span>
                <span className="nt-phone-only">{t('Второй мозг')}</span>
              </>
            ) : (
              title
            )}
          </h1>
          <ChevronDown size={18} className="nt-mobile-only" />
        </button>
        <div className="grow" />
        <button className="icon-btn nt-desk-only" onClick={() => void openDaily()} aria-label={t('Заметка дня')} title={t('Заметка дня')}>
          <NotebookPen />
        </button>
        <button className="icon-btn nt-desk-only" onClick={() => openAsk()} aria-label={t('Спросить у мозга')} title={t('Спросить у мозга')}>
          <Brain />
        </button>
        {sel.k !== 'trash' && (
          <button className={`icon-btn${mode === 'graph' ? ' active' : ' nt-desk-only'}`} onClick={() => setMode(mode === 'graph' ? 'list' : 'graph')} aria-label={mode === 'graph' ? t('Показать списком') : t('Граф заметок')} title={mode === 'graph' ? t('Списком') : t('Граф связей')}>
            {mode === 'graph' ? <LayoutGrid /> : <Waypoints />}
          </button>
        )}
        {query !== null ? (
          <div className="nt-search">
            <Search size={16} />
            <input autoFocus value={query} placeholder={t('Поиск по заметкам')} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery(null)} />
            <button className="icon-btn" onClick={() => setQuery(null)} aria-label={t('Закрыть поиск')}>
              <X />
            </button>
          </div>
        ) : (
          <button className="icon-btn" onClick={() => setQuery('')} aria-label={t('Поиск')}>
            <Search />
          </button>
        )}
        <button className="icon-btn" onClick={(e) => setMenu({ kind: 'page', anchor: e.currentTarget })} aria-label={t('Ещё')}>
          <MoreHorizontal />
        </button>
      </div>

      <div className="nt-layout">
        <aside className="nt-nav">{nav}</aside>
        <div className={`nt-main${openId ? ' has-editor' : ''}`}>
          {graphMode && (
            <NotesGraph
              noteScope={q || sel.k === 'all' ? null : new Set(data.notes.filter(inSel).map((n) => n.id))}
              folders={data.folders}
              highlight={q ? (found ?? NO_IDS) : null}
              focusId={graphFocus}
              onFocused={() => useLinks.setState({ graphFocus: null })}
              onSelect={setGraphSel}
            />
          )}
          <div className="page-body nt-list" hidden={graphMode}>
            {/* телефон: верх «Второго мозга» вместо подсказок и значков в шапке */}
            {sel.k === 'all' && !q && <BrainHome onGraph={() => setMode('graph')} onReview={() => setReviewSheet(true)} onDaily={() => void openDaily()} />}
            {sel.k === 'all' && !q && (
              <div className="nt-desk-only">
                <HubNudge count={data.notes.filter((n) => !n.trashed).length} onOpen={() => setHub(true)} />
              </div>
            )}
            {sel.k === 'all' && !q && <QuestionCard />}
            {sel.k === 'all' && !q && (
              <div className="nt-desk-only">
                <CardsNudge />
                <ReviewNudge onOpen={() => setReviewSheet(true)} />
              </div>
            )}
            {isTrash && list.length > 0 && <div className="nt-trash-hint small faint">{t('Заметки в корзине удаляются навсегда через {n} дней.', { n: TRASH_DAYS })}</div>}
            {list.length === 0 ? (
              <div className="empty">
                {isTrash ? <Trash2 size={40} /> : q ? <Search size={40} /> : <IconTile section="notes" size="lg" />}
                <div>{isTrash ? t('Корзина пуста') : q ? (found ? t('Ничего не найдено') : t('Ищу…')) : sel.k === 'pinned' ? t('Закрепите важные заметки — они будут здесь') : t('Здесь пока нет заметок. Нажмите «+», чтобы создать первую')}</div>
                {!isTrash && !q && (
                  <button className="btn btn-primary" onClick={create}>
                    <Plus size={16} /> {t('Новая заметка')}
                  </button>
                )}
              </div>
            ) : pinned.length ? (
              <>
                <div className="nt-sec-title">{t('Закреплённые')}</div>
                {cards(pinned, 'pinned')}
                {rest.length > 0 && <div className="nt-sec-title">{t('Заметки')}</div>}
                {cards(rest, 'rest')}
              </>
            ) : (
              cards(rest, 'rest')
            )}
          </div>
          {openId && <NoteEditor key={openId} onClose={() => void openNote(null)} />}
        </div>
      </div>

      {!openId && !(graphMode && graphSel) && (
        <button className="nt-fab" onClick={create} aria-label={t('Новая заметка')}>
          <Plus size={26} />
        </button>
      )}
      {!openId && !(graphMode && graphSel) && !isTrash && hasTemplates && (
        <button className="nt-fab nt-fab-mini nt-desk-only" onClick={fromTemplate} aria-label={t('Новая заметка по шаблону')} title={t('Новая заметка по шаблону')}>
          <LayoutTemplate size={20} />
        </button>
      )}

      {drawer && (
        <div className="modal-backdrop nt-drawer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div className="nt-drawer">{nav}</div>
        </div>
      )}

      {askOpen && <BrainAsk />}
      {dupSheet && <DuplicatesSheet onClose={() => setDupSheet(false)} />}
      {synSheet && <SynonymsSheet onClose={() => setSynSheet(false)} />}
      {reviewSheet && (
        <BrainReviewSheet
          onClose={() => setReviewSheet(false)}
          onDuplicates={() => {
            setReviewSheet(false);
            setDupSheet(true);
          }}
        />
      )}
      <TopicDigest />
      {hub && (
        <BrainHub
          onClose={() => setHub(false)}
          act={{
            graph: () => setMode('graph'),
            ask: () => openAsk(),
            review: () => setReviewSheet(true),
            synonyms: () => setSynSheet(true),
            duplicates: () => setDupSheet(true),
            importObsidian: () => void importObsidianFiles(),
          }}
        />
      )}
      <CardsLayer />
      <TemplatesLayer />

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
          <MenuLabel>{t('Сортировка')}</MenuLabel>
          {SORTS.map(([k, l]) => (
            <MenuItem key={k} icon={sort === k ? <Check size={17} /> : null} label={l} active={sort === k} onClick={() => setSort(k)} />
          ))}
          <MenuSep />
          <MenuItem icon={<FolderPlus size={17} />} label={t('Новая папка')} onClick={() => setFolderDlg({})} />
          <MenuItem icon={<LayoutTemplate size={17} />} label={t('Шаблоны заметок')} onClick={fromTemplate} />
          <MenuItem icon={<Brain size={17} />} label={t('Второй мозг: что умеет')} onClick={() => setHub(true)} />
          <MenuItem icon={<Newspaper size={17} />} label={t('Статья по ссылке')} onClick={() => void import('../notes/article').then((m) => m.askArticle())} />
          <MenuItem icon={<Compass size={17} />} label={t('Обзор мозга')} onClick={() => setReviewSheet(true)} />
          <MenuItem icon={<GraduationCap size={17} />} label={t('Повторение карточек')} onClick={openCardsReview} />
          <MenuItem icon={<CopyCheck size={17} />} label={t('Найти дубли')} onClick={() => setDupSheet(true)} />
          <MenuItem icon={<Equal size={17} />} label={t('Синонимы')} onClick={() => setSynSheet(true)} />
          <MenuItem
            icon={<Download size={17} />}
            label={t('Экспорт для Obsidian')}
            onClick={() => {
              toast(t('Готовлю архив заметок…'));
              void import('../notes/obsidianExport')
                .then((m) => m.exportObsidianVault())
                .then((n) => toast(t('Сохранено заметок: {n}. Распакуйте архив и откройте папку в Obsidian как хранилище', { n })))
                .catch(() => toast(t('Не удалось сохранить архив')));
            }}
          />
          <MenuItem
            icon={<Upload size={17} />}
            label={t('Импорт из Obsidian')}
            onClick={() => void importObsidianFiles()}
          />
          {curFolder && <MenuItem icon={<Pencil size={17} />} label={t('Изменить папку')} onClick={() => setFolderDlg({ id: curFolder.id })} />}
          {sel.k === 'trash' && counts.trash > 0 && (
            <MenuItem
              icon={<Trash2 size={17} />}
              label={t('Очистить корзину')}
              danger
              onClick={async () => {
                if (await confirmDialog(t('Очистить корзину?'), t('Заметки будут удалены навсегда.'), { danger: true, okText: t('Очистить') })) emptyNotesTrash();
              }}
            />
          )}
        </NtMenu>
      )}

      {menu?.kind === 'folder' && menuFolder && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
          <MenuItem icon={<Pencil size={17} />} label={t('Изменить')} onClick={() => setFolderDlg({ id: menuFolder.id })} />
          {folders[0]?.id !== menuFolder.id && <MenuItem icon={<ArrowUp size={17} />} label={t('Выше')} onClick={() => moveFolder(menuFolder.id, -1)} />}
          {folders[folders.length - 1]?.id !== menuFolder.id && <MenuItem icon={<ArrowDown size={17} />} label={t('Ниже')} onClick={() => moveFolder(menuFolder.id, 1)} />}
        </NtMenu>
      )}

      {menu?.kind === 'note' && menuNote && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
          {menuNote.trashed ? (
            <>
              <MenuItem icon={<RotateCcw size={17} />} label={t('Восстановить')} onClick={() => restoreNote(menuNote.id)} />
              <MenuItem
                icon={<Trash2 size={17} />}
                label={t('Удалить навсегда')}
                danger
                onClick={async () => {
                  if (await confirmDialog(t('Удалить заметку навсегда?'), t('Это действие нельзя отменить.'), { danger: true, okText: t('Удалить') })) purgeNote(menuNote.id);
                }}
              />
            </>
          ) : (
            <>
              <MenuItem icon={menuNote.pinned ? <PinOff size={17} /> : <Pin size={17} />} label={menuNote.pinned ? t('Открепить') : t('Закрепить')} onClick={() => togglePin(menuNote.id)} />
              <MenuItem icon={<FolderInput size={17} />} label={t('Переместить в папку')} onClick={() => setTimeout(() => setMenu({ kind: 'move', id: menuNote.id, anchor: menu.anchor }), 0)} />
              <MenuItem icon={<Copy size={17} />} label={t('Дублировать')} onClick={() => void duplicateNote(menuNote.id)} />
              <MenuItem icon={<Trash2 size={17} />} label={t('Удалить')} danger onClick={() => trashNote(menuNote.id)} />
            </>
          )}
        </NtMenu>
      )}

      {menu?.kind === 'move' && menuNote && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
          <MenuLabel>{t('Переместить в папку')}</MenuLabel>
          <MenuItem icon={<FolderInput size={17} />} label={t('Без папки')} active={!menuNote.folderId} onClick={() => moveNote(menuNote.id, undefined)} />
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
          <MenuItem icon={<FolderPlus size={17} />} label={t('Новая папка…')} onClick={() => setFolderDlg({})} />
        </NtMenu>
      )}
    </div>
  );
}

/**
 * Длинный список по частям: сначала 120 элементов, следующие — когда до конца списка докрутили
 * (тысячи карточек сразу — секунды на слабом телефоне).
 */
const STEP = 120;
function GrowList<T>({ items, className, children }: { items: T[]; className: string; children: (x: T) => ReactNode }) {
  const [cap, setCap] = useState(STEP);
  const end = useRef<HTMLDivElement>(null);
  const more = items.length > cap;
  useEffect(() => {
    const el = end.current;
    if (!el || !more || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setCap((c) => c + STEP), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, cap]);
  return (
    <>
      <div className={className}>{items.slice(0, cap).map(children)}</div>
      {more && (
        <div ref={end} className="nt-grow">
          <button className="btn btn-sm" onClick={() => setCap((c) => c + STEP)}>
            {t('Показать ещё')}
          </button>
        </div>
      )}
    </>
  );
}
