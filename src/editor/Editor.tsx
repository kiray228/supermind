import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CaretLeft, ArrowCounterClockwise, ArrowClockwise, Sparkle, SlidersHorizontal, MagnifyingGlass, DotsThree, Plus, ArrowElbowDownRight, Trash, BezierCurve, Selection,
  BracketsCurly, Minus, CornersOut, PresentationChart, ArrowsOutSimple, DownloadSimple, Lock, LockOpen, Graph, TreeView, ChartBarHorizontal, X, CaretRight,
  Keyboard, Copy, Scissors, ClipboardText, FilePlus, PencilSimple, ArrowsInLineVertical, ArrowLineUp, CopySimple, NotePencil, CloudArrowUp, Check, Palette, ArrowsLeftRight,
  Export, CaretDown, Stack, ClockCounterClockwise, Crosshair, FloppyDisk, WarningCircle, ShareNetwork, Eye, type Icon,
} from '@phosphor-icons/react';
import { focusPath, focusSheet } from './focus';
import { useDoc, topicSide, saveNow } from '../store/docStore';
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
import { safeUrl } from '../utils/url';
import { subtreeBounds } from '../layout/layout';
import { downloadBlob, downloadText, safeFilename } from '../io/download';
import { sheetToMarkdown } from '../io/markdown';
import { sheetToOpml } from '../io/opml';
import { sheetToFreemind } from '../io/freemind';
import { exportPdf, exportPng, exportSvgBlob } from '../io/exportImage';
import { exportXmind } from '../io/xmind';
import { exportDocx, exportPptx, exportXlsx } from '../io/office';
import { exportNative } from '../io/index';
import { getTheme } from '../themes';
import { haptic, isTouchUI, useKeyboardInset } from './touch';
import { t, tn } from '../i18n/index';
import './editor.css';

const MapHistory = lazy(() => import('./MapHistory'));
const ShareDialog = lazy(() => import('../share/ShareDialog'));
import '../share/share.css';

const levelWord = (n: number) => `${n} ${tn(n, 'уровень', 'уровня', 'уровней')}`;

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
  { id: 'map', label: t('Карта'), icon: Graph },
  { id: 'outline', label: t('Структура'), icon: TreeView },
  { id: 'gantt', label: t('Гант'), icon: ChartBarHorizontal },
];

const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

/** Буква сочетания клавиш — и на русской раскладке (Ctrl+Z приходит как «я»): по физической клавише */
const isKey = (e: KeyboardEvent, letter: string) => e.key.toLowerCase() === letter || e.code === 'Key' + letter.toUpperCase();

export default function Editor() {
  const doc = useDoc((s) => s.doc);
  const sheet = useDoc((s) => s.sheet());
  // фокус на ветке: на холсте — только она (вид, лист не меняется)
  const focusId = useDoc((s) => s.focusId);
  const viewSheet = useMemo(() => (sheet ? (focusSheet(sheet, focusId) ?? sheet) : null), [sheet, focusId]);
  const focusTrail = useMemo(() => (sheet && focusId && viewSheet !== sheet ? focusPath(sheet, focusId) : []), [sheet, focusId, viewSheet]);
  // ветку удалили (или отменили её создание) — выйти из фокуса
  useEffect(() => {
    if (focusId && sheet && viewSheet === sheet) useDoc.getState().setFocus(null);
  }, [focusId, sheet, viewSheet]);
  const selection = useDoc((s) => s.selection);
  const selectedRel = useDoc((s) => s.selectedRel);
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const saving = useDoc((s) => s.saving);
  const password = useDoc((s) => s.password);
  const saveError = useDoc((s) => s.saveError);
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
  const [shareOpen, setShareOpen] = useState(false);
  /** чужая карта по ссылке: чья и что можно (null — своя) */
  const shared = useDoc((s) => s.shared);
  const viewOnly = shared?.role === 'view';
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
    if (!viewSheet || !search?.trim()) return [] as string[];
    const q = search.trim().toLowerCase();
    const out: string[] = [];
    // в фокусе на ветке — совпадения только в ней (переход к невидимой теме ничего не показал бы)
    walkSheet(viewSheet, (t) => {
      if (t.text.toLowerCase().includes(q) || t.note?.toLowerCase().includes(q) || t.labels?.some((l) => l.toLowerCase().includes(q))) out.push(t.id);
    });
    return out;
  }, [viewSheet, search]);
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
    // слайды — по всей карте: фокус на ветке снимаем
    if (st.focusId) st.setFocus(null);
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
    const label = list.length > 1 ? t('Удалено тем: {n}', { n: list.length }) : name ? t('Удалено: «{name}»', { name: name.length > 26 ? name.slice(0, 25) + '…' : name }) : t('Тема удалена');
    toast(label, { label: t('Отменить'), run: () => useDoc.getState().undo() });
  };
  const del = () => {
    if (selectedRel) {
      st.removeRelationship(selectedRel);
      haptic(12);
      toast(t('Связь удалена'), { label: t('Отменить'), run: () => useDoc.getState().undo() });
    } else removeTopics();
  };
  const startRel = () => {
    if (!selId) return toast(t('Сначала выберите тему'));
    setRelMode(true);
    toast(t('Нажмите на тему, с которой нужно связать'));
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
      title: t('Вид'),
      single: true,
      items: MODES.map((m) => ({ icon: <m.icon size={18} />, label: m.label, checked: mode === m.id, onClick: () => setMode(m.id) })),
    });
  };

  const exportAs = useCallback(
    async (kind: string) => {
      if (!doc || !sheet) return;
      const name = safeFilename(doc.title || t('Карта'));
      const bg = sheet.background ?? getTheme(sheet.themeId).background;
      const svg = () => {
        const el = canvas.current?.svg();
        if (!el) throw new Error(t('Переключитесь в режим карты'));
        return el;
      };
      try {
        if (mode !== 'map' && ['png', 'svg', 'pdf'].includes(kind)) {
          setMode('map');
          await new Promise((r) => setTimeout(r, 120));
        }
        toast(t('Экспорт…'));
        switch (kind) {
          case 'png': await downloadBlob(await exportPng(svg(), bg, 2), name + '.png'); break;
          case 'svg': await downloadBlob(exportSvgBlob(svg(), bg), name + '.svg'); break;
          case 'pdf': await downloadBlob(await exportPdf(svg(), bg, doc.title), name + '.pdf'); break;
          case 'md': await downloadText(sheetToMarkdown(sheet), name + '.md', 'text/markdown'); break;
          case 'opml': await downloadText(sheetToOpml(sheet, doc.title), name + '.opml', 'text/x-opml'); break;
          case 'mm': await downloadText(sheetToFreemind(sheet), name + '.mm', 'application/x-freemind'); break;
          case 'xmind': await downloadBlob(await exportXmind(doc), name + '.xmind'); break;
          case 'docx': await downloadBlob(await exportDocx(doc), name + '.docx'); break;
          case 'xlsx': await downloadBlob(await exportXlsx(doc), name + '.xlsx'); break;
          case 'pptx': await downloadBlob(await exportPptx(doc), name + '.pptx'); break;
          case 'native': await downloadBlob(exportNative(doc), name + '.supermind'); break;
        }
      } catch (e) {
        toast(t('Ошибка экспорта: {error}', { error: e instanceof Error ? e.message : String(e) }));
      }
    },
    [doc, sheet, mode],
  );

  const togglePassword = async () => {
    if (password) {
      if (await confirmDialog(t('Снять пароль?'), t('Документ будет храниться без шифрования.'))) {
        st.setPassword(null);
        toast(t('Пароль снят'));
      }
      return;
    }
    const p = await askText(t('Защитить паролем'), { message: t('Карта будет зашифрована (AES-256). Если забудете пароль — восстановить её не получится.'), placeholder: t('Пароль') });
    if (!p) return;
    const p2 = await askText(t('Повторите пароль'), { placeholder: t('Пароль ещё раз') });
    if (p !== p2) return toast(t('Пароли не совпадают'));
    st.setPassword(p);
    toast(t('Карта зашифрована 🔒'));
  };

  const openExportMenu = (x: number, y: number) =>
    setMenu({
      x, y,
      title: t('Экспорт и отправка'),
      items: [
        { icon: <DownloadSimple size={16} />, label: t('PNG (изображение)'), onClick: () => exportAs('png') },
        { icon: <DownloadSimple size={16} />, label: 'PDF', onClick: () => exportAs('pdf') },
        { icon: <DownloadSimple size={16} />, label: 'SVG', onClick: () => exportAs('svg') },
        { icon: <DownloadSimple size={16} />, label: 'Xmind (.xmind)', onClick: () => exportAs('xmind') },
        { icon: <DownloadSimple size={16} />, label: 'FreeMind / Freeplane (.mm)', onClick: () => exportAs('mm') },
        { icon: <DownloadSimple size={16} />, label: 'Word (.docx)', onClick: () => exportAs('docx') },
        { icon: <DownloadSimple size={16} />, label: 'Excel (.xlsx)', onClick: () => exportAs('xlsx') },
        { icon: <DownloadSimple size={16} />, label: 'PowerPoint (.pptx)', onClick: () => exportAs('pptx') },
        { icon: <DownloadSimple size={16} />, label: 'Markdown', onClick: () => exportAs('md') },
        { icon: <DownloadSimple size={16} />, label: 'OPML', onClick: () => exportAs('opml') },
        { icon: <DownloadSimple size={16} />, label: t('Файл SuperMind'), onClick: () => exportAs('native') },
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
      toast(f ? t('В этой ветви один уровень подтем') : t('В карте пока один уровень тем'));
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
    items.push({ label: t('Все уровни'), kbd: kb ? 'Alt+0' : undefined, checked: cur === Infinity, onClick: () => apply(Infinity) });
    setMenu({ x, y, title: branchId ? t('Сколько уровней показать в ветви') : t('Сколько уровней показать'), single: true, items });
  };

  // «Сохранить»: запись на устройство с проверкой, затем — в облако, если вошли в аккаунт
  const savingNow = useRef(false);
  const saveMap = async () => {
    if (savingNow.current) return;
    savingNow.current = true;
    try {
      const { ok } = await saveNow();
      if (!ok) {
        toast(t('Не удалось сохранить: {error}', { error: useDoc.getState().saveError ?? t('ошибка записи') }), { label: t('Ещё раз'), run: () => void saveMap() });
        return;
      }
      haptic();
      const { useCloud, syncNow } = await import('../store/cloud');
      if (!useCloud.getState().account) return void toast(t('Карта сохранена'));
      if (!navigator.onLine) return void toast(t('Карта сохранена на устройстве. В облако отправится, когда появится интернет'));
      toast(t('Карта сохранена, отправляю в облако…'));
      await syncNow();
      const c = useCloud.getState();
      toast(c.status === 'idle' ? t('Карта сохранена на устройстве и в облаке') : t('Карта сохранена на устройстве. В облако отправится позже') + (c.error ? ` (${c.error})` : ''));
    } finally {
      savingNow.current = false;
    }
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
              { icon: <ArrowClockwise size={16} />, label: t('Повторить'), onClick: () => useDoc.getState().redo() },
              { icon: <MagnifyingGlass size={16} />, label: t('Найти в карте'), onClick: openSearch },
              { icon: <SlidersHorizontal size={16} />, label: t('Формат'), onClick: () => setPanel('inspector') },
              { icon: <FilePlus size={16} />, label: t('Новый лист'), onClick: () => st.addSheet() },
              'sep' as const,
            ]
          : []),
        { icon: <FloppyDisk size={16} />, label: t('Сохранить'), kbd: touchUI ? undefined : 'Ctrl+S', onClick: () => void saveMap() },
        { icon: <PresentationChart size={16} />, label: t('Презентация'), onClick: startPitch },
        { icon: <ArrowsOutSimple size={16} />, label: t('Режим Zen'), kbd: 'Ctrl+E', onClick: () => setZen(true) },
        { icon: <Stack size={16} />, label: t('Уровни…'), onClick: () => openLevelsMenu(x, y) },
        // у чужой карты история версий и пароль — у владельца
        ...(shared ? [] : [{ icon: <ShareNetwork size={16} />, label: t('Поделиться ссылкой'), onClick: () => setShareOpen(true) }]),
        ...(shared ? [] : [{ icon: <ClockCounterClockwise size={16} />, label: t('История версий'), onClick: () => setHistory(true) }]),
        { icon: <Export size={16} />, label: t('Экспорт…'), onClick: () => openExportMenu(x, y) },
        'sep',
        ...(shared ? [] : [{ icon: password ? <LockOpen size={16} /> : <Lock size={16} />, label: password ? t('Снять пароль') : t('Защитить паролем'), onClick: togglePassword }]),
        // на телефоне клавиатурных сокращений нет
        ...(window.matchMedia('(pointer: coarse)').matches ? [] : [{ icon: <Keyboard size={16} />, label: t('Горячие клавиши'), onClick: () => setShowKeys(true) }]),
      ],
    });
  };

  const topicMenu = (x: number, y: number, topicId: string | null, wx: number, wy: number) => {
    if (!sheet) return;
    if (!topicId) {
      setMenu({
        x, y,
        items: [
          { icon: <Plus size={16} />, label: t('Плавающая тема'), onClick: () => { primeKeyboard(); st.addFloating(wx, wy); haptic(); } },
          { icon: <ClipboardText size={16} />, label: t('Вставить в центральную'), kbd: 'Ctrl+V', onClick: () => st.paste(sheet.root.id) },
          'sep',
          { icon: <CornersOut size={16} />, label: t('Вписать в экран'), kbd: 'Ctrl+0', onClick: () => canvas.current?.fit() },
          { icon: <Stack size={16} />, label: t('Показать уровни…'), onClick: () => openLevelsMenu(x, y) },
          { icon: <ArrowsOutSimple size={16} />, label: t('Развернуть всё'), onClick: () => st.collapseAll(false) },
        ],
      });
      return;
    }
    const f = findInSheet(sheet, topicId);
    // ветка в фокусе — здесь как центральная тема
    const isRoot = topicId === sheet.root.id || topicId === focusId;
    setMenu({
      x, y,
      items: [
        { icon: <PencilSimple size={16} />, label: t('Редактировать'), kbd: 'F2', onClick: () => { primeKeyboard(); st.setEditing(topicId); } },
        { icon: <ArrowElbowDownRight size={16} />, label: t('Подтема'), kbd: 'Tab', onClick: () => { primeKeyboard(); st.addChild(topicId); haptic(); } },
        ...(!isRoot && f?.parent ? [
          { icon: <Plus size={16} />, label: t('Тема рядом'), kbd: 'Enter', onClick: () => { primeKeyboard(); st.addSibling(topicId); haptic(); } },
          { icon: <ArrowLineUp size={16} />, label: t('Родительская тема'), kbd: 'Ctrl+Enter', onClick: () => st.addParent(topicId) },
        ] : []),
        'sep',
        ...(f?.parent?.id === sheet.root.id && sheet.structure === 'map'
          ? [{ icon: <ArrowsLeftRight size={16} />, label: topicSide(sheet, topicId) === 'left' ? t('Перенести направо') : t('Перенести налево'), onClick: () => st.setSide(topicId, topicSide(sheet, topicId) === 'left' ? 'right' : 'left') }]
          : []),
        ...(topicId !== sheet.root.id && f?.topic.children.length
          ? [{ icon: <Crosshair size={16} />, label: topicId === focusId ? t('Показать всю карту') : t('Фокус на ветке'), kbd: 'Alt+F', onClick: () => st.setFocus(topicId === focusId ? null : topicId) }]
          : focusId === topicId
            ? [{ icon: <Crosshair size={16} />, label: t('Показать всю карту'), kbd: 'Alt+F', onClick: () => st.setFocus(null) }]
            : []),
        { icon: <BezierCurve size={16} />, label: t('Связь'), onClick: startRel },
        { icon: <Selection size={16} />, label: t('Граница'), onClick: () => st.addBoundary(topicId) },
        { icon: <BracketsCurly size={16} />, label: t('Итог'), onClick: () => st.addSummary(topicId) },
        { icon: <NotePencil size={16} />, label: t('Заметка, задача…'), onClick: openNote },
        { icon: <Sparkle size={16} />, label: t('ИИ: идеи для темы'), onClick: () => setPanel('ai') },
        'sep',
        { icon: <Copy size={16} />, label: t('Копировать'), kbd: 'Ctrl+C', onClick: () => st.copy() },
        ...(!isRoot ? [{ icon: <Scissors size={16} />, label: t('Вырезать'), kbd: 'Ctrl+X', onClick: () => st.copy(true) }] : []),
        { icon: <ClipboardText size={16} />, label: t('Вставить'), kbd: 'Ctrl+V', onClick: () => st.paste(topicId) },
        ...(!isRoot && f?.parent ? [{ icon: <CopySimple size={16} />, label: t('Дублировать'), kbd: 'Ctrl+D', onClick: () => st.duplicate(topicId) }] : []),
        ...(f?.topic.children.length ? [{ icon: <ArrowsInLineVertical size={16} />, label: f.topic.collapsed ? t('Развернуть') : t('Свернуть'), kbd: 'Ctrl+/', onClick: () => st.toggleCollapse(topicId) }] : []),
        ...(f && treeDepth(f.topic) >= 2 ? [{ icon: <Stack size={16} />, label: t('Уровни ветви…'), onClick: () => openLevelsMenu(x, y, topicId) }] : []),
        ...(!isRoot ? ['sep' as const, { icon: <Trash size={16} />, label: t('Удалить'), kbd: 'Del', danger: true, onClick: () => removeTopics([topicId]) }] : []),
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
  const saveMapRef = useRef(saveMap);
  saveMapRef.current = saveMap;
  // Ctrl+S — и во время ввода: поле темы останавливает всплытие клавиш, поэтому слушаем на погружении
  useEffect(() => {
    const onSave = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !isKey(e, 's')) return;
      e.preventDefault();
      e.stopPropagation();
      void saveMapRef.current();
    };
    window.addEventListener('keydown', onSave, true);
    return () => window.removeEventListener('keydown', onSave, true);
  }, []);
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
      if (mod && isKey(e, 'z')) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && isKey(e, 'y')) { e.preventDefault(); s.redo(); return; }
      if (mod && isKey(e, 'f')) { e.preventDefault(); setSearch(''); return; }
      if (mod && isKey(e, 'e')) { e.preventDefault(); setZen((z) => !z); return; }
      if (mod && k === '0') { e.preventDefault(); canvas.current?.fit(); return; }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); canvas.current?.zoomBy(1.2); return; }
      if (mod && k === '-') { e.preventDefault(); canvas.current?.zoomBy(1 / 1.2); return; }
      if (k === 'Escape') {
        if (relMode) setRelMode(false);
        else if (zen) setZen(false);
        // ничего не выделено — Esc выходит из фокуса на ветке
        else if (s.focusId && !s.selection.length) s.setFocus(null);
        else s.select(null);
        return;
      }
      // Alt+F — фокус на выделенной ветке / вся карта
      if (e.altKey && !mod && e.code === 'KeyF' && mode === 'map') {
        e.preventDefault();
        const id = s.selection[s.selection.length - 1];
        s.setFocus(s.focusId && (!id || id === s.focusId) ? null : (id ?? null));
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
      if (mod && isKey(e, 'c')) { s.copy(); return; }
      if (mod && isKey(e, 'x')) { s.copy(true); return; }
      if (mod && isKey(e, 'd')) { e.preventDefault(); if (!(s.focusId && s.selection.includes(s.focusId))) s.duplicate(); return; }
      // в фокусе на ветке — только она (иначе Delete стёр бы всю карту, которой не видно)
      if (mod && isKey(e, 'a')) { e.preventDefault(); const ids: string[] = []; walkSheet(focusSheet(s.sheet()!, s.focusId) ?? s.sheet()!, (t) => void ids.push(t.id)); s.select(ids); return; }
      if (mod && isKey(e, 'b') && s.selection.length) {
        e.preventDefault();
        const t = findInSheet(s.sheet()!, sel)?.topic;
        s.updateStyle(s.selection, { bold: t?.style?.bold ? undefined : true });
        return;
      }
      if (mod && isKey(e, 'i') && s.selection.length) {
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
          if (mod) {
            // родитель темы-фокуса оказался бы вне видимой ветки
            if (sel !== s.focusId) s.addParent(sel);
          } else s.addSibling(sel, e.shiftKey);
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
          <button className="icon-btn ed-back" onClick={() => leaveEditor('home')} title={t('К списку карт')} aria-label={t('К списку карт')}>
            <CaretLeft weight="bold" />
          </button>
          <input
            className="ed-title"
            defaultValue={doc.title}
            key={doc.id + doc.title}
            readOnly={viewOnly}
            onBlur={(e) => e.target.value.trim() && e.target.value !== doc.title && st.setTitle(e.target.value.trim())}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {!viewOnly && <button
            className={`ed-save ${saveError ? 'err' : ''}`}
            onClick={() => void saveMap()}
            title={saveError ? t('Карта не сохранилась — нажмите, чтобы сохранить') : saving ? t('Сохранение…') : t('Сохранить (Ctrl+S)')}
            aria-label={t('Сохранить карту')}
          >
            {password && <Lock size={13} className="ed-save-lock" />}
            {saveError ? <WarningCircle weight="fill" /> : saving ? <CloudArrowUp /> : <FloppyDisk />}
            <span className="ed-save-label">{t('Сохранить')}</span>
          </button>}
          <div className="grow" />
          {touchUI ? (
            <>
              {/* телефон: вид — одной кнопкой с меню, остальное — в «Ещё» и нижней панели */}
              <button className="icon-btn ed-mode-btn" onClick={openModeMenu} title={t('Вид')} aria-label={t('Вид: {mode}', { mode: MODES.find((m) => m.id === mode)!.label })}>
                <CurrentModeIcon mode={mode} />
                <CaretDown className="ed-mode-caret" weight="bold" />
              </button>
              <button className="icon-btn" onClick={() => st.undo()} disabled={!canUndo} title={t('Отменить')} aria-label={t('Отменить')}><ArrowCounterClockwise /></button>
              <button className={`icon-btn ai-btn ${panel === 'ai' ? 'active' : ''}`} onClick={() => setPanel(panel === 'ai' ? null : 'ai')} title={t('ИИ')} aria-label={t('ИИ-помощник')}><Sparkle weight={panel === 'ai' ? 'fill' : 'duotone'} /></button>
              <button className="icon-btn" onClick={openMoreMenu} title={t('Ещё')} aria-label={t('Ещё')}><DotsThree weight="bold" /></button>
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
              <button className="icon-btn" onClick={() => st.undo()} disabled={!canUndo} title={t('Отменить (Ctrl+Z)')}><ArrowCounterClockwise /></button>
              <button className="icon-btn hide-xs" onClick={() => st.redo()} disabled={!canRedo} title={t('Повторить (Ctrl+Shift+Z)')}><ArrowClockwise /></button>
              <button className={`icon-btn ${search !== null ? 'active' : ''}`} onClick={() => setSearch(search === null ? '' : null)} title={t('Поиск (Ctrl+F)')}><MagnifyingGlass weight={search !== null ? 'bold' : 'regular'} /></button>
              <button className={`icon-btn ai-btn ${panel === 'ai' ? 'active' : ''}`} onClick={() => setPanel(panel === 'ai' ? null : 'ai')} title={t('ИИ')}><Sparkle weight={panel === 'ai' ? 'fill' : 'duotone'} /></button>
              <button className={`icon-btn ${panel === 'inspector' ? 'active' : ''}`} onClick={() => setPanel(panel === 'inspector' ? null : 'inspector')} title={t('Формат')}><SlidersHorizontal weight={panel === 'inspector' ? 'fill' : 'regular'} /></button>
              <button className="icon-btn" onClick={openMoreMenu} title={t('Ещё')}><DotsThree weight="bold" /></button>
            </>
          )}
        </header>
      )}
      {showChrome && shared && (
        <span className="shared-badge" title={viewOnly ? t('Владелец карты — {name}. Только просмотр', { name: shared.owner.name }) : t('Владелец карты — {name}. Правки сохраняются у владельца', { name: shared.owner.name })}>
          {viewOnly ? <Eye size={14} weight="bold" /> : <PencilSimple size={14} weight="bold" />}
          {viewOnly ? t('Просмотр · {name}', { name: shared.owner.name }) : t('Владелец: {name}', { name: shared.owner.name })}
        </span>
      )}

      {search !== null && showChrome && (
        <div className="ed-search glass">
          <MagnifyingGlass size={16} className="faint" />
          <input
            autoFocus
            className="grow"
            placeholder={t('Найти в карте…')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSearchIdx(-1); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepHit(e.shiftKey ? -1 : 1);
              if (e.key === 'Escape') setSearch(null);
            }}
          />
          <span className="tiny muted">{hits.length ? (searchIdx >= 0 ? `${Math.min(searchIdx, hits.length - 1) + 1}/${hits.length}` : String(hits.length)) : search ? '0' : ''}</span>
          <button className="icon-btn" onClick={() => stepHit(-1)} aria-label={t('Предыдущее совпадение')} title={t('Предыдущее')}><CaretLeft size={18} /></button>
          <button className="icon-btn" onClick={() => stepHit(1)} aria-label={t('Следующее совпадение')} title={t('Следующее')}><CaretRight size={18} /></button>
          <button className="icon-btn" onClick={() => setSearch(null)} aria-label={t('Закрыть поиск')} title={t('Закрыть')}><X size={18} /></button>
        </div>
      )}

      <div className={`ed-main ${showChrome && panel ? 'sheet-open' : ''}`}>
        <div className="ed-stage">
          {mode === 'map' && (
            <MapCanvas
              ref={canvas}
              sheet={viewSheet ?? sheet}
              relMode={relMode}
              onRelTarget={onRelTarget}
              onContextMenu={({ x, y, topicId, worldX, worldY }) => !pitch && topicMenu(x, y, topicId, worldX, worldY)}
              onOpenNote={openNote}
              onOpenLink={(u) => {
                const url = safeUrl(u);
                if (url) window.open(url, '_blank', 'noopener');
              }}
              pitchFocus={pitchFocus}
              readOnly={!!pitch || viewOnly}
              searchHits={hitSet}
              onViewChange={onViewChange}
            />
          )}
          {mode === 'map' && focusTrail.length > 0 && !pitch && (
            <div className="ed-focusbar glass" role="navigation" aria-label={t('Фокус на ветке')}>
              <button className="ed-focus-crumb" onClick={() => st.setFocus(null)} title={t('Показать всю карту (Esc)')}>
                <Crosshair size={15} /> {t('Вся карта')}
              </button>
              {focusTrail.map((ft, i) => (
                <span key={ft.id} className="ed-focus-step">
                  <CaretRight size={12} className="faint" />
                  <button className="ed-focus-crumb" disabled={i === focusTrail.length - 1} onClick={() => st.setFocus(ft.id)}>
                    {ft.text.trim().slice(0, 40) || t('Без названия')}
                  </button>
                </span>
              ))}
              <button className="icon-btn" onClick={() => st.setFocus(null)} aria-label={t('Выйти из фокуса')}>
                <X size={16} />
              </button>
            </div>
          )}
          {mode === 'outline' && <Outliner />}
          {mode === 'gantt' && <Gantt />}

          {mode === 'map' && showChrome && touchUI && (
            <div className="ed-toolbar glass">
              {relMode ? (
                <button className="tb-btn active wide" onClick={() => setRelMode(false)} title={t('Отменить создание связи')}><BezierCurve weight="fill" /><span>{t('Нажмите на тему · Отмена')}</span></button>
              ) : hasSel ? (
                <>
                  {/* «Подтема» и «Рядом» — на плавающей панели у самой темы */}
                  <button className="tb-btn" onClick={() => { if (!selId) return; primeKeyboard(); st.setEditing(selId); }} title={t('Изменить текст')}><PencilSimple /><span>{t('Текст')}</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('style'); setPanel('inspector'); }} title={t('Стиль темы')}><Palette /><span>{t('Стиль')}</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('topic'); setPanel('inspector'); }} title={t('Заметка, задача, метки')}><NotePencil /><span>{t('Заметка')}</span></button>
                  <button className="tb-btn danger" onClick={del} disabled={!selection.some((id) => id !== sheet.root.id)} title={t('Удалить')}><Trash /><span>{t('Удалить')}</span></button>
                  <button
                    className="tb-btn"
                    onClick={(e) => {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      if (selId) topicMenu(r.left, r.top, selId, 0, 0);
                    }}
                    title={t('Ещё действия')}
                  >
                    <DotsThree weight="bold" /><span>{t('Ещё')}</span>
                  </button>
                </>
              ) : selectedRel ? (
                <>
                  <button className="tb-btn" onClick={() => setPanel('inspector')} title={t('Подпись, цвет, изгиб')}><BezierCurve /><span>{t('Связь')}</span></button>
                  <button className="tb-btn danger" onClick={del} title={t('Удалить связь')}><Trash /><span>{t('Удалить')}</span></button>
                </>
              ) : (
                <>
                  <button className="tb-btn" onClick={addChild} title={t('Новая основная тема')}><Plus /><span>{t('Тема')}</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('map'); setPanel('inspector'); }} title={t('Структура, тема оформления, формы')}><Palette /><span>{t('Оформл.')}</span></button>
                  <button className="tb-btn" onClick={openSearch} title={t('Найти в карте')}><MagnifyingGlass /><span>{t('Поиск')}</span></button>
                  <button className="tb-btn" onClick={() => canvas.current?.fit()} title={t('Вписать в экран')}><CornersOut /><span>{t('Вписать')}</span></button>
                </>
              )}
            </div>
          )}

          {mode === 'map' && showChrome && !touchUI && (
            <div className="ed-toolbar glass">
              {hasSel || selectedRel || !isMobileView ? (
                <>
                  <button className="tb-btn" onClick={addChild} title={t('Подтема (Tab)')}><ArrowElbowDownRight /><span>{t('Подтема')}</span></button>
                  <button className="tb-btn" onClick={addSibling} disabled={!hasSel} title={t('Тема рядом (Enter)')}><Plus /><span>{t('Рядом')}</span></button>
                  <button className="tb-btn" onClick={() => { if (!selId) return; primeKeyboard(); st.setEditing(selId); }} disabled={!hasSel} title={t('Изменить текст (F2)')}><PencilSimple /><span>{t('Текст')}</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('style'); setPanel('inspector'); }} disabled={!hasSel} title={t('Стиль темы: форма, цвет, шрифт')}><Palette /><span>{t('Стиль')}</span></button>
                  <button className={`tb-btn ${relMode ? 'active' : ''}`} onClick={() => (relMode ? setRelMode(false) : startRel())} title={t('Связь')}><BezierCurve weight={relMode ? 'fill' : 'regular'} /><span>{t('Связь')}</span></button>
                  <button className="tb-btn hide-xs" onClick={() => st.addBoundary()} disabled={!hasSel} title={t('Граница')}><Selection /><span>{t('Граница')}</span></button>
                  <button className="tb-btn hide-xs" onClick={() => st.addSummary()} disabled={!hasSel} title={t('Итог')}><BracketsCurly /><span>{t('Итог')}</span></button>
                  <button className="tb-btn" onClick={del} disabled={!selection.some((id) => id !== sheet.root.id) && !selectedRel} title={t('Удалить (Del)')}><Trash /><span>{t('Удалить')}</span></button>
                </>
              ) : (
                <>
                  <button className="tb-btn" onClick={addChild} title={t('Новая основная тема')}><Plus /><span>{t('Тема')}</span></button>
                  <button className="tb-btn" onClick={() => { setInspTab('map'); setPanel('inspector'); }} title={t('Структура, тема оформления, формы')}><Palette /><span>{t('Оформл.')}</span></button>
                </>
              )}
              <span className="tb-sep hide-mobile" />
              <button className="tb-btn show-mobile" onClick={() => st.undo()} disabled={!canUndo}><ArrowCounterClockwise /><span>{t('Отмена')}</span></button>
              {!hasSel && (
                <button className="tb-btn show-mobile" onClick={() => st.redo()} disabled={!canRedo}><ArrowClockwise /><span>{t('Повтор')}</span></button>
              )}
              <button className="tb-btn hide-mobile" onClick={() => canvas.current?.zoomBy(1 / 1.2)} title={t('Уменьшить')}><Minus /></button>
              <button ref={zoomLabel} className="tb-zoom hide-mobile" onClick={() => canvas.current?.setZoom(1)} title="100%">100%</button>
              <button className="tb-btn hide-mobile" onClick={() => canvas.current?.zoomBy(1.2)} title={t('Увеличить')}><Plus /></button>
              <button className={`tb-btn ${hasSel && isMobileView ? 'hide-xs' : ''}`} onClick={() => canvas.current?.fit()} title={t('Вписать (Ctrl+0)')}><CornersOut /><span className="show-mobile-inline">{t('Вписать')}</span></button>
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
                        { icon: <PencilSimple size={16} />, label: t('Переименовать'), onClick: async () => { const title = await askText(t('Название листа'), { value: s.title }); if (title) { st.setActiveSheet(s.id); st.setSheetProps({ title }); } } },
                        { icon: <CopySimple size={16} />, label: t('Дублировать'), onClick: () => st.duplicateSheet(s.id) },
                        ...(doc.sheets.length > 1 ? [{ icon: <Trash size={16} />, label: t('Удалить лист'), danger: true, onClick: async () => { if (await confirmDialog(t('Удалить лист?'), s.title, { danger: true, okText: t('Удалить') })) st.removeSheet(s.id); } }] : []),
                      ],
                    });
                  }}
                  onDoubleClick={async () => {
                    const title = await askText(t('Название листа'), { value: s.title });
                    if (title) st.setSheetProps({ title });
                  }}
                >
                  <StructureIcon id={s.structure} size={22} />
                  {s.title}
                </button>
              ))}
              <button className="sheet-tab add" onClick={() => st.addSheet()} title={t('Новый лист')}><FilePlus size={15} /></button>
            </div>
          )}

          {zen && !pitch && (
            <button className="zen-exit glass" onClick={() => setZen(false)}>
              <X size={16} /> {t('Выйти из Zen')}
            </button>
          )}

          {pitch && (
            <div className="pitch-bar glass">
              <button className="icon-btn" onClick={() => setPitch((p) => (p && p.i > 0 ? { ...p, i: p.i - 1 } : p))} disabled={pitch.i === 0} aria-label={t('Предыдущий слайд')}><CaretLeft /></button>
              <span className="small bold">{pitch.i + 1} / {pitch.slides.length}</span>
              <button className="icon-btn" onClick={() => setPitch((p) => (p && p.i < p.slides.length - 1 ? { ...p, i: p.i + 1 } : p))} disabled={pitch.i >= pitch.slides.length - 1} aria-label={t('Следующий слайд')}><CaretRight /></button>
              <button className="icon-btn" onClick={endPitch} aria-label={t('Закончить показ')}><X /></button>
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
      {shareOpen && (
        <Suspense fallback={null}>
          <ShareDialog docId={doc.id} title={doc.title} locked={!!password} onClose={() => setShareOpen(false)} />
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
  ['Tab', t('Подтема')],
  ['Enter', t('Тема рядом')],
  ['Shift+Enter', t('Тема рядом (выше)')],
  ['Ctrl+Enter', t('Родительская тема')],
  [t('F2 / Пробел / любая буква'), t('Редактировать текст')],
  ['Delete', t('Удалить')],
  [t('Стрелки'), t('Перемещение по карте')],
  ['Ctrl+↑/↓', t('Переместить тему выше/ниже')],
  ['Ctrl+/', t('Свернуть / развернуть')],
  ['Alt+1…9 / Alt+0', t('Показать 1…9 уровней / все')],
  ['Alt+F', t('Фокус на ветке / вся карта')],
  ['Ctrl+C / X / V / D', t('Копировать / вырезать / вставить / дублировать')],
  ['Ctrl+Z / Ctrl+Shift+Z', t('Отменить / повторить')],
  ['Ctrl+B / Ctrl+I', t('Жирный / курсив')],
  ['Ctrl+F', t('Поиск')],
  ['Ctrl+0 / Ctrl+= / Ctrl+-', t('Вписать / увеличить / уменьшить')],
  ['Ctrl+S', t('Сохранить карту')],
  ['Ctrl+E', t('Режим Zen')],
  [t('Двойной клик по фону'), t('Плавающая тема')],
  [t('Перетаскивание темы'), t('Переместить (на тему — вложить, на пустое место — открепить)')],
  [t('Shift + перетаскивание по фону'), t('Выделить рамкой')],
  [t('Колесо / Ctrl+колесо'), t('Прокрутка / масштаб')],
];

function KeysHelp({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{t('Горячие клавиши')}</h2>
        <div className="col" style={{ gap: 6, marginTop: 12 }}>
          {KEYS.map(([k, v]) => (
            <div key={k} className="row small">
              <span className="kbd-chip">{k}</span>
              <span className="muted">{v}</span>
            </div>
          ))}
        </div>
        <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>{t('Понятно')}</button></div>
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
