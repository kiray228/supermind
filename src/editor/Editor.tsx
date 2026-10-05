import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Undo2, Redo2, Sparkles, SlidersHorizontal, Search, MoreHorizontal, Plus, CornerDownRight, Trash2, Spline, SquareDashed,
  Braces, Minus, Maximize, Presentation, Expand, Download, Lock, Unlock, Network, ListTree, CalendarRange, X, ChevronLeft, ChevronRight,
  Keyboard, Copy, Scissors, ClipboardPaste, FilePlus2, Pencil, ChevronsDownUp, ArrowUpFromLine, CopyPlus, StickyNote, Cloud, Check, Palette, ArrowLeftRight,
} from 'lucide-react';
import { useDoc, topicSide } from '../store/docStore';
import { toast } from '../store/appStore';
import { leaveEditor } from '../actions';
import { MapCanvas, type MapCanvasHandle } from './MapCanvas';
import { Inspector, type InspectorTab, STRUCTURES } from './Inspector';
import { AIPanel } from './AIPanel';
import { Outliner } from './Outliner';
import { Gantt } from './Gantt';
import { StructureIcon } from './StructureIcon';
import { askText, confirmDialog, hasOverlay, onBack } from '../ui/dialogs';
import { primeKeyboard } from '../ui/keyboard';
import { findInSheet, walkSheet } from '../utils/tree';
import { subtreeBounds } from '../layout/layout';
import { downloadBlob, downloadText, safeFilename } from '../io/download';
import { sheetToMarkdown } from '../io/markdown';
import { sheetToOpml } from '../io/opml';
import { exportPdf, exportPng, exportSvgBlob } from '../io/exportImage';
import { exportXmind } from '../io/xmind';
import { exportDocx, exportPptx, exportXlsx } from '../io/office';
import { exportNative } from '../io/index';
import { getTheme } from '../themes';
import './editor.css';

type Mode = 'map' | 'outline' | 'gantt';
type Panel = null | 'inspector' | 'ai';

interface Menu {
  x: number;
  y: number;
  items: (MenuItem | 'sep')[];
}
interface MenuItem {
  icon?: React.ReactNode;
  label: string;
  kbd?: string;
  danger?: boolean;
  onClick(): void;
}

const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

export default function Editor() {
  const doc = useDoc((s) => s.doc);
  const sheet = useDoc((s) => s.sheet());
  const selection = useDoc((s) => s.selection);
  const selectedRel = useDoc((s) => s.selectedRel);
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const saving = useDoc((s) => s.saving);
  const password = useDoc((s) => s.password);
  const canvas = useRef<MapCanvasHandle>(null);

  const [mode, setMode] = useState<Mode>('map');
  const [panel, setPanel] = useState<Panel>(() => (isMobile() ? null : 'inspector'));
  const [inspTab, setInspTab] = useState<InspectorTab>('topic');
  const [relMode, setRelMode] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [searchIdx, setSearchIdx] = useState(0);
  const [zen, setZen] = useState(false);
  const [pitch, setPitch] = useState<{ slides: string[]; i: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showKeys, setShowKeys] = useState(false);
  const [isMobileView, setIsMobileView] = useState(isMobile);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const on = () => setIsMobileView(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const st = useDoc.getState();

  // ---------- поиск ----------
  const hits = useMemo(() => {
    if (!sheet || !search?.trim()) return [] as string[];
    const q = search.trim().toLowerCase();
    const out: string[] = [];
    walkSheet(sheet, (t) => {
      if (t.text.toLowerCase().includes(q) || t.note?.toLowerCase().includes(q) || t.labels?.some((l) => l.toLowerCase().includes(q))) out.push(t.id);
    });
    return out;
  }, [sheet, search]);
  const hitSet = useMemo(() => new Set(hits), [hits]);
  const gotoHit = (i: number) => {
    if (!hits.length) return;
    const j = ((i % hits.length) + hits.length) % hits.length;
    setSearchIdx(j);
    st.focusTopic(hits[j]);
  };

  // ---------- презентация ----------
  const startPitch = () => {
    if (!sheet) return;
    const slides = [sheet.root.id];
    for (const c of sheet.root.children) {
      slides.push(c.id);
      for (const g of c.children) if (g.children.length) slides.push(g.id);
    }
    setMode('map');
    setPanel(null);
    setPitch({ slides, i: 0 });
    st.select(null);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const pitchFocus = pitch ? (pitch.i === 0 ? null : pitch.slides[pitch.i]) : null;
  useEffect(() => {
    if (!pitch || !canvas.current) return;
    const lay = canvas.current.layout();
    if (!lay) return;
    const id = pitch.slides[pitch.i];
    const b = pitch.i === 0 ? lay.bounds : subtreeBounds(lay, id);
    if (b) setTimeout(() => canvas.current?.fitBounds(b, true, 2.2), 30);
  }, [pitch]);
  const endPitch = () => {
    setPitch(null);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setTimeout(() => canvas.current?.fit(), 50);
  };

  // ---------- действия ----------
  const selId = selection[selection.length - 1];
  const addChild = () => {
    primeKeyboard();
    if (mode !== 'map') setMode('map');
    st.addChild(selId ?? sheet?.root.id);
  };
  const addSibling = () => {
    primeKeyboard();
    st.addSibling(selId ?? sheet?.root.id);
  };
  const del = () => {
    if (selectedRel) st.removeRelationship(selectedRel);
    else st.deleteTopics();
  };
  const startRel = () => {
    if (!selId) return toast('Сначала выберите тему');
    setRelMode(true);
    toast('Нажмите на тему, с которой нужно связать');
  };
  const onRelTarget = (id: string) => {
    setRelMode(false);
    if (selId && id !== selId) {
      st.addRelationship(selId, id);
      setPanel('inspector');
    }
  };
  const openNote = () => {
    setPanel('inspector');
    setInspTab('topic');
  };

  const exportAs = useCallback(
    async (kind: string) => {
      if (!doc || !sheet) return;
      const name = safeFilename(doc.title || 'Карта');
      const bg = sheet.background ?? getTheme(sheet.themeId).background;
      const svg = () => {
        const el = canvas.current?.svg();
        if (!el) throw new Error('Переключитесь в режим карты');
        return el;
      };
      try {
        if (mode !== 'map' && ['png', 'svg', 'pdf'].includes(kind)) {
          setMode('map');
          await new Promise((r) => setTimeout(r, 120));
        }
        toast('Экспорт…');
        switch (kind) {
          case 'png': await downloadBlob(await exportPng(svg(), bg, 2), name + '.png'); break;
          case 'svg': await downloadBlob(exportSvgBlob(svg(), bg), name + '.svg'); break;
          case 'pdf': await downloadBlob(await exportPdf(svg(), bg, doc.title), name + '.pdf'); break;
          case 'md': await downloadText(sheetToMarkdown(sheet), name + '.md', 'text/markdown'); break;
          case 'opml': await downloadText(sheetToOpml(sheet, doc.title), name + '.opml', 'text/x-opml'); break;
          case 'xmind': await downloadBlob(await exportXmind(doc), name + '.xmind'); break;
          case 'docx': await downloadBlob(await exportDocx(doc), name + '.docx'); break;
          case 'xlsx': await downloadBlob(await exportXlsx(doc), name + '.xlsx'); break;
          case 'pptx': await downloadBlob(await exportPptx(doc), name + '.pptx'); break;
          case 'native': await downloadBlob(exportNative(doc), name + '.supermind'); break;
        }
      } catch (e) {
        toast('Ошибка экспорта: ' + (e instanceof Error ? e.message : String(e)));
      }
    },
    [doc, sheet, mode],
  );

  const togglePassword = async () => {
    if (password) {
      if (await confirmDialog('Снять пароль?', 'Документ будет храниться без шифрования.')) {
        st.setPassword(null);
        toast('Пароль снят');
      }
      return;
    }
    const p = await askText('Защитить паролем', { message: 'Карта будет зашифрована (AES-256). Если забудете пароль — восстановить её не получится.', placeholder: 'Пароль' });
    if (!p) return;
    const p2 = await askText('Повторите пароль', { placeholder: 'Пароль ещё раз' });
    if (p !== p2) return toast('Пароли не совпадают');
    st.setPassword(p);
    toast('Карта зашифрована 🔒');
  };

  const openMoreMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.right - 240,
      y: r.bottom + 6,
      items: [
        { icon: <Presentation size={16} />, label: 'Презентация (Pitch)', onClick: startPitch },
        { icon: <Expand size={16} />, label: 'Режим Zen', kbd: 'Ctrl+E', onClick: () => setZen(true) },
        'sep',
        { icon: <Download size={16} />, label: 'PNG (изображение)', onClick: () => exportAs('png') },
        { icon: <Download size={16} />, label: 'PDF', onClick: () => exportAs('pdf') },
        { icon: <Download size={16} />, label: 'SVG', onClick: () => exportAs('svg') },
        { icon: <Download size={16} />, label: 'Xmind (.xmind)', onClick: () => exportAs('xmind') },
        { icon: <Download size={16} />, label: 'Word (.docx)', onClick: () => exportAs('docx') },
        { icon: <Download size={16} />, label: 'Excel (.xlsx)', onClick: () => exportAs('xlsx') },
        { icon: <Download size={16} />, label: 'PowerPoint (.pptx)', onClick: () => exportAs('pptx') },
        { icon: <Download size={16} />, label: 'Markdown', onClick: () => exportAs('md') },
        { icon: <Download size={16} />, label: 'OPML', onClick: () => exportAs('opml') },
        { icon: <Download size={16} />, label: 'Файл SuperMind (резервная копия)', onClick: () => exportAs('native') },
        'sep',
        { icon: password ? <Unlock size={16} /> : <Lock size={16} />, label: password ? 'Снять пароль' : 'Защитить паролем', onClick: togglePassword },
        { icon: <Keyboard size={16} />, label: 'Горячие клавиши', onClick: () => setShowKeys(true) },
      ],
    });
  };

  const topicMenu = (x: number, y: number, topicId: string | null, wx: number, wy: number) => {
    if (!sheet) return;
    if (!topicId) {
      setMenu({
        x, y,
        items: [
          { icon: <Plus size={16} />, label: 'Плавающая тема', onClick: () => st.addFloating(wx, wy) },
          { icon: <ClipboardPaste size={16} />, label: 'Вставить в центральную', kbd: 'Ctrl+V', onClick: () => st.paste(sheet.root.id) },
          'sep',
          { icon: <Maximize size={16} />, label: 'Вписать в экран', kbd: 'Ctrl+0', onClick: () => canvas.current?.fit() },
          { icon: <ChevronsDownUp size={16} />, label: 'Свернуть все ветви', onClick: () => st.collapseAll(true, 1) },
          { icon: <Expand size={16} />, label: 'Развернуть всё', onClick: () => st.collapseAll(false) },
        ],
      });
      return;
    }
    const f = findInSheet(sheet, topicId);
    const isRoot = topicId === sheet.root.id;
    setMenu({
      x, y,
      items: [
        { icon: <Pencil size={16} />, label: 'Редактировать', kbd: 'F2', onClick: () => { primeKeyboard(); st.setEditing(topicId); } },
        { icon: <CornerDownRight size={16} />, label: 'Подтема', kbd: 'Tab', onClick: () => { primeKeyboard(); st.addChild(topicId); } },
        ...(!isRoot && f?.parent ? [
          { icon: <Plus size={16} />, label: 'Тема рядом', kbd: 'Enter', onClick: () => { primeKeyboard(); st.addSibling(topicId); } },
          { icon: <ArrowUpFromLine size={16} />, label: 'Родительская тема', kbd: 'Ctrl+Enter', onClick: () => st.addParent(topicId) },
        ] : []),
        'sep',
        ...(f?.parent?.id === sheet.root.id && sheet.structure === 'map'
          ? [{ icon: <ArrowLeftRight size={16} />, label: topicSide(sheet, topicId) === 'left' ? 'Перенести направо' : 'Перенести налево', onClick: () => st.setSide(topicId, topicSide(sheet, topicId) === 'left' ? 'right' : 'left') }]
          : []),
        { icon: <Spline size={16} />, label: 'Связь', onClick: startRel },
        { icon: <SquareDashed size={16} />, label: 'Граница', onClick: () => st.addBoundary(topicId) },
        { icon: <Braces size={16} />, label: 'Итог', onClick: () => st.addSummary(topicId) },
        { icon: <StickyNote size={16} />, label: 'Заметка / задача / маркеры', onClick: openNote },
        { icon: <Sparkles size={16} />, label: 'ИИ: идеи для темы', onClick: () => setPanel('ai') },
        'sep',
        { icon: <Copy size={16} />, label: 'Копировать', kbd: 'Ctrl+C', onClick: () => st.copy() },
        ...(!isRoot ? [{ icon: <Scissors size={16} />, label: 'Вырезать', kbd: 'Ctrl+X', onClick: () => st.copy(true) }] : []),
        { icon: <ClipboardPaste size={16} />, label: 'Вставить', kbd: 'Ctrl+V', onClick: () => st.paste(topicId) },
        ...(!isRoot && f?.parent ? [{ icon: <CopyPlus size={16} />, label: 'Дублировать', kbd: 'Ctrl+D', onClick: () => st.duplicate(topicId) }] : []),
        ...(f?.topic.children.length ? [{ icon: <ChevronsDownUp size={16} />, label: f.topic.collapsed ? 'Развернуть' : 'Свернуть', kbd: 'Ctrl+/', onClick: () => st.toggleCollapse(topicId) }] : []),
        ...(!isRoot ? ['sep' as const, { icon: <Trash2 size={16} />, label: 'Удалить', kbd: 'Del', danger: true, onClick: () => st.deleteTopics([topicId]) }] : []),
      ],
    });
  };

  // при смене режима не оставлять «висящее» редактирование из «Структуры»
  useEffect(() => {
    useDoc.setState({ editingId: null, pendingText: null });
  }, [mode]);

  // «Назад» на Android: закрыть режимы и панели, прежде чем выйти из карты
  const backState = useRef({ pitch, zen, search, panel, relMode, mode });
  backState.current = { pitch, zen, search, panel, relMode, mode };
  useEffect(
    () =>
      onBack(() => {
        const b = backState.current;
        const s = useDoc.getState();
        if (b.pitch) { endPitch(); return true; }
        if (s.editingId) { s.setEditing(null); return true; }
        if (b.relMode) { setRelMode(false); return true; }
        if (b.zen) { setZen(false); return true; }
        if (b.search !== null) { setSearch(null); return true; }
        if (b.panel) { setPanel(null); return true; }
        if (b.mode !== 'map') { setMode('map'); return true; }
        return false;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---------- горячие клавиши ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('input, textarea, select, [contenteditable=true]')) return;
      if (hasOverlay()) return;
      const s = useDoc.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (pitch) {
        if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') setPitch((p) => (p && p.i < p.slides.length - 1 ? { ...p, i: p.i + 1 } : p));
        else if (k === 'ArrowLeft' || k === 'PageUp') setPitch((p) => (p && p.i > 0 ? { ...p, i: p.i - 1 } : p));
        else if (k === 'Escape') endPitch();
        e.preventDefault();
        return;
      }
      if (mod && k.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && k.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && k.toLowerCase() === 'f') { e.preventDefault(); setSearch(''); return; }
      if (mod && k.toLowerCase() === 'e') { e.preventDefault(); setZen((z) => !z); return; }
      if (mod && k === '0') { e.preventDefault(); canvas.current?.fit(); return; }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); canvas.current?.zoomBy(1.2); return; }
      if (mod && k === '-') { e.preventDefault(); canvas.current?.zoomBy(1 / 1.2); return; }
      if (k === 'Escape') {
        if (relMode) setRelMode(false);
        else if (zen) setZen(false);
        else s.select(null);
        return;
      }
      if (mode !== 'map') return;
      const sel = s.selection[s.selection.length - 1];
      if (mod && k.toLowerCase() === 'c') { s.copy(); return; }
      if (mod && k.toLowerCase() === 'x') { s.copy(true); return; }
      if (mod && k.toLowerCase() === 'd') { e.preventDefault(); s.duplicate(); return; }
      if (mod && k.toLowerCase() === 'a') { e.preventDefault(); const ids: string[] = []; walkSheet(s.sheet()!, (t) => void ids.push(t.id)); s.select(ids); return; }
      if (mod && k.toLowerCase() === 'b' && s.selection.length) {
        e.preventDefault();
        const t = findInSheet(s.sheet()!, sel)?.topic;
        s.updateStyle(s.selection, { bold: t?.style?.bold ? undefined : true });
        return;
      }
      if (mod && k.toLowerCase() === 'i' && s.selection.length) {
        e.preventDefault();
        const t = findInSheet(s.sheet()!, sel)?.topic;
        s.updateStyle(s.selection, { italic: t?.style?.italic ? undefined : true });
        return;
      }
      if (mod && k === '/') { e.preventDefault(); if (sel) s.toggleCollapse(sel); return; }
      if (mod && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); if (sel) s.reorder(sel, k === 'ArrowUp' ? -1 : 1); return; }
      if (!sel && s.selectedRel && (k === 'Delete' || k === 'Backspace')) { s.removeRelationship(s.selectedRel); return; }
      if (!sel) return;
      switch (k) {
        case 'Tab': e.preventDefault(); s.addChild(sel); return;
        case 'Insert': e.preventDefault(); s.addChild(sel); return;
        case 'Enter':
          e.preventDefault();
          if (mod) s.addParent(sel);
          else s.addSibling(sel, e.shiftKey);
          return;
        case 'Delete':
        case 'Backspace': e.preventDefault(); s.deleteTopics(); return;
        case 'F2':
        case ' ': e.preventDefault(); s.setEditing(sel); return;
        case 'ArrowUp': e.preventDefault(); s.navigate('up'); return;
        case 'ArrowDown': e.preventDefault(); s.navigate('down'); return;
        case 'ArrowLeft': e.preventDefault(); s.navigate('left'); return;
        case 'ArrowRight': e.preventDefault(); s.navigate('right'); return;
      }
      // начать печатать — сразу редактирование
      if (k.length === 1 && !mod && !e.altKey) {
        e.preventDefault();
        useDoc.setState({ pendingText: k, editingId: sel });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pitch, relMode, zen]);

  // вставка текста/картинок из буфера
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('input, textarea, [contenteditable=true]') || mode !== 'map') return;
      const s = useDoc.getState();
      const sel = s.selection[s.selection.length - 1];
      if (!sel) return;
      const img = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (img) {
        const f = img.getAsFile();
        if (f) {
          e.preventDefault();
          import('./Inspector').then(async ({ resizeImage }) => {
            const src = await resizeImage(f, 640);
            const im = new Image();
            im.onload = () => s.updateTopic(sel, { image: { src, w: im.naturalWidth, h: im.naturalHeight } });
            im.src = src;
          });
        }
        return;
      }
      const text = e.clipboardData?.getData('text/plain');
      // свои скопированные темы (со стилями, заметками) — если в буфере их же текст
      if (s.clipboard && (!text || text.trim() === (s.clipboardText ?? '').trim())) {
        e.preventDefault();
        s.paste(sel);
        return;
      }
      if (text?.trim()) {
        e.preventDefault();
        import('../io/markdown').then(({ textToTopics }) => s.insertChildren(sel, textToTopics(text)));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [mode]);

  if (!doc || !sheet) return null;
  const hasSel = selection.length > 0;
  const showChrome = !zen && !pitch;

  return (
    <div className={`editor ${zen ? 'zen' : ''} ${showChrome && panel ? 'panel-open' : ''}`}>
      {showChrome && (
        <header className="ed-top glass">
          <button className="icon-btn" onClick={() => leaveEditor('home')} title="К списку карт">
            <ArrowLeft />
          </button>
          <input
            className="ed-title"
            defaultValue={doc.title}
            key={doc.id + doc.title}
            onBlur={(e) => e.target.value.trim() && e.target.value !== doc.title && st.setTitle(e.target.value.trim())}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className="ed-save" title={saving ? 'Сохранение…' : 'Сохранено на устройстве'}>
            {password && <Lock size={13} />}
            {saving ? <Cloud size={15} className="faint" /> : <Check size={15} className="faint" />}
          </span>
          <div className="grow" />
          <div className="segmented ed-modes">
            <button className={mode === 'map' ? 'active' : ''} onClick={() => setMode('map')} title="Карта"><Network size={15} /><span>Карта</span></button>
            <button className={mode === 'outline' ? 'active' : ''} onClick={() => setMode('outline')} title="Структура"><ListTree size={15} /><span>Структура</span></button>
            <button className={mode === 'gantt' ? 'active' : ''} onClick={() => setMode('gantt')} title="Гант"><CalendarRange size={15} /><span>Гант</span></button>
          </div>
          <div className="grow hide-mobile" />
          <button className="icon-btn hide-mobile" onClick={() => st.undo()} disabled={!canUndo} title="Отменить (Ctrl+Z)"><Undo2 /></button>
          <button className="icon-btn hide-mobile" onClick={() => st.redo()} disabled={!canRedo} title="Повторить (Ctrl+Shift+Z)"><Redo2 /></button>
          <button className={`icon-btn ${search !== null ? 'active' : ''}`} onClick={() => setSearch(search === null ? '' : null)} title="Поиск (Ctrl+F)"><Search /></button>
          <button className={`icon-btn ai-btn ${panel === 'ai' ? 'active' : ''}`} onClick={() => setPanel(panel === 'ai' ? null : 'ai')} title="ИИ"><Sparkles /></button>
          <button className={`icon-btn ${panel === 'inspector' ? 'active' : ''}`} onClick={() => setPanel(panel === 'inspector' ? null : 'inspector')} title="Формат"><SlidersHorizontal /></button>
          <button className="icon-btn" onClick={openMoreMenu} title="Ещё"><MoreHorizontal /></button>
        </header>
      )}

      {search !== null && showChrome && (
        <div className="ed-search glass">
          <Search size={16} className="faint" />
          <input
            autoFocus
            className="grow"
            placeholder="Найти в карте…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSearchIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') gotoHit(searchIdx + (e.shiftKey ? -1 : hits.length ? 1 : 0));
              if (e.key === 'Escape') setSearch(null);
            }}
          />
          <span className="tiny muted">{hits.length ? `${searchIdx + 1}/${hits.length}` : search ? '0' : ''}</span>
          <button className="icon-btn" onClick={() => gotoHit(searchIdx - 1)}><ChevronLeft size={18} /></button>
          <button className="icon-btn" onClick={() => gotoHit(searchIdx + 1)}><ChevronRight size={18} /></button>
          <button className="icon-btn" onClick={() => setSearch(null)}><X size={18} /></button>
        </div>
      )}

      <div className={`ed-main ${showChrome && panel ? 'sheet-open' : ''}`}>
        <div className="ed-stage">
          {mode === 'map' && (
            <MapCanvas
              ref={canvas}
              sheet={sheet}
              relMode={relMode}
              onRelTarget={onRelTarget}
              onContextMenu={({ x, y, topicId, worldX, worldY }) => !pitch && topicMenu(x, y, topicId, worldX, worldY)}
              onOpenNote={openNote}
              onOpenLink={(u) => window.open(u, '_blank', 'noopener')}
              pitchFocus={pitchFocus}
              readOnly={!!pitch}
              searchHits={hitSet}
              onViewChange={(v) => setZoom(v.k)}
            />
          )}
          {mode === 'outline' && <Outliner />}
          {mode === 'gantt' && <Gantt />}

          {mode === 'map' && showChrome && (
            <div className="ed-toolbar glass">
              {hasSel || selectedRel || !isMobileView ? (
                <>
                  <button className="tb-btn" onClick={addChild} title="Подтема (Tab)"><CornerDownRight /><span>Подтема</span></button>
                  <button className="tb-btn" onClick={addSibling} disabled={!hasSel} title="Тема рядом (Enter)"><Plus /><span>Рядом</span></button>
                  <button className="tb-btn" onClick={() => { if (!selId) return; primeKeyboard(); st.setEditing(selId); }} disabled={!hasSel} title="Изменить текст (F2)"><Pencil /><span>Текст</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('style'); setPanel('inspector'); }} disabled={!hasSel} title="Стиль темы: форма, цвет, шрифт"><Palette /><span>Стиль</span></button>
                  <button className={`tb-btn ${relMode ? 'active' : ''}`} onClick={() => (relMode ? setRelMode(false) : startRel())} title="Связь"><Spline /><span>Связь</span></button>
                  <button className="tb-btn hide-xs" onClick={() => st.addBoundary()} disabled={!hasSel} title="Граница"><SquareDashed /><span>Граница</span></button>
                  <button className="tb-btn hide-xs" onClick={() => st.addSummary()} disabled={!hasSel} title="Итог"><Braces /><span>Итог</span></button>
                  <button className="tb-btn" onClick={del} disabled={!selection.some((id) => id !== sheet.root.id) && !selectedRel} title="Удалить (Del)"><Trash2 /><span>Удалить</span></button>
                </>
              ) : (
                <>
                  <button className="tb-btn" onClick={addChild} title="Новая основная тема"><Plus /><span>Тема</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('map'); setPanel('inspector'); }} title="Структура, тема оформления, формы"><Palette /><span>Оформл.</span></button>
                  <button className="tb-btn" onClick={() => st.redo()} disabled={!canRedo}><Redo2 /><span>Повтор</span></button>
                </>
              )}
              <span className="tb-sep hide-mobile" />
              <button className="tb-btn show-mobile" onClick={() => st.undo()} disabled={!canUndo}><Undo2 /><span>Отмена</span></button>
              <button className="tb-btn hide-mobile" onClick={() => canvas.current?.zoomBy(1 / 1.2)} title="Уменьшить"><Minus /></button>
              <button className="tb-zoom hide-mobile" onClick={() => canvas.current?.setZoom(1)} title="100%">{Math.round(zoom * 100)}%</button>
              <button className="tb-btn hide-mobile" onClick={() => canvas.current?.zoomBy(1.2)} title="Увеличить"><Plus /></button>
              <button className={`tb-btn ${hasSel && isMobileView ? 'hide-xs' : ''}`} onClick={() => canvas.current?.fit()} title="Вписать (Ctrl+0)"><Maximize /><span className="show-mobile-inline">Вписать</span></button>
            </div>
          )}

          {showChrome && (
            <div className="ed-sheets">
              {doc.sheets.map((s) => (
                <button
                  key={s.id}
                  className={`sheet-tab ${s.id === sheet.id ? 'active' : ''}`}
                  onClick={() => st.setActiveSheet(s.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      x: e.clientX, y: e.clientY - 150,
                      items: [
                        { icon: <Pencil size={16} />, label: 'Переименовать', onClick: async () => { const t = await askText('Название листа', { value: s.title }); if (t) { st.setActiveSheet(s.id); st.setSheetProps({ title: t }); } } },
                        { icon: <CopyPlus size={16} />, label: 'Дублировать', onClick: () => st.duplicateSheet(s.id) },
                        ...(doc.sheets.length > 1 ? [{ icon: <Trash2 size={16} />, label: 'Удалить лист', danger: true, onClick: async () => { if (await confirmDialog('Удалить лист?', s.title, { danger: true, okText: 'Удалить' })) st.removeSheet(s.id); } }] : []),
                      ],
                    });
                  }}
                  onDoubleClick={async () => {
                    const t = await askText('Название листа', { value: s.title });
                    if (t) st.setSheetProps({ title: t });
                  }}
                >
                  <StructureIcon id={s.structure} size={22} />
                  {s.title}
                </button>
              ))}
              <button className="sheet-tab add" onClick={() => st.addSheet()} title="Новый лист"><FilePlus2 size={15} /></button>
            </div>
          )}

          {zen && !pitch && (
            <button className="zen-exit glass" onClick={() => setZen(false)}>
              <X size={16} /> Выйти из Zen
            </button>
          )}

          {pitch && (
            <div className="pitch-bar glass">
              <button className="icon-btn" onClick={() => setPitch((p) => (p && p.i > 0 ? { ...p, i: p.i - 1 } : p))} disabled={pitch.i === 0}><ChevronLeft /></button>
              <span className="small bold">{pitch.i + 1} / {pitch.slides.length}</span>
              <button className="icon-btn" onClick={() => setPitch((p) => (p && p.i < p.slides.length - 1 ? { ...p, i: p.i + 1 } : p))} disabled={pitch.i >= pitch.slides.length - 1}><ChevronRight /></button>
              <button className="icon-btn" onClick={endPitch}><X /></button>
            </div>
          )}
          {pitch && (
            <div
              className="pitch-tap"
              onClick={(e) => {
                const left = e.clientX < window.innerWidth / 3;
                setPitch((p) => (!p ? p : left ? (p.i > 0 ? { ...p, i: p.i - 1 } : p) : p.i < p.slides.length - 1 ? { ...p, i: p.i + 1 } : p));
              }}
            />
          )}
        </div>

        {showChrome && panel === 'inspector' && (
          <div className="ed-panel">
            <Inspector tab={inspTab} setTab={setInspTab} onClose={() => setPanel(null)} />
          </div>
        )}
        {showChrome && panel === 'ai' && (
          <div className="ed-panel">
            <AIPanel onClose={() => setPanel(null)} />
          </div>
        )}
      </div>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {showKeys && <KeysHelp onClose={() => setShowKeys(false)} />}
    </div>
  );
}

function ContextMenu({ menu, onClose }: { menu: Menu; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  useEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
  }, [menu]);
  return (
    <div className="menu-layer" onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y, maxHeight: 'calc(100vh - 16px)', overflow: 'auto' }} onPointerDown={(e) => e.stopPropagation()}>
        {menu.items.map((it, i) =>
          it === 'sep' ? (
            <div key={i} className="sep" />
          ) : (
            <button key={i} style={it.danger ? { color: 'var(--danger)' } : undefined} onClick={() => { onClose(); it.onClick(); }}>
              {it.icon}
              {it.label}
              {it.kbd && <span className="kbd">{it.kbd}</span>}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

const KEYS: [string, string][] = [
  ['Tab', 'Подтема'],
  ['Enter', 'Тема рядом'],
  ['Shift+Enter', 'Тема рядом (выше)'],
  ['Ctrl+Enter', 'Родительская тема'],
  ['F2 / Пробел / любая буква', 'Редактировать текст'],
  ['Delete', 'Удалить'],
  ['Стрелки', 'Перемещение по карте'],
  ['Ctrl+↑/↓', 'Переместить тему выше/ниже'],
  ['Ctrl+/', 'Свернуть / развернуть'],
  ['Ctrl+C / X / V / D', 'Копировать / вырезать / вставить / дублировать'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Отменить / повторить'],
  ['Ctrl+B / Ctrl+I', 'Жирный / курсив'],
  ['Ctrl+F', 'Поиск'],
  ['Ctrl+0 / Ctrl+= / Ctrl+-', 'Вписать / увеличить / уменьшить'],
  ['Ctrl+E', 'Режим Zen'],
  ['Двойной клик по фону', 'Плавающая тема'],
  ['Перетаскивание темы', 'Переместить (на тему — вложить, на пустое место — открепить)'],
  ['Shift + перетаскивание по фону', 'Выделить рамкой'],
  ['Колесо / Ctrl+колесо', 'Прокрутка / масштаб'],
];

function KeysHelp({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Горячие клавиши</h2>
        <div className="col" style={{ gap: 6, marginTop: 12 }}>
          {KEYS.map(([k, v]) => (
            <div key={k} className="row small">
              <span className="kbd-chip">{k}</span>
              <span className="muted">{v}</span>
            </div>
          ))}
        </div>
        <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>Понятно</button></div>
      </div>
    </div>
  );
}

export { STRUCTURES };
