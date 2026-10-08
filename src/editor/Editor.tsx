import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CaretLeft, ArrowCounterClockwise, ArrowClockwise, Sparkle, SlidersHorizontal, MagnifyingGlass, DotsThree, Plus, ArrowElbowDownRight, Trash, BezierCurve, Selection,
  BracketsCurly, Minus, CornersOut, PresentationChart, ArrowsOutSimple, DownloadSimple, Lock, LockOpen, Graph, TreeView, ChartBarHorizontal, X, CaretRight,
  Keyboard, Copy, Scissors, ClipboardText, FilePlus, PencilSimple, ArrowsInLineVertical, ArrowLineUp, CopySimple, NotePencil, CloudArrowUp, Check, Palette, ArrowsLeftRight,
  Export, CaretDown, Stack, ClockCounterClockwise, type Icon,
} from '@phosphor-icons/react';
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
import { findInSheet, sheetRoots, shownLevel, treeDepth, walkSheet } from '../utils/tree';
import { subtreeBounds } from '../layout/layout';
import { downloadBlob, downloadText, safeFilename } from '../io/download';
import { sheetToMarkdown } from '../io/markdown';
import { sheetToOpml } from '../io/opml';
import { exportPdf, exportPng, exportSvgBlob } from '../io/exportImage';
import { exportXmind } from '../io/xmind';
import { exportDocx, exportPptx, exportXlsx } from '../io/office';
import { exportNative } from '../io/index';
import { getTheme } from '../themes';
import { haptic, isTouchUI, useKeyboardInset } from './touch';
import './editor.css';

const MapHistory = lazy(() => import('./MapHistory'));

const levelWord = (n: number) => `${n} ${n === 1 ? 'уровень' : n < 5 ? 'уровня' : 'уровней'}`;

type Mode = 'map' | 'outline' | 'gantt';
type Panel = null | 'inspector' | 'ai';

interface Menu {
  x: number;
  y: number;
  items: (MenuItem | 'sep')[];
  /** заголовок (на телефоне — над списком) */
  title?: string;
  /** на телефоне — в одну колонку (короткие списки выбора) */
  single?: boolean;
}
interface MenuItem {
  icon?: React.ReactNode;
  label: string;
  kbd?: string;
  danger?: boolean;
  /** отмеченный пункт выбора */
  checked?: boolean;
  onClick(): void;
}

const MODES: { id: Mode; label: string; icon: Icon }[] = [
  { id: 'map', label: 'Карта', icon: Graph },
  { id: 'outline', label: 'Структура', icon: TreeView },
  { id: 'gantt', label: 'Гант', icon: ChartBarHorizontal },
];

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
  const editing = useDoc((s) => s.editingId !== null);
  const canvas = useRef<MapCanvasHandle>(null);

  const [mode, setMode] = useState<Mode>('map');
  const [panel, setPanel] = useState<Panel>(() => (isMobile() ? null : 'inspector'));
  const [inspTab, setInspTab] = useState<InspectorTab>('topic');
  const [relMode, setRelMode] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  // -1 — по найденному ещё не переходили: первый Enter ведёт к первому совпадению, а не ко второму
  const [searchIdx, setSearchIdx] = useState(-1);
  const [zen, setZen] = useState(false);
  const [pitch, setPitch] = useState<{ slides: string[]; i: number } | null>(null);
  const zoomLabel = useRef<HTMLButtonElement>(null);
  // процент масштаба обновляется напрямую — без перерисовки всего редактора на каждом кадре щипка
  const onViewChange = useCallback((v: { k: number }) => {
    if (zoomLabel.current) zoomLabel.current.textContent = Math.round(v.k * 100) + '%';
  }, []);
  const [showKeys, setShowKeys] = useState(false);
  const [history, setHistory] = useState(false);
  const [isMobileView, setIsMobileView] = useState(isMobile);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const on = () => setIsMobileView(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const st = useDoc.getState();
  // телефон/планшет с пальцем: «+» у темы, упрощённые панели
  const touchUI = isMobileView && isTouchUI();

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
  const stepHit = (d: 1 | -1) => gotoHit(searchIdx < 0 ? (d > 0 ? 0 : -1) : searchIdx + d);

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
    haptic();
  };
  const addSibling = () => {
    primeKeyboard();
    st.addSibling(selId ?? sheet?.root.id);
    haptic();
  };
  /** Удалить темы с отклонением «Отменить» в уведомлении (на телефоне легко промахнуться) */
  const removeTopics = (ids?: string[]) => {
    const s = useDoc.getState();
    const sh = s.sheet();
    if (!sh) return;
    const list = (ids ?? s.selection).filter((id) => id !== sh.root.id);
    if (!list.length) return;
    const name = findInSheet(sh, list[0])?.topic.text.trim() ?? '';
    s.deleteTopics(list);
    haptic(12);
    const label = list.length > 1 ? `Удалено тем: ${list.length}` : name ? `Удалено: «${name.length > 26 ? name.slice(0, 25) + '…' : name}»` : 'Тема удалена';
    toast(label, { label: 'Отменить', run: () => useDoc.getState().undo() });
  };
  const del = () => {
    if (selectedRel) {
      st.removeRelationship(selectedRel);
      haptic(12);
      toast('Связь удалена', { label: 'Отменить', run: () => useDoc.getState().undo() });
    } else removeTopics();
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

  const openSearch = () => {
    primeKeyboard(); // iPhone: клавиатура открывается только из касания
    setSearch((q) => (q === null ? '' : q));
  };

  const openModeMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: Math.max(8, r.left - 80),
      y: r.bottom + 6,
      title: 'Вид',
      single: true,
      items: MODES.map((m) => ({ icon: <m.icon size={18} />, label: m.label, checked: mode === m.id, onClick: () => setMode(m.id) })),
    });
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

  const openExportMenu = (x: number, y: number) =>
    setMenu({
      x, y,
      title: 'Экспорт и отправка',
      items: [
        { icon: <DownloadSimple size={16} />, label: 'PNG (изображение)', onClick: () => exportAs('png') },
        { icon: <DownloadSimple size={16} />, label: 'PDF', onClick: () => exportAs('pdf') },
        { icon: <DownloadSimple size={16} />, label: 'SVG', onClick: () => exportAs('svg') },
        { icon: <DownloadSimple size={16} />, label: 'Xmind (.xmind)', onClick: () => exportAs('xmind') },
        { icon: <DownloadSimple size={16} />, label: 'Word (.docx)', onClick: () => exportAs('docx') },
        { icon: <DownloadSimple size={16} />, label: 'Excel (.xlsx)', onClick: () => exportAs('xlsx') },
        { icon: <DownloadSimple size={16} />, label: 'PowerPoint (.pptx)', onClick: () => exportAs('pptx') },
        { icon: <DownloadSimple size={16} />, label: 'Markdown', onClick: () => exportAs('md') },
        { icon: <DownloadSimple size={16} />, label: 'OPML', onClick: () => exportAs('opml') },
        { icon: <DownloadSimple size={16} />, label: 'Файл SuperMind', onClick: () => exportAs('native') },
      ],
    });

  /** «Показать уровни»: свернуть карту (или ветвь темы) так, чтобы было видно N уровней */
  const openLevelsMenu = (x: number, y: number, branchId?: string) => {
    const s = useDoc.getState().sheet();
    if (!s) return;
    const f = branchId ? findInSheet(s, branchId) : null;
    const roots = f ? [f.topic] : sheetRoots(s);
    const deep = Math.max(0, ...roots.map(treeDepth));
    if (deep < 2) {
      toast(f ? 'В этой ветви один уровень подтем' : 'В карте пока один уровень тем');
      return;
    }
    const cur = shownLevel(roots);
    const kb = !branchId && !window.matchMedia('(pointer: coarse)').matches;
    const apply = (n: number) => {
      if (branchId) st.collapseBranch(branchId, n);
      else if (n === Infinity) st.collapseAll(false);
      else st.collapseAll(true, n);
      // карта стала меньше/больше — вписать её в экран
      if (!branchId) requestAnimationFrame(() => requestAnimationFrame(() => canvas.current?.fit()));
      haptic();
    };
    const items: MenuItem[] = [];
    for (let n = 1; n < Math.min(deep, 10); n++) items.push({ label: levelWord(n), kbd: kb ? `Alt+${n}` : undefined, checked: cur === n, onClick: () => apply(n) });
    items.push({ label: 'Все уровни', kbd: kb ? 'Alt+0' : undefined, checked: cur === Infinity, onClick: () => apply(Infinity) });
    setMenu({ x, y, title: branchId ? 'Сколько уровней показать в ветви' : 'Сколько уровней показать', single: true, items });
  };

  const openMoreMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.max(8, Math.min(r.right - 240, window.innerWidth - 256));
    const y = r.bottom + 6;
    setMenu({
      x, y,
      items: [
        // на телефоне часть кнопок верхней панели переехала сюда
        ...(touchUI
          ? [
              { icon: <ArrowClockwise size={16} />, label: 'Повторить', onClick: () => useDoc.getState().redo() },
              { icon: <MagnifyingGlass size={16} />, label: 'Найти в карте', onClick: openSearch },
              { icon: <SlidersHorizontal size={16} />, label: 'Формат', onClick: () => setPanel('inspector') },
              { icon: <FilePlus size={16} />, label: 'Новый лист', onClick: () => st.addSheet() },
              'sep' as const,
            ]
          : []),
        { icon: <PresentationChart size={16} />, label: 'Презентация', onClick: startPitch },
        { icon: <ArrowsOutSimple size={16} />, label: 'Режим Zen', kbd: 'Ctrl+E', onClick: () => setZen(true) },
        { icon: <Stack size={16} />, label: 'Уровни…', onClick: () => openLevelsMenu(x, y) },
        { icon: <ClockCounterClockwise size={16} />, label: 'История версий', onClick: () => setHistory(true) },
        { icon: <Export size={16} />, label: 'Экспорт…', onClick: () => openExportMenu(x, y) },
        'sep',
        { icon: password ? <LockOpen size={16} /> : <Lock size={16} />, label: password ? 'Снять пароль' : 'Защитить паролем', onClick: togglePassword },
        // на телефоне клавиатурных сокращений нет
        ...(window.matchMedia('(pointer: coarse)').matches ? [] : [{ icon: <Keyboard size={16} />, label: 'Горячие клавиши', onClick: () => setShowKeys(true) }]),
      ],
    });
  };

  const topicMenu = (x: number, y: number, topicId: string | null, wx: number, wy: number) => {
    if (!sheet) return;
    if (!topicId) {
      setMenu({
        x, y,
        items: [
          { icon: <Plus size={16} />, label: 'Плавающая тема', onClick: () => { primeKeyboard(); st.addFloating(wx, wy); haptic(); } },
          { icon: <ClipboardText size={16} />, label: 'Вставить в центральную', kbd: 'Ctrl+V', onClick: () => st.paste(sheet.root.id) },
          'sep',
          { icon: <CornersOut size={16} />, label: 'Вписать в экран', kbd: 'Ctrl+0', onClick: () => canvas.current?.fit() },
          { icon: <Stack size={16} />, label: 'Показать уровни…', onClick: () => openLevelsMenu(x, y) },
          { icon: <ArrowsOutSimple size={16} />, label: 'Развернуть всё', onClick: () => st.collapseAll(false) },
        ],
      });
      return;
    }
    const f = findInSheet(sheet, topicId);
    const isRoot = topicId === sheet.root.id;
    setMenu({
      x, y,
      items: [
        { icon: <PencilSimple size={16} />, label: 'Редактировать', kbd: 'F2', onClick: () => { primeKeyboard(); st.setEditing(topicId); } },
        { icon: <ArrowElbowDownRight size={16} />, label: 'Подтема', kbd: 'Tab', onClick: () => { primeKeyboard(); st.addChild(topicId); haptic(); } },
        ...(!isRoot && f?.parent ? [
          { icon: <Plus size={16} />, label: 'Тема рядом', kbd: 'Enter', onClick: () => { primeKeyboard(); st.addSibling(topicId); haptic(); } },
          { icon: <ArrowLineUp size={16} />, label: 'Родительская тема', kbd: 'Ctrl+Enter', onClick: () => st.addParent(topicId) },
        ] : []),
        'sep',
        ...(f?.parent?.id === sheet.root.id && sheet.structure === 'map'
          ? [{ icon: <ArrowsLeftRight size={16} />, label: topicSide(sheet, topicId) === 'left' ? 'Перенести направо' : 'Перенести налево', onClick: () => st.setSide(topicId, topicSide(sheet, topicId) === 'left' ? 'right' : 'left') }]
          : []),
        { icon: <BezierCurve size={16} />, label: 'Связь', onClick: startRel },
        { icon: <Selection size={16} />, label: 'Граница', onClick: () => st.addBoundary(topicId) },
        { icon: <BracketsCurly size={16} />, label: 'Итог', onClick: () => st.addSummary(topicId) },
        { icon: <NotePencil size={16} />, label: 'Заметка, задача…', onClick: openNote },
        { icon: <Sparkle size={16} />, label: 'ИИ: идеи для темы', onClick: () => setPanel('ai') },
        'sep',
        { icon: <Copy size={16} />, label: 'Копировать', kbd: 'Ctrl+C', onClick: () => st.copy() },
        ...(!isRoot ? [{ icon: <Scissors size={16} />, label: 'Вырезать', kbd: 'Ctrl+X', onClick: () => st.copy(true) }] : []),
        { icon: <ClipboardText size={16} />, label: 'Вставить', kbd: 'Ctrl+V', onClick: () => st.paste(topicId) },
        ...(!isRoot && f?.parent ? [{ icon: <CopySimple size={16} />, label: 'Дублировать', kbd: 'Ctrl+D', onClick: () => st.duplicate(topicId) }] : []),
        ...(f?.topic.children.length ? [{ icon: <ArrowsInLineVertical size={16} />, label: f.topic.collapsed ? 'Развернуть' : 'Свернуть', kbd: 'Ctrl+/', onClick: () => st.toggleCollapse(topicId) }] : []),
        ...(f && treeDepth(f.topic) >= 2 ? [{ icon: <Stack size={16} />, label: 'Уровни ветви…', onClick: () => openLevelsMenu(x, y, topicId) }] : []),
        ...(!isRoot ? ['sep' as const, { icon: <Trash size={16} />, label: 'Удалить', kbd: 'Del', danger: true, onClick: () => removeTopics([topicId]) }] : []),
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
      if (e.altKey && !mod && /^Digit\d$/.test(e.code)) {
        e.preventDefault();
        const n = Number(e.code.slice(5));
        if (n === 0) s.collapseAll(false);
        else s.collapseAll(true, n);
        requestAnimationFrame(() => requestAnimationFrame(() => canvas.current?.fit()));
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
        case 'Backspace': e.preventDefault(); removeTopics(); return;
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
  const showSheets = !touchUI || doc.sheets.length > 1;
  const hasSel = selection.length > 0;
  const showChrome = !zen && !pitch;
  // панели над картой — светлое или тёмное стекло в цвет фона карты (а не темы приложения)
  const canvasBg = sheet.background ?? getTheme(sheet.themeId).background;
  // в «Структуре» и «Ганте» фон — тема приложения, там стекло обычное
  const chrome = mode !== 'map' ? '' : isLightColor(canvasBg) ? 'chrome-light' : 'chrome-dark';

  return (
    <div className={`editor ${chrome} ${zen ? 'zen' : ''} ${showChrome && panel ? 'panel-open' : ''}${touchUI && editing ? ' touch-editing' : ''}`}>
      {showChrome && (
        <header className="ed-top glass">
          <button className="icon-btn ed-back" onClick={() => leaveEditor('home')} title="К списку карт" aria-label="К списку карт">
            <CaretLeft weight="bold" />
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
            {saving ? <CloudArrowUp size={15} className="faint" /> : <Check size={15} className="faint" />}
          </span>
          <div className="grow" />
          {touchUI ? (
            <>
              {/* телефон: вид — одной кнопкой с меню, остальное — в «Ещё» и нижней панели */}
              <button className="icon-btn ed-mode-btn" onClick={openModeMenu} title="Вид" aria-label={'Вид: ' + MODES.find((m) => m.id === mode)!.label}>
                <CurrentModeIcon mode={mode} />
                <CaretDown className="ed-mode-caret" weight="bold" />
              </button>
              <button className="icon-btn" onClick={() => st.undo()} disabled={!canUndo} title="Отменить" aria-label="Отменить"><ArrowCounterClockwise /></button>
              <button className={`icon-btn ai-btn ${panel === 'ai' ? 'active' : ''}`} onClick={() => setPanel(panel === 'ai' ? null : 'ai')} title="ИИ" aria-label="ИИ-помощник"><Sparkle weight={panel === 'ai' ? 'fill' : 'duotone'} /></button>
              <button className="icon-btn" onClick={openMoreMenu} title="Ещё" aria-label="Ещё"><DotsThree weight="bold" /></button>
            </>
          ) : (
            <>
              <div className="segmented ed-modes">
                {MODES.map((m) => (
                  <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)} title={m.label}>
                    <m.icon size={16} weight={mode === m.id ? 'fill' : 'regular'} />
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>
              <div className="grow hide-mobile" />
              <button className="icon-btn" onClick={() => st.undo()} disabled={!canUndo} title="Отменить (Ctrl+Z)"><ArrowCounterClockwise /></button>
              <button className="icon-btn hide-xs" onClick={() => st.redo()} disabled={!canRedo} title="Повторить (Ctrl+Shift+Z)"><ArrowClockwise /></button>
              <button className={`icon-btn ${search !== null ? 'active' : ''}`} onClick={() => setSearch(search === null ? '' : null)} title="Поиск (Ctrl+F)"><MagnifyingGlass weight={search !== null ? 'bold' : 'regular'} /></button>
              <button className={`icon-btn ai-btn ${panel === 'ai' ? 'active' : ''}`} onClick={() => setPanel(panel === 'ai' ? null : 'ai')} title="ИИ"><Sparkle weight={panel === 'ai' ? 'fill' : 'duotone'} /></button>
              <button className={`icon-btn ${panel === 'inspector' ? 'active' : ''}`} onClick={() => setPanel(panel === 'inspector' ? null : 'inspector')} title="Формат"><SlidersHorizontal weight={panel === 'inspector' ? 'fill' : 'regular'} /></button>
              <button className="icon-btn" onClick={openMoreMenu} title="Ещё"><DotsThree weight="bold" /></button>
            </>
          )}
        </header>
      )}

      {search !== null && showChrome && (
        <div className="ed-search glass">
          <MagnifyingGlass size={16} className="faint" />
          <input
            autoFocus
            className="grow"
            placeholder="Найти в карте…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSearchIdx(-1); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepHit(e.shiftKey ? -1 : 1);
              if (e.key === 'Escape') setSearch(null);
            }}
          />
          <span className="tiny muted">{hits.length ? (searchIdx >= 0 ? `${Math.min(searchIdx, hits.length - 1) + 1}/${hits.length}` : String(hits.length)) : search ? '0' : ''}</span>
          <button className="icon-btn" onClick={() => stepHit(-1)}><CaretLeft size={18} /></button>
          <button className="icon-btn" onClick={() => stepHit(1)}><CaretRight size={18} /></button>
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
              onViewChange={onViewChange}
            />
          )}
          {mode === 'outline' && <Outliner />}
          {mode === 'gantt' && <Gantt />}

          {mode === 'map' && showChrome && touchUI && (
            <div className="ed-toolbar glass">
              {relMode ? (
                <button className="tb-btn active wide" onClick={() => setRelMode(false)} title="Отменить создание связи"><BezierCurve weight="fill" /><span>Нажмите на тему · Отмена</span></button>
              ) : hasSel ? (
                <>
                  {/* «Подтема» и «Рядом» — на плавающей панели у самой темы */}
                  <button className="tb-btn" onClick={() => { if (!selId) return; primeKeyboard(); st.setEditing(selId); }} title="Изменить текст"><PencilSimple /><span>Текст</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('style'); setPanel('inspector'); }} title="Стиль темы"><Palette /><span>Стиль</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('topic'); setPanel('inspector'); }} title="Заметка, задача, метки"><NotePencil /><span>Заметка</span></button>
                  <button className="tb-btn danger" onClick={del} disabled={!selection.some((id) => id !== sheet.root.id)} title="Удалить"><Trash /><span>Удалить</span></button>
                  <button
                    className="tb-btn"
                    onClick={(e) => {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      if (selId) topicMenu(r.left, r.top, selId, 0, 0);
                    }}
                    title="Ещё действия"
                  >
                    <DotsThree weight="bold" /><span>Ещё</span>
                  </button>
                </>
              ) : selectedRel ? (
                <>
                  <button className="tb-btn" onClick={() => setPanel('inspector')} title="Подпись, цвет, изгиб"><BezierCurve /><span>Связь</span></button>
                  <button className="tb-btn danger" onClick={del} title="Удалить связь"><Trash /><span>Удалить</span></button>
                </>
              ) : (
                <>
                  <button className="tb-btn" onClick={addChild} title="Новая основная тема"><Plus /><span>Тема</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('map'); setPanel('inspector'); }} title="Структура, тема оформления, формы"><Palette /><span>Оформл.</span></button>
                  <button className="tb-btn" onClick={openSearch} title="Найти в карте"><MagnifyingGlass /><span>Поиск</span></button>
                  <button className="tb-btn" onClick={() => canvas.current?.fit()} title="Вписать в экран"><CornersOut /><span>Вписать</span></button>
                </>
              )}
            </div>
          )}

          {mode === 'map' && showChrome && !touchUI && (
            <div className="ed-toolbar glass">
              {hasSel || selectedRel || !isMobileView ? (
                <>
                  <button className="tb-btn" onClick={addChild} title="Подтема (Tab)"><ArrowElbowDownRight /><span>Подтема</span></button>
                  <button className="tb-btn" onClick={addSibling} disabled={!hasSel} title="Тема рядом (Enter)"><Plus /><span>Рядом</span></button>
                  <button className="tb-btn" onClick={() => { if (!selId) return; primeKeyboard(); st.setEditing(selId); }} disabled={!hasSel} title="Изменить текст (F2)"><PencilSimple /><span>Текст</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('style'); setPanel('inspector'); }} disabled={!hasSel} title="Стиль темы: форма, цвет, шрифт"><Palette /><span>Стиль</span></button>
                  <button className={`tb-btn ${relMode ? 'active' : ''}`} onClick={() => (relMode ? setRelMode(false) : startRel())} title="Связь"><BezierCurve weight={relMode ? 'fill' : 'regular'} /><span>Связь</span></button>
                  <button className="tb-btn hide-xs" onClick={() => st.addBoundary()} disabled={!hasSel} title="Граница"><Selection /><span>Граница</span></button>
                  <button className="tb-btn hide-xs" onClick={() => st.addSummary()} disabled={!hasSel} title="Итог"><BracketsCurly /><span>Итог</span></button>
                  <button className="tb-btn" onClick={del} disabled={!selection.some((id) => id !== sheet.root.id) && !selectedRel} title="Удалить (Del)"><Trash /><span>Удалить</span></button>
                </>
              ) : (
                <>
                  <button className="tb-btn" onClick={addChild} title="Новая основная тема"><Plus /><span>Тема</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('map'); setPanel('inspector'); }} title="Структура, тема оформления, формы"><Palette /><span>Оформл.</span></button>
                </>
              )}
              <span className="tb-sep hide-mobile" />
              <button className="tb-btn show-mobile" onClick={() => st.undo()} disabled={!canUndo}><ArrowCounterClockwise /><span>Отмена</span></button>
              {!hasSel && (
                <button className="tb-btn show-mobile" onClick={() => st.redo()} disabled={!canRedo}><ArrowClockwise /><span>Повтор</span></button>
              )}
              <button className="tb-btn hide-mobile" onClick={() => canvas.current?.zoomBy(1 / 1.2)} title="Уменьшить"><Minus /></button>
              <button ref={zoomLabel} className="tb-zoom hide-mobile" onClick={() => canvas.current?.setZoom(1)} title="100%">100%</button>
              <button className="tb-btn hide-mobile" onClick={() => canvas.current?.zoomBy(1.2)} title="Увеличить"><Plus /></button>
              <button className={`tb-btn ${hasSel && isMobileView ? 'hide-xs' : ''}`} onClick={() => canvas.current?.fit()} title="Вписать (Ctrl+0)"><CornersOut /><span className="show-mobile-inline">Вписать</span></button>
            </div>
          )}

          {showChrome && showSheets && (
            <div className={`ed-sheets${mode !== 'map' ? ' not-map' : ''}`}>
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
                        { icon: <PencilSimple size={16} />, label: 'Переименовать', onClick: async () => { const t = await askText('Название листа', { value: s.title }); if (t) { st.setActiveSheet(s.id); st.setSheetProps({ title: t }); } } },
                        { icon: <CopySimple size={16} />, label: 'Дублировать', onClick: () => st.duplicateSheet(s.id) },
                        ...(doc.sheets.length > 1 ? [{ icon: <Trash size={16} />, label: 'Удалить лист', danger: true, onClick: async () => { if (await confirmDialog('Удалить лист?', s.title, { danger: true, okText: 'Удалить' })) st.removeSheet(s.id); } }] : []),
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
              <button className="sheet-tab add" onClick={() => st.addSheet()} title="Новый лист"><FilePlus size={15} /></button>
            </div>
          )}

          {zen && !pitch && (
            <button className="zen-exit glass" onClick={() => setZen(false)}>
              <X size={16} /> Выйти из Zen
            </button>
          )}

          {pitch && (
            <div className="pitch-bar glass">
              <button className="icon-btn" onClick={() => setPitch((p) => (p && p.i > 0 ? { ...p, i: p.i - 1 } : p))} disabled={pitch.i === 0}><CaretLeft /></button>
              <span className="small bold">{pitch.i + 1} / {pitch.slides.length}</span>
              <button className="icon-btn" onClick={() => setPitch((p) => (p && p.i < p.slides.length - 1 ? { ...p, i: p.i + 1 } : p))} disabled={pitch.i >= pitch.slides.length - 1}><CaretRight /></button>
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

        {showChrome && panel && (
          <PanelSheet key={panel} mobile={isMobileView} onClose={() => setPanel(null)}>
            {panel === 'inspector' ? <Inspector tab={inspTab} setTab={setInspTab} onClose={() => setPanel(null)} /> : <AIPanel onClose={() => setPanel(null)} />}
          </PanelSheet>
        )}
      </div>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {showKeys && <KeysHelp onClose={() => setShowKeys(false)} />}
      {history && (
        <Suspense fallback={null}>
          <MapHistory onClose={() => setHistory(false)} />
        </Suspense>
      )}
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
  // на телефоне меню выезжает снизу (всегда целиком в пределах экрана и под большим пальцем)
  const sheet = window.matchMedia('(pointer: coarse) and (max-width: 760px)').matches;
  return (
    <div className={`menu-layer${sheet ? ' menu-sheet-layer' : ''}`} onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={ref}
        role="menu"
        className={`menu${sheet ? ' menu-sheet' : ''}${menu.single ? ' single' : ''}`}
        style={sheet ? undefined : { left: pos.x, top: pos.y, maxHeight: 'calc(100vh - 16px)', overflow: 'auto' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {sheet && <div className="menu-sheet-grip" />}
        {menu.title && <div className="menu-title">{menu.title}</div>}
        {menu.items.map((it, i) =>
          it === 'sep' ? (
            <div key={i} className="sep" />
          ) : (
            <button key={i} role="menuitem" className={it.checked ? 'checked' : undefined} style={it.danger ? { color: 'var(--danger)' } : undefined} onClick={() => { onClose(); it.onClick(); }}>
              {it.icon}
              {it.label}
              {it.kbd && <span className="kbd">{it.kbd}</span>}
              {it.checked && <Check className="menu-check" weight="bold" />}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function CurrentModeIcon({ mode }: { mode: Mode }) {
  const M = MODES.find((m) => m.id === mode)!.icon;
  return <M />;
}

/**
 * Панель «Формат»/«ИИ». На компьютере — колонка справа, на телефоне — лист iOS снизу
 * с двумя положениями (половина экрана / почти весь экран): тянется за «ручку» или заголовок,
 * смахивание вниз закрывает. Над экранной клавиатурой поднимается целиком.
 */
function PanelSheet({ mobile, onClose, children }: { mobile: boolean; onClose(): void; children: React.ReactNode }) {
  const [detent, setDetent] = useState<'medium' | 'large'>('medium');
  const [dragH, setDragH] = useState<number | null>(null);
  const { inset, height: vh } = useKeyboardInset();
  const start = useRef<{ y: number; h: number; t: number; grip: boolean } | null>(null);
  if (!mobile) return <div className="ed-panel">{children}</div>;
  const medium = Math.round(Math.max(320, vh * 0.52));
  const large = Math.max(medium, vh - 54);
  const h = dragH ?? (detent === 'large' || inset > 0 ? large : medium);
  const onDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.sheet-grabber, .inspector-head') || t.closest('button, input, select, textarea, a, label')) return;
    start.current = { y: e.clientY, h, t: performance.now(), grip: !!t.closest('.sheet-grabber') };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const next = s.h - (e.clientY - s.y);
    // выше верхнего положения — с «резиновым» сопротивлением
    setDragH(next > large ? large + (next - large) * 0.25 : Math.max(60, next));
  };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    start.current = null;
    setDragH(null);
    const dy = e.clientY - s.y;
    if (Math.abs(dy) < 5) {
      if (s.grip) setDetent((d) => (d === 'medium' ? 'large' : 'medium'));
      return;
    }
    const v = dy / Math.max(1, performance.now() - s.t); // px/мс, вниз > 0
    const endH = s.h - dy;
    if (endH < medium * 0.62 || (v > 0.9 && s.h <= medium + 4)) return onClose();
    if (v < -0.5) setDetent('large');
    else if (v > 0.5) setDetent('medium');
    else setDetent(Math.abs(endH - large) < Math.abs(endH - medium) ? 'large' : 'medium');
  };
  return (
    <div
      className={`ed-panel ed-sheet${dragH !== null ? ' dragging' : ''}`}
      style={{ height: h, bottom: inset }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="sheet-grabber" aria-hidden="true"><span /></div>
      {children}
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
  ['Alt+1…9 / Alt+0', 'Показать 1…9 уровней / все'],
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

/** Светлый ли цвет фона (#rgb/#rrggbb); неизвестные считаем светлыми */
function isLightColor(c: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return true;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  const n = parseInt(h, 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.55;
}
