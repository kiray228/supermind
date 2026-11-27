/** «Доступные мне»: чужие карты, открытые по ссылкам, — в списке карт с именем владельца */
import { useEffect, useMemo } from 'react';
import { Eye, MoreHorizontal, Pencil, Users } from 'lucide-react';
import { useApp, toast } from '../store/appStore';
import { useCloud } from '../store/cloud';
import { useLongPress } from '../ui/gestures';
import { confirmDialog } from '../ui/dialogs';
import { MapThumb } from '../views/MapThumb';
import { t } from '../i18n/index';
import { cachedShared, cacheShared, leaveShare, type SharedMap } from './api';
import { openSharedMap, refreshSharedList } from './open';
import './share.css';

export function SharedMaps({ q }: { q: string }) {
  const account = useCloud((s) => s.account);
  const docsVersion = useApp((s) => s.docsVersion);
  // список обновляет refreshSharedList (и сигналит через docsVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => (account ? cachedShared() : []), [account, docsVersion]);
  useEffect(() => {
    if (account) void refreshSharedList();
  }, [account]);

  if (!account) return null;
  const ql = q.trim().toLowerCase();
  // одна карта по двум ссылкам (просмотр и правка) — одной карточкой, с правом правки
  const byDoc = new Map<string, SharedMap>();
  for (const m of list) if (!byDoc.has(m.docId) || m.role === 'edit') byDoc.set(m.docId, m);
  const shown = [...byDoc.values()].filter((m) => !ql || m.title.toLowerCase().includes(ql) || m.owner.name.toLowerCase().includes(ql));
  if (!shown.length) return null;

  const remove = async (m: SharedMap) => {
    if (!(await confirmDialog(t('Убрать из списка?'), t('Карта «{name}» останется у владельца, а снова открыть её можно по той же ссылке.', { name: m.title || t('Без названия') }), { okText: t('Убрать') })))
      return;
    try {
      const same = list.filter((x) => x.docId === m.docId);
      for (const x of same) await leaveShare(x.token);
      const next = list.filter((x) => x.docId !== m.docId);
      cacheShared(next);
      useApp.setState({ docsVersion: Date.now() });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="home-shared-bar">
        <Users size={18} className="faint" />
        <h2 className="home-h2">{t('Доступные мне')}</h2>
      </div>
      <div className="doc-grid">
        {shown.map((m) => (
          <SharedCard key={m.token} m={m} onOpen={() => void openSharedMap(m.token)} onRemove={() => void remove(m)} />
        ))}
      </div>
    </>
  );
}

function SharedCard({ m, onOpen, onRemove }: { m: SharedMap; onOpen: () => void; onRemove: () => void }) {
  const press = useLongPress(onRemove);
  const who = t('Владелец: {name}', { name: m.owner.name });
  return (
    <div
      className="doc-card"
      onClick={onOpen}
      {...press}
      role="button"
      tabIndex={0}
      aria-label={t('Открыть карту «{name}»', { name: m.title || t('Без названия') }) + ' · ' + who}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="doc-thumb" style={{ ['--acc' as string]: 'var(--accent)' }}>
        <MapThumb accent="var(--accent)" />
        <span className="doc-owner">
          <Users size={12} /> {m.owner.name}
        </span>
      </div>
      <div className="doc-info">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="bold ellipsis">{m.title || t('Без названия')}</div>
          <div className="tiny faint ellipsis">
            {m.role === 'edit' ? <Pencil size={11} /> : <Eye size={11} />} {m.role === 'edit' ? t('Можно править') : t('Только просмотр')} · {who}
          </div>
        </div>
        <button
          className="icon-btn"
          aria-label={t('Убрать из списка')}
          title={t('Убрать из списка')}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}
