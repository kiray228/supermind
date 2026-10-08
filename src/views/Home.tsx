import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Plus, Sparkles, Upload, Search, Star, Trash2, MoreHorizontal, Lock, Copy, Pencil, RotateCcw, Download, Clock, X,
} from 'lucide-react';
import type { DocMeta } from '../types';
import { deleteDoc, listDocs, loadDoc, saveDoc, saveLocked, updateMeta } from '../store/db';
import { createAndOpen, openDoc } from '../actions';
import { TEMPLATES, docFromTemplate } from '../templates';
import { StructureIcon } from '../editor/StructureIcon';
import { askText, askPassword, confirmDialog } from '../ui/dialogs';
import { decryptDoc, encryptDoc } from '../utils/crypto';
import { toast, useApp } from '../store/appStore';
import { pickFile, downloadBlob, safeFilename } from '../io/download';
import { IMPORT_ACCEPT } from '../io/common';
import { uid } from '../utils/tree';
import './home.css';
import { mark } from '../perf';
import { IconTile } from '../ui/icons';
import { PlusCircle } from '@phosphor-icons/react';

// импорт/экспорт (xmind, office…) и ИИ — отдельными модулями, только когда нужны
const AICreate = lazy(() => import('./HomeAI'));
const loadIo = () => import('../io/index');

type Tab = 'recent' | 'starred' | 'trash';

export default function Home() {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [tab, setTab] = useState<Tab>('recent');
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);

  const docsVersion = useApp((s) => s.docsVersion);
  const refresh = () =>
    listDocs().then((d) => {
      mark('home-docs');
      setDocs(d);
    });
  useEffect(() => {
    refresh();
  }, [docsVersion]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return docs
      .filter((d) => (tab === 'trash' ? d.trashed : !d.trashed))
      .filter((d) => (tab === 'starred' ? d.starred : true))
      .filter((d) => !ql || d.title.toLowerCase().includes(ql))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [docs, tab, q]);

  const doImport = async () => {
    const f = await pickFile(IMPORT_ACCEPT);
    if (!f) return;
    try {
      const doc = await (await loadIo()).importFile(f);
      await createAndOpen(doc);
      toast('Импортировано: ' + doc.title);
    } catch (e) {
      toast('Не удалось импортировать: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const act = async (id: string, action: string) => {
    setMenu(null);
    const m = docs.find((d) => d.id === id)!;
    switch (action) {
      case 'rename': {
        const t = await askText('Переименовать', { value: m.title });
        if (!t) return;
        const d = await loadDoc(id);
        // новое время изменения — иначе синхронизация считает версии равными и название не доходит до других устройств
        if (d && !('locked' in d)) await saveDoc({ ...d, title: t, updatedAt: Date.now() });
        else if (d) {
          // зашифрованная карта: меняем название и внутри документа
          const p = await askPassword('Введите пароль карты', 'Нужен, чтобы переименовать защищённую карту');
          if (!p) return;
          try {
            const plain = await decryptDoc(d, p);
            await saveLocked(await encryptDoc({ ...plain, title: t, updatedAt: Date.now() }, p), t);
          } catch {
            return toast('Неверный пароль');
          }
        }
        break;
      }
      case 'star':
        await updateMeta(id, { starred: !m.starred });
        break;
      case 'dup': {
        const d = await loadDoc(id);
        if (!d || 'locked' in d) return toast('Сначала откройте и снимите пароль');
        await saveDoc({ ...structuredClone(d), id: uid(), title: d.title + ' (копия)', createdAt: Date.now(), updatedAt: Date.now() });
        break;
      }
      case 'export': {
        const d = await loadDoc(id);
        if (!d || 'locked' in d) return toast('Зашифрованную карту экспортируйте из редактора');
        await downloadBlob((await loadIo()).exportNative(d), safeFilename(d.title) + '.supermind');
        break;
      }
      case 'trash':
        await updateMeta(id, { trashed: true, starred: false });
        toast('Перемещено в корзину');
        break;
      case 'restore':
        await updateMeta(id, { trashed: false });
        break;
      case 'delete':
        if (await confirmDialog('Удалить навсегда?', `«${m.title}» будет удалена без возможности восстановления.`, { danger: true, okText: 'Удалить' })) await deleteDoc(id);
        break;
    }
    refresh();
  };

  const emptyTrash = async () => {
    const t = docs.filter((d) => d.trashed);
    if (!t.length) return;
    if (!(await confirmDialog('Очистить корзину?', `Будет удалено карт: ${t.length}`, { danger: true, okText: 'Очистить' }))) return;
    for (const d of t) await deleteDoc(d.id);
    refresh();
  };

  return (
    <div className="page">
      <div className="page-header">
        <IconTile section="home" size="sm" className="ph-tile" />
        <h1>Мои карты</h1>
        <div className="grow" />
        <button className="btn" onClick={doImport} title="Импорт файла (.xmind, .md, .opml)"><Upload size={16} /> <span className="hide-xs">Импорт</span></button>
        <button className="btn ai-grad" onClick={() => setAiOpen(true)}><Sparkles size={16} /> <span className="hide-xs">Создать с ИИ</span></button>
        <button className="btn btn-primary" onClick={() => createAndOpen(docFromTemplate(TEMPLATES[0]))}><Plus size={16} /> <span className="hide-xs">Новая</span></button>
      </div>
      <div className="page-body">
        <section className="home-section">
          <div className="row" style={{ marginBottom: 10 }}>
            <IconTile icon={PlusCircle} tone="accent" size="sm" />
            <h2 className="home-h2">Создать</h2>
            <div className="grow" />
            <button className="btn btn-sm btn-ghost" onClick={() => setTplOpen(true)}>Все шаблоны</button>
          </div>
          <div className="tpl-strip">
            {TEMPLATES.slice(0, 6).map((t) => (
              <button key={t.id} className="tpl-card" onClick={() => createAndOpen(docFromTemplate(t))}>
                <div className="tpl-thumb"><StructureIcon id={t.structure} size={70} /></div>
                <div className="bold small ellipsis">{t.name}</div>
              </button>
            ))}
            <button className="tpl-card" onClick={doImport}>
              <div className="tpl-thumb"><Upload size={30} /></div>
              <div className="bold small">Импорт файла</div>
              <div className="tiny faint">.xmind .md .opml</div>
            </button>
          </div>
        </section>

        <section className="home-section">
          <div className="row home-filters">
            <div className="segmented">
              <button className={tab === 'recent' ? 'active' : ''} onClick={() => setTab('recent')}><Clock size={13} /> Все</button>
              <button className={tab === 'starred' ? 'active' : ''} onClick={() => setTab('starred')}><Star size={13} /> Избранное</button>
              <button className={tab === 'trash' ? 'active' : ''} onClick={() => setTab('trash')}><Trash2 size={13} /> Корзина</button>
            </div>
            <div className="grow" />
            <div className="home-search">
              <Search size={15} className="faint" />
              <input placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {tab === 'trash' && shown.length > 0 && <button className="btn btn-sm btn-danger" onClick={emptyTrash}>Очистить</button>}
          </div>

          {shown.length === 0 ? (
            <div className="empty">
              <IconTile section="home" size="lg" />
              <div className="bold">{tab === 'trash' ? 'Корзина пуста' : tab === 'starred' ? 'Нет избранных карт' : q ? 'Ничего не найдено' : 'Пока нет карт'}</div>
              {tab === 'recent' && !q && <div className="small">Создайте первую карту из шаблона или с помощью ИИ</div>}
            </div>
          ) : (
            <div className="doc-grid">
              {shown.map((d) => (
                <div key={d.id} className="doc-card" onClick={() => (d.trashed ? null : openDoc(d.id))}>
                  <div className="doc-thumb" style={{ ['--acc' as string]: d.accent ?? '#ff4a2b' }}>
                    <svg viewBox="0 0 120 70" className="doc-thumb-svg">
                      <path d="M60 35 C75 35 75 15 92 15 M60 35 H95 M60 35 C75 35 75 55 92 55 M60 35 C45 35 45 15 28 15 M60 35 C45 35 45 55 28 55" stroke="var(--acc)" strokeOpacity=".5" strokeWidth="2" fill="none" />
                      <rect x="44" y="28" width="32" height="14" rx="5" fill="var(--acc)" />
                      {[[92, 10], [95, 30], [92, 50], [8, 10], [8, 50]].map(([x, y], i) => (
                        <rect key={i} x={x} y={y} width="20" height="9" rx="3" fill="var(--acc)" opacity=".25" />
                      ))}
                    </svg>
                    {d.locked && <span className="doc-lock"><Lock size={13} /></span>}
                    {d.starred && <span className="doc-star"><Star size={13} fill="currentColor" /></span>}
                  </div>
                  <div className="doc-info">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="bold ellipsis">{d.title || 'Без названия'}</div>
                      <div className="tiny faint">{fmtDate(d.updatedAt)}{d.topicCount ? ` · ${d.topicCount} тем` : ''}</div>
                    </div>
                    <button
                      className="icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenu({ id: d.id, x: Math.min(r.left, window.innerWidth - 230), y: Math.min(r.bottom, window.innerHeight - 280) });
                      }}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {menu && (
        <div className="menu-layer" style={{ position: 'fixed', inset: 0, zIndex: 110 }} onPointerDown={() => setMenu(null)}>
          <div className="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
            {docs.find((d) => d.id === menu.id)?.trashed ? (
              <>
                <button onClick={() => act(menu.id, 'restore')}><RotateCcw size={16} /> Восстановить</button>
                <button style={{ color: 'var(--danger)' }} onClick={() => act(menu.id, 'delete')}><Trash2 size={16} /> Удалить навсегда</button>
              </>
            ) : (
              <>
                <button onClick={() => act(menu.id, 'rename')}><Pencil size={16} /> Переименовать</button>
                <button onClick={() => act(menu.id, 'star')}><Star size={16} /> {docs.find((d) => d.id === menu.id)?.starred ? 'Убрать из избранного' : 'В избранное'}</button>
                <button onClick={() => act(menu.id, 'dup')}><Copy size={16} /> Дублировать</button>
                <button onClick={() => act(menu.id, 'export')}><Download size={16} /> Скачать .supermind</button>
                <div className="sep" />
                <button style={{ color: 'var(--danger)' }} onClick={() => act(menu.id, 'trash')}><Trash2 size={16} /> В корзину</button>
              </>
            )}
          </div>
        </div>
      )}

      {aiOpen && (
        <Suspense fallback={null}>
          <AICreate onClose={() => setAiOpen(false)} />
        </Suspense>
      )}
      {tplOpen && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setTplOpen(false)}>
          <div className="modal" style={{ width: 'min(760px,100%)' }}>
            <div className="row"><h2 className="grow">Шаблоны</h2><button className="icon-btn" onClick={() => setTplOpen(false)}><X /></button></div>
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

function fmtDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Сегодня, ' + d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
