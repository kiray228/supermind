/**
 * Индикатор неотправленных изменений — виден из любого раздела, но только когда есть повод:
 * правки дольше минуты не дошли до облака, нет связи или ошибка синхронизации.
 * Компьютер — строка в боковой панели; телефон — точка на вкладке «Ещё» и строка в меню «Ещё».
 * Нажатие открывает «Настройки» на карточке синхронизации.
 */
import { useEffect, useState } from 'react';
import { ArrowsClockwise, CloudArrowUp, CloudSlash, CloudWarning } from '@phosphor-icons/react';
import { useApp } from '../store/appStore';
import { usePendingSync } from '../store/pending';
import './sync-badge.css';

/** Правки моложе этого не тревожат: обычно уходят сами за несколько секунд */
const STALE = 60_000;

type Kind = 'offline' | 'error' | 'pending';

function useSyncAlert(): { kind: Kind | null; count: number; syncing: boolean } {
  const { account, count, since, problem, syncing } = usePendingSync();
  // один таймер до момента «прошла минута» — без опроса
  const [staleSince, setStaleSince] = useState<number>();
  useEffect(() => {
    if (!count || !since) return;
    const t = setTimeout(() => setStaleSince(since), Math.max(0, since + STALE - Date.now()));
    return () => clearTimeout(t);
  }, [count, since]);
  let kind: Kind | null = null;
  if (account) {
    if (problem) kind = problem;
    else if (count && since && staleSince === since) kind = 'pending';
  }
  return { kind, count, syncing };
}

/** Открыть «Настройки» и показать карточку синхронизации */
function openSyncSettings() {
  useApp.getState().go('settings');
  let tries = 0;
  const find = () => {
    const el = document.querySelector('.acc-sync');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else if (++tries < 40) setTimeout(find, 50); // раздел подгружается
  };
  setTimeout(find, 0);
}

const ICON = { offline: CloudSlash, error: CloudWarning, pending: CloudArrowUp };

function label(kind: Kind) {
  if (kind === 'error') return 'Ошибка синхронизации';
  if (kind === 'offline') return 'Нет связи';
  return 'Не отправлено';
}

function hint(kind: Kind, count: number) {
  if (kind === 'error') return 'Изменения не отправлены. Нажмите, чтобы посмотреть';
  if (kind === 'offline') return count ? `Нет связи — ${count} изм. отправим, когда появится интернет` : 'Нет связи с облаком';
  return `Не отправлено в облако: ${count} изм.`;
}

function Ico({ kind, syncing, size }: { kind: Kind; syncing: boolean; size: number }) {
  const I = syncing ? ArrowsClockwise : ICON[kind];
  return <I size={size} weight={syncing ? 'bold' : 'fill'} className={syncing ? 'spin' : undefined} />;
}

/** Строка в боковой панели (только компьютер) */
export function SyncNavButton() {
  const { kind, count, syncing } = useSyncAlert();
  if (!kind) return null;
  return (
    <button className={`nav-item nav-desk nav-sync ${kind}`} onClick={openSyncSettings} title={hint(kind, count)}>
      <span className="nav-ico">
        <Ico kind={kind} syncing={syncing} size={22} />
      </span>
      <span>{label(kind)}</span>
      {!!count && <span className="nav-sync-n">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

/** Точка на вкладке «Ещё» (телефон): «Настройки» — внутри этого меню */
export function SyncDot() {
  const { kind, count } = useSyncAlert();
  if (!kind) return null;
  return <i className={`nav-sync-dot ${kind}`} role="status" aria-label={hint(kind, count)} />;
}

/** Строка в меню «Ещё» (телефон) */
export function SyncSheetRow({ onPick }: { onPick: () => void }) {
  const { kind, count, syncing } = useSyncAlert();
  if (!kind) return null;
  return (
    <button
      className={`sync-sheet-row ${kind}`}
      onClick={() => {
        onPick();
        openSyncSettings();
      }}
    >
      <Ico kind={kind} syncing={syncing} size={20} />
      <span className="sync-sheet-text">
        {label(kind)}
        {!!count && <span className="sync-sheet-sub"> · {count > 99 ? '99+' : count} изм.</span>}
      </span>
      <span className="sync-sheet-go">Подробнее</span>
    </button>
  );
}
