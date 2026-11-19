import { LOCALE, t, tn } from '../i18n/index';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Plus, Sparkles, Upload, Search, Star, Trash2, MoreHorizontal, Lock, Copy, Pencil, RotateCcw, Download, Clock, X, ArrowUpDown, LayoutTemplate, Check, ChevronRight,
} from 'lucide-react';
import type { DocMeta } from '../types';
import { deleteDoc, fillPreviews, listDocs, loadDoc, saveDoc, saveLocked, updateMeta } from '../store/db';
import { createAndOpen, openDoc } from '../actions';
import { TEMPLATES, docFromTemplate } from '../templates';
import { StructureIcon } from '../editor/StructureIcon';
import { askText, askPassword, confirmDialog } from '../ui/dialogs';
import { decryptDoc, encryptDoc } from '../utils/crypto';
import { toast, useApp } from '../store/appStore';
import { pickFile, downloadBlob, safeFilename } from '../io/download';
import { IMPORT_ACCEPT } from '../io/common';
import { uid } from '../utils/tree';
import { useLongPress } from '../ui/gestures';
import { MapThumb } from './MapThumb';
import './home.css';
import { mark } from '../perf';
import { IconTile } from '../ui/icons';
import { InstallAppButton } from '../ui/InstallAppButton';

// импорт/экспорт (xmind, office…) и ИИ — отдельными модулями, только когда нужны
const AICreate = lazy(() => import('./HomeAI'));
const loadIo = () => import('../io/index');

type Tab = 'recent' | 'starred' | 'trash';
type Sort = 'updated' | 'created' | 'title';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'updated', label: t('Недавно изменённые') },
  { id: 'created', label: t('Недавно созданные') },
  { id: 'title', label: t('По названию') },
];
const SORT_KEY = 'sm-home-sort';

/** Меню карты: на телефоне — лист снизу, на компьютере — рядом с кнопкой */
type MenuState = { id: string; x: number; y: number; sheet: boolean } | { id: '__sort'; x: number; y: number; sheet: boolean };

const isPhone = () => window.matchMedia('(pointer: coarse) and (max-width: 760px)').matches;
const topicsLabel = (n: number) => `${n} ${tn(n, 'тема', 'темы', 'тем')}`;

export default function Home() {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [tab, setTab] = useState<Tab>('recent');
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [sort, setSortState] = useState<Sort>(() => {
    try {
      const v = localStorage.getItem(SORT_KEY);
      return v === 'created' || v === 'title' ? v : 'updated';
    } catch {
      return 'updated';
    }
  });
  const setSort = (s: Sort) => {
    setSortState(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      /* приватный режим */
    }
  };

  const docsVersion = useApp((s) => s.docsVersion);
  const refresh = () =>
    listDocs().then((d) => {
      mark('home-docs');
      setDocs(d);
      return d;
    });
  useEffect(() => {
    let alive = true;
    // у старых карт миниатюр ещё нет — построить в фоне и показать
    void refresh().then(async (d) => {
      if ((await fillPreviews(d)) && alive) await refresh();
    });
    return () => {
      alive = false;
    };
  }, [docsVersion]);

  const active = useMemo(() => docs.filter((d) => !d.trashed), [docs]);
  /** «Продолжить»: последняя изменённая карта — крупно сверху */
  const latest = useMemo(
    () => (tab === 'recent' && !q.trim() && active.length > 1 ? active.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a)) : null),
    [active, tab, q],
  );
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const cmp =
      sort === 'title'
        ? (a: DocMeta, b: DocMeta) => (a.title || '').localeCompare(b.title || '', LOCALE)
        : sort === 'created'
          ? (a: DocMeta, b: DocMeta) => (b.createdAt || 0) - (a.createdAt || 0)
          : (a: DocMeta, b: DocMeta) => b.updatedAt - a.updatedAt;
    return docs
      .filter((d) => (tab === 'trash' ? d.trashed : !d.trashed))
      .filter((d) => (tab === 'starred' ? d.starred : true))
      .filter((d) => !ql || d.title.toLowerCase().includes(ql) || d.preview?.k.some((k) => k.t.toLowerCase().includes(ql)))
      .filter((d) => d !== latest)
      .sort(cmp);
  }, [docs, tab, q, sort, latest]);
  const trashCount = docs.length - active.length;

  const doImport = async () => {
    const f = await pickFile(IMPORT_ACCEPT);
    if (!f) return;
    try {
      const doc = await (await loadIo()).importFile(f);
      await createAndOpen(doc);
      toast(t('Импортировано: {name}', { name: doc.title }));
    } catch (e) {
      toast(t('Не удалось импортировать: {error}', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const openMenu = (id: string, anchor: HTMLElement | null) => {
    const sheet = isPhone() || !anchor;
    const r = anchor?.getBoundingClientRect();
    setMenu({ id, sheet, x: r ? Math.min(r.left, window.innerWidth - 240) : 0, y: r ? Math.min(r.bottom + 4, window.innerHeight - 300) : 0 });
  };

  const act = async (id: string, action: string) => {
    setMenu(null);
    const m = docs.find((d) => d.id === id)!;
    switch (action) {
      case 'open':
        return openDoc(id);
      case 'rename': {
        const name = await askText(t('Переименовать'), { value: m.title });
        if (!name) return;
        const d = await loadDoc(id);
        // новое время изменения — иначе синхронизация считает версии равными и название не доходит до других устройств
        if (d && !('locked' in d)) await saveDoc({ ...d, title: name, updatedAt: Date.now() });
        else if (d) {
          // зашифрованная карта: меняем название и внутри документа
          const p = await askPassword(t('Введите пароль карты'), t('Нужен, чтобы переименовать защищённую карту'));
          if (!p) return;
          try {
            const plain = await decryptDoc(d, p);
            await saveLocked(await encryptDoc({ ...plain, title: name, updatedAt: Date.now() }, p), name);
          } catch {
            return toast(t('Неверный пароль'));
          }
        }
        break;
      }
      case 'star':
        await updateMeta(id, { starred: !m.starred });
        toast(m.starred ? t('Убрано из избранного') : t('⭐ В избранном'));
        break;
      case 'dup': {
        const d = await loadDoc(id);
        if (!d || 'locked' in d) return toast(t('Сначала откройте и снимите пароль'));
        await saveDoc({ ...structuredClone(d), id: uid(), title: t('{name} (копия)', { name: d.title }), createdAt: Date.now(), updatedAt: Date.now() });
        toast(t('Копия создана'));
        break;
      }
      case 'export': {
        const d = await loadDoc(id);
        if (!d || 'locked' in d) return toast(t('Зашифрованную карту экспортируйте из редактора'));
        await downloadBlob((await loadIo()).exportNative(d), safeFilename(d.title) + '.supermind');
        break;
      }
      case 'trash':
        await updateMeta(id, { trashed: true, starred: false });
        toast(t('«{name}» в корзине', { name: m.title || t('Без названия') }), {
          label: t('Вернуть'),
          run: () => void updateMeta(id, { trashed: false, starred: m.starred }).then(refresh),
        });
        break;
      case 'restore':
        await updateMeta(id, { trashed: false });
        toast(t('Карта восстановлена'));
        break;
      case 'delete':
        if (await confirmDialog(t('Удалить навсегда?'), t('«{name}» будет удалена без возможности восстановления.', { name: m.title }), { danger: true, okText: t('Удалить') })) await deleteDoc(id);
        break;
    }
    refresh();
  };

  const emptyTrash = async () => {
    const trashed = docs.filter((d) => d.trashed);
    if (!trashed.length) return;
    if (!(await confirmDialog(t('Очистить корзину?'), t('Будет удалено карт: {n}', { n: trashed.length }), { danger: true, okText: t('Очистить') }))) return;
    for (const d of trashed) await deleteDoc(d.id);
    refresh();
  };

  const menuDoc = menu && menu.id !== '__sort' ? docs.find((d) => d.id === menu.id) : undefined;
  const menuItems: { label: string; icon: ReactNode; danger?: boolean; checked?: boolean; run: () => void }[] = !menu
    ? []
    : menu.id === '__sort'
      ? SORTS.map((s) => ({ label: s.label, icon: s.id === sort ? <Check size={16} /> : <span style={{ width: 16 }} />, checked: s.id === sort, run: () => (setSort(s.id), setMenu(null)) }))
      : menuDoc?.trashed
        ? [
            { label: t('Восстановить'), icon: <RotateCcw size={16} />, run: () => act(menu.id, 'restore') },
            { label: t('Удалить навсегда'), icon: <Trash2 size={16} />, danger: true, run: () => act(menu.id, 'delete') },
          ]
        : [
            { label: t('Открыть'), icon: <ChevronRight size={16} />, run: () => act(menu.id, 'open') },
            { label: t('Переименовать'), icon: <Pencil size={16} />, run: () => act(menu.id, 'rename') },
            { label: menuDoc?.starred ? t('Убрать из избранного') : t('В избранное'), icon: <Star size={16} />, run: () => act(menu.id, 'star') },
            { label: t('Дублировать'), icon: <Copy size={16} />, run: () => act(menu.id, 'dup') },
            { label: t('Скачать .supermind'), icon: <Download size={16} />, run: () => act(menu.id, 'export') },
            { label: t('В корзину'), icon: <Trash2 size={16} />, danger: true, run: () => act(menu.id, 'trash') },
          ];

  return (
    <div className="page home-page">
      <div className="page-header">
        <IconTile section="home" size="sm" className="ph-tile" />
        <h1>{t('Мои карты')}</h1>
        <div className="grow" />
        <InstallAppButton className="btn btn-tinted" wrap={(t) => <span className="hide-xs">{t}</span>} />
        <button className="btn btn-primary" onClick={() => createAndOpen(docFromTemplate(TEMPLATES[0]))}><Plus size={16} /> <span className="hide-xs">{t('Новая')}</span></button>
      </div>
      <div className="page-body">
        {/* ----- создать: компактная строка вместо большой ленты шаблонов ----- */}
        <div className={`home-create${active.length === 0 && tab === 'recent' && !q ? ' is-first' : ''}`}>
          <button className="home-chip home-chip-accent" onClick={() => createAndOpen(docFromTemplate(TEMPLATES[0]))}>
            <Plus size={16} /> {t('Пустая карта')}
          </button>
          <button className="home-chip home-chip-ai" onClick={() => setAiOpen(true)}>
            <Sparkles size={16} /> {t('С ИИ')}
          </button>
          <button className="home-chip" onClick={() => setTplOpen(true)}>
            <LayoutTemplate size={16} /> {t('Шаблоны')}
          </button>
          <button className="home-chip" onClick={doImport} title={t('Импорт файла (.xmind, .mm, .md, .opml)')}>
            <Upload size={16} /> {t('Импорт')}
          </button>
        </div>

        {/* телефон: одна строка — вкладки списка и действия (вместо двух рядов кнопок и переключателя) */}
        {!(active.length === 0 && tab === 'recent' && !q) && (
          <div className="home-phone-chips" role="toolbar" aria-label={t('Карты')}>
            <button className={`home-chip${tab === 'recent' ? ' is-on' : ''}`} onClick={() => setTab('recent')} aria-pressed={tab === 'recent'}>
              {t('Все')}
            </button>
            <button className={`home-chip${tab === 'starred' ? ' is-on' : ''}`} onClick={() => setTab('starred')} aria-pressed={tab === 'starred'}>
              <Star size={14} /> {t('Избранные')}
            </button>
            <button className="home-chip home-chip-ai" onClick={() => setAiOpen(true)}>
              <Sparkles size={15} /> {t('С ИИ')}
            </button>
            <button className="home-chip" onClick={() => setTplOpen(true)}>
              <LayoutTemplate size={15} /> {t('Шаблоны')}
            </button>
            <button className="home-chip" onClick={doImport}>
              <Upload size={15} /> {t('Импорт')}
            </button>
            <button className={`home-chip${tab === 'trash' ? ' is-on' : ''}`} onClick={() => setTab('trash')} aria-pressed={tab === 'trash'}>
              <Trash2 size={14} /> {t('Корзина')}{trashCount > 0 ? ` · ${trashCount}` : ''}
            </button>
          </div>
        )}

        {active.length === 0 && tab === 'recent' && !q ? (
          <FirstMap onTemplate={(i) => createAndOpen(docFromTemplate(TEMPLATES[i]))} onAi={() => setAiOpen(true)} />
        ) : (
          <>
            <div className="home-tools">
              <div className="home-search">
                <Search size={15} className="faint" />
                <input placeholder={t('Поиск по картам и темам')} value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
                {q && (
                  <button className="home-search-x" onClick={() => setQ('')} aria-label={t('Очистить поиск')}>
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                className="icon-btn home-sort"
                aria-label={t('Сортировка')}
                title={t('Сортировка')}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ id: '__sort', sheet: isPhone(), x: Math.min(r.right - 230, window.innerWidth - 240), y: r.bottom + 4 });
                }}
              >
                <ArrowUpDown size={18} />
              </button>
            </div>
            <div className="segmented home-tabs">
              <button className={tab === 'recent' ? 'active' : ''} onClick={() => setTab('recent')}><Clock size={13} /> {t('Все')}</button>
              <button className={tab === 'starred' ? 'active' : ''} onClick={() => setTab('starred')}><Star size={13} /> {t('Избранное')}</button>
              <button className={tab === 'trash' ? 'active' : ''} onClick={() => setTab('trash')}>
                <Trash2 size={13} /> {t('Корзина')}{trashCount > 0 ? ` · ${trashCount}` : ''}
              </button>
            </div>

            {latest && (
              <ContinueCard d={latest} onOpen={() => openDoc(latest.id)} onMenu={(el) => openMenu(latest.id, el)} />
            )}

            {tab === 'trash' && shown.length > 0 && (
              <div className="home-trash-bar">
                <span className="grow">{t('Карты в корзине можно восстановить')}</span>
                <button className="btn btn-sm btn-danger" onClick={emptyTrash}>{t('Очистить')}</button>
              </div>
            )}

            {shown.length === 0 && !latest ? (
              <div className="empty">
                <IconTile section="home" size="lg" />
                <div className="bold">{tab === 'trash' ? t('Корзина пуста') : tab === 'starred' ? t('Нет избранных карт') : t('Ничего не найдено')}</div>
                {tab === 'starred' && <div className="small">{t('Удерживайте карту → «В избранное»')}</div>}
              </div>
            ) : (
              <>
                {latest && shown.length > 0 && <h2 className="home-h2 home-all">{t('Все карты')}</h2>}
                <div className="doc-grid">
                  {shown.map((d) => (
                    <DocCard key={d.id} d={d} onOpen={() => (d.trashed ? openMenu(d.id, null) : openDoc(d.id))} onMenu={(el) => openMenu(d.id, el)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {menu &&
        (menu.sheet ? (
          <div className="modal-backdrop dlg-as-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setMenu(null)}>
            <div className="dlg-as" role="menu">
              <div className="dlg-as-group">
                <div className="dlg-as-head">
                  <div className="dlg-as-title">{menu.id === '__sort' ? t('Сортировка') : menuDoc?.title || t('Без названия')}</div>
                </div>
                {menuItems.map((it) => (
                  <button key={it.label} className={`dlg-as-btn${it.danger ? ' danger' : ''}${it.checked ? ' home-as-checked' : ''}`} onClick={it.run}>
                    {it.checked ? '✓ ' : ''}
                    {it.label}
                  </button>
                ))}
              </div>
              <button className="dlg-as-btn dlg-as-cancel" onClick={() => setMenu(null)}>{t('Отмена')}</button>
            </div>
          </div>
        ) : (
          <div className="menu-layer" style={{ position: 'fixed', inset: 0, zIndex: 110 }} onPointerDown={() => setMenu(null)}>
            <div className="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
              {menuItems.map((it, i) => (
                <button key={it.label} style={it.danger ? { color: 'var(--danger)' } : undefined} className={i > 0 && it.danger && menu.id !== '__sort' ? 'menu-danger-sep' : undefined} onClick={it.run}>
                  {it.icon} {it.label}
                </button>
              ))}
            </div>
          </div>
        ))}

      {aiOpen && (
        <Suspense fallback={null}>
          <AICreate onClose={() => setAiOpen(false)} />
        </Suspense>
      )}
      {tplOpen && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setTplOpen(false)}>
          <div className="modal" style={{ width: 'min(760px,100%)' }}>
            <div className="row"><h2 className="grow">{t('Шаблоны')}</h2><button className="icon-btn" onClick={() => setTplOpen(false)} aria-label={t('Закрыть')}><X /></button></div>
            <div className="tpl-grid">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="tpl-card" onClick={() => { setTplOpen(false); createAndOpen(docFromTemplate(t)); }}>
                  <div className="tpl-thumb"><StructureIcon id={t.structure} size={70} /></div>
                  <div className="bold small ellipsis">{t.name}</div>
                  <div className="tiny faint ellipsis">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Карточка карты: касание — открыть, удержание или «⋯» — меню */
function DocCard({ d, onOpen, onMenu }: { d: DocMeta; onOpen: () => void; onMenu: (anchor: HTMLElement | null) => void }) {
  const press = useLongPress(() => onMenu(null));
  return (
    <div
      className={`doc-card${d.trashed ? ' trashed' : ''}`}
      onClick={onOpen}
      {...press}
      role="button"
      tabIndex={0}
      aria-label={t('Открыть карту «{name}»', { name: d.title || t('Без названия') })}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          onMenu(e.currentTarget);
        }
      }}
    >
      <div className="doc-thumb" style={{ ['--acc' as string]: d.accent ?? 'var(--accent)' }}>
        {d.locked ? <MapThumb accent={d.accent ?? 'var(--accent)'} /> : <MapThumb preview={d.preview} accent={d.accent ?? 'var(--accent)'} />}
        {d.locked && <span className="doc-lock"><Lock size={13} /></span>}
        {d.starred && <span className="doc-star"><Star size={13} fill="currentColor" /></span>}
      </div>
      <div className="doc-info">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="bold ellipsis">{d.title || t('Без названия')}</div>
          <div className="tiny faint">{fmtDate(d.updatedAt)}{d.topicCount ? ` · ${topicsLabel(d.topicCount)}` : ''}</div>
        </div>
        <button
          className="icon-btn"
          aria-label={t('Действия с картой')}
          onClick={(e) => {
            e.stopPropagation();
            onMenu(e.currentTarget);
          }}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}

/** «Продолжить»: последняя карта крупно — к ней возвращаются чаще всего */
function ContinueCard({ d, onOpen, onMenu }: { d: DocMeta; onOpen: () => void; onMenu: (anchor: HTMLElement | null) => void }) {
  const press = useLongPress(() => onMenu(null));
  return (
    <div
      className="home-continue"
      onClick={onOpen}
      {...press}
      role="button"
      tabIndex={0}
      aria-label={t('Продолжить: «{name}»', { name: d.title || t('Без названия') })}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{ ['--acc' as string]: d.accent ?? 'var(--accent)' }}
    >
      <div className="home-continue-thumb">
        {d.locked ? <MapThumb accent={d.accent ?? 'var(--accent)'} /> : <MapThumb preview={d.preview} accent={d.accent ?? 'var(--accent)'} big />}
        {d.starred && <span className="doc-star"><Star size={13} fill="currentColor" /></span>}
      </div>
      <div className="home-continue-info">
        <div className="home-continue-eyebrow">{t('Продолжить')}</div>
        <div className="home-continue-title ellipsis">{d.title || t('Без названия')}</div>
        <div className="tiny faint">{t('Изменена {ago}', { ago: fmtAgo(d.updatedAt) })}{d.topicCount ? ` · ${topicsLabel(d.topicCount)}` : ''}</div>
      </div>
      <span className="home-continue-go" aria-hidden>
        <ChevronRight size={20} />
      </span>
    </div>
  );
}

/** Пока нет ни одной карты: крупные шаблоны и ИИ */
function FirstMap({ onTemplate, onAi }: { onTemplate: (i: number) => void; onAi: () => void }) {
  return (
    <section className="home-first">
      <IconTile section="home" size="lg" />
      <h2>{t('Создайте первую карту')}</h2>
      <p>{t('Выберите раскладку — или опишите тему, и ИИ соберёт карту за вас.')}</p>
      <button className="btn ai-grad home-first-ai" onClick={onAi}><Sparkles size={16} /> {t('Создать с ИИ')}</button>
      <div className="tpl-grid">
        {TEMPLATES.slice(0, 6).map((t, i) => (
          <button key={t.id} className="tpl-card" onClick={() => onTemplate(i)}>
            <div className="tpl-thumb"><StructureIcon id={t.structure} size={70} /></div>
            <div className="bold small ellipsis">{t.name}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function fmtDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t('Сегодня, {time}', { time: d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) });
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function fmtAgo(ts: number) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return t('только что');
  if (min < 60) return t('{n} мин назад', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('{n} {hours} назад', { n: h, hours: tn(h, 'час', 'часа', 'часов') });
  return fmtDate(ts).toLowerCase();
}
