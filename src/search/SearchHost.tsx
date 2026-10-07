/**
 * Поиск по всему (Ctrl/⌘+K, «/»): лёгкая часть — состояние, горячие клавиши, кнопки.
 * Само окно и индекс загружаются отдельно, при первом открытии.
 */
import { lazy, Suspense, useEffect } from 'react';
import { Search } from 'lucide-react';
import { useApp } from '../store/appStore';
import { hasOverlay } from '../ui/dialogs';
import { closeSearch, openSearch, SEARCH_KBD, useSearchUi } from './state';
import './search.css';

const loadPalette = () => import('./Palette');
const Palette = lazy(loadPalette);
const NewGoal = lazy(() => import('./NewGoal'));

function editable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

export function SearchHost() {
  const open = useSearchUi((s) => s.open);
  const newGoal = useSearchUi((s) => s.newGoal);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
        e.preventDefault();
        if (useSearchUi.getState().open) closeSearch();
        else if (!hasOverlay()) openSearch();
        return;
      }
      // «/» (в русской раскладке та же клавиша даёт «.»)
      if ((e.key === '/' || (e.code === 'Slash' && e.key === '.')) && !mod && !e.altKey && !editable(e.target) && !hasOverlay() && !useSearchUi.getState().open && useApp.getState().view !== 'editor') {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    // окно поиска подгружается заранее — открывается мгновенно
    const t = setTimeout(() => void loadPalette().catch(() => {}), 2500);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, []);

  return (
    <>
      {open && (
        <Suspense fallback={<Shell />}>
          <Palette />
        </Suspense>
      )}
      {newGoal && (
        <Suspense fallback={null}>
          <NewGoal />
        </Suspense>
      )}
    </>
  );
}

/** Пока окно загружается (первое открытие): поле уже принимает ввод */
function Shell() {
  return (
    <div className="modal-backdrop sr-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeSearch()}>
      <div className="sr-panel">
        <div className="sr-head">
          <Search className="sr-head-ico" size={19} />
          <input
            className="sr-input"
            type="search"
            autoFocus
            defaultValue={useSearchUi.getState().initial}
            placeholder="Поиск по картам, задачам, заметкам…"
            onChange={(e) => useSearchUi.setState({ initial: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

/** Пункт «Поиск» в боковой панели (компьютер) */
export function SearchNavButton() {
  return (
    <button className="nav-item nav-desk sr-nav" onClick={() => openSearch()} title={`Поиск по всему (${SEARCH_KBD})`}>
      <span className="nav-ico">
        <Search size={20} />
      </span>
      <span>Поиск</span>
      <kbd className="sr-nav-kbd">{SEARCH_KBD}</kbd>
    </button>
  );
}

/** Строка поиска в меню «Ещё» (телефон) */
export function SearchSheetButton({ onPick }: { onPick: () => void }) {
  return (
    <button
      className="sr-sheet-btn"
      onClick={() => {
        onPick();
        openSearch();
      }}
    >
      <Search size={19} />
      <span>Поиск по всему</span>
    </button>
  );
}
