import { useEffect, useState } from 'react';
import { t } from '../../i18n/index';
import { AtSign, ChevronRight, Copy, Link2 } from 'lucide-react';
import type { ID } from '../../types';
import { toast } from '../../store/appStore';
import { confirmDialog } from '../../ui/dialogs';
import { openItem } from '../brain';
import { brainItem, useLinks } from '../related';
import { type Backlink, findBacklinks, linkMention, markNotDuplicate, mergeNotes, noteDuplicates } from '../mentionsRuntime';
import { KIND_ICON } from './kindIcons';

const SHOW = 5;

/** «Упоминается в»: кто ссылается на эту запись или упоминает её название без ссылки */
export function Backlinks({ id }: { id: ID }) {
  const rev = useLinks((s) => s.rev);
  const [list, setList] = useState<Backlink[] | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void findBacklinks(id)
        .then((l) => alive && setList(l))
        .catch(() => alive && setList([]));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [id, rev]);

  if (!list?.length) return null;
  const title = brainItem(id)?.title ?? '';
  const shown = all ? list : list.slice(0, SHOW);
  const unlinked = list.filter((b) => b.count > 0 && b.at).length;

  const makeLink = async (b: Backlink) => {
    if (!b.at) return;
    setBusy(b.id);
    const ok = await linkMention(b.id, b.at, title).catch(() => false);
    setBusy(null);
    toast(ok ? t('В «{title}» теперь ссылка', { title: b.title || t('Без названия') }) : t('Упоминание не нашлось — заметку уже изменили'));
  };

  return (
    <div className="nt-bl" aria-label={t('Упоминается в')}>
      <div className="nt-rel-head">
        <AtSign size={16} />
        <span>{t('Упоминается в')}</span>
        <span className="nt-rel-count">{list.length}</span>
        <div className="grow" />
        {unlinked > 1 && (
          <button
            className="nt-rel-graph"
            onClick={async () => {
              for (const b of list) if (b.at && b.count) await makeLink(b);
            }}
            title={t('Сделать ссылками все упоминания без ссылки')}
          >
            {t('Все — ссылками')}
          </button>
        )}
      </div>
      <div className="nt-rel-list">
        {shown.map((b) => {
          const Icon = KIND_ICON[b.kind];
          return (
            <div key={b.id} className="nt-bl-item">
              <button className="nt-bl-main" onClick={() => void openItem(b.id, { fromNote: true })}>
                <span className="nt-rel-title">
                  {b.kind !== 'note' && <Icon size={14} className="nt-rel-kind" />}
                  {b.title || t('Без названия')}
                </span>
                {b.snippet ? (
                  <span className="nt-bl-snip">
                    {b.snippet.before}
                    <mark>{b.snippet.match}</mark>
                    {b.snippet.after}
                  </span>
                ) : (
                  <span className="nt-rel-why">
                    <span className="nt-rel-wiki">
                      <Link2 size={11} />
                      {t('ссылка')}
                    </span>
                    {t('ссылается на эту заметку')}
                  </span>
                )}
              </button>
              {b.at && b.count > 0 ? (
                <button className="nt-ai-btn nt-bl-link" disabled={busy === b.id} onClick={() => void makeLink(b)} title={t('Заменить упоминание ссылкой [[…]]')}>
                  <Link2 size={13} /> {t('Ссылкой')}
                </button>
              ) : (
                <ChevronRight size={16} className="nt-rel-go" />
              )}
            </div>
          );
        })}
      </div>
      {list.length > SHOW && (
        <button className="nt-ai-undo" onClick={() => setAll(!all)}>
          {all ? t('Свернуть') : t('Показать все ({n})', { n: list.length })}
        </button>
      )}
    </div>
  );
}

/** «Похоже на дубль» — почти та же заметка: открыть, объединить или отметить, что это не дубль */
export function DuplicateBanner({ id }: { id: ID }) {
  const rev = useLinks((s) => s.rev);
  const [dups, setDups] = useState<{ id: string; score: number }[]>([]);
  useEffect(() => {
    // индекс уже собран панелью связей — дубли считаются сразу по нему
    const t = setTimeout(() => setDups(noteDuplicates(id)), 0);
    return () => clearTimeout(t);
  }, [id, rev]);

  const d = dups[0];
  const other = d ? brainItem(d.id) : undefined;
  if (!d || !other) return null;
  const name = other.title || t('Без названия');

  return (
    <div className="nt-dup" role="status">
      <Copy size={16} className="nt-dup-ic" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="nt-dup-title">
          {t('Похоже на дубль:')} <button onClick={() => void openItem(d.id, { fromNote: true })}>«{name}»</button>
        </div>
        <div className="nt-dup-sub">{t('Совпадение {n}% — почти те же слова и темы', { n: Math.round(d.score * 100) })}</div>
        <div className="nt-dup-actions">
          <button
            className="nt-ai-btn"
            onClick={async () => {
              const ok = await confirmDialog(t('Объединить с «{name}»?', { name }), t('Текст «{name}» добавится в конец этой заметки, а сама «{name}» уйдёт в корзину (её можно вернуть). Ссылки на неё будут вести сюда.', { name }), {
                okText: t('Объединить'),
              });
              if (!ok) return;
              await mergeNotes(id, d.id);
              setDups([]);
            }}
          >
            {t('Объединить')}
          </button>
          <button
            className="nt-ai-undo"
            onClick={() => {
              markNotDuplicate(id, d.id);
              setDups(dups.slice(1));
            }}
          >
            {t('Это не дубль')}
          </button>
        </div>
      </div>
    </div>
  );
}
