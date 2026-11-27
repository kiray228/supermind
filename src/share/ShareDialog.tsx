/**
 * «Поделиться картой»: ссылка «только смотреть» или «можно править» (как в Canva).
 * У каждой роли одна действующая ссылка; её можно скопировать, отправить или отключить.
 */
import { useEffect, useState } from 'react';
import { Copy, Eye, LinkSimple, PencilSimple, ShareNetwork, Trash, X } from '@phosphor-icons/react';
import { useCloud, syncNow } from '../store/cloud';
import { flushSave } from '../store/docStore';
import { toast } from '../store/appStore';
import { isNative } from '../platform';
import { t, tn } from '../i18n/index';
import { createShare, listShares, revokeShare, shareUrl, type ShareLink, type ShareRole } from './api';
import './share.css';

export default function ShareDialog({ docId, title, locked, onClose }: { docId: string; title: string; locked?: boolean; onClose: () => void }) {
  const account = useCloud((s) => s.account);
  const [role, setRole] = useState<ShareRole>('view');
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = () =>
    listShares(docId)
      .then(setLinks)
      .catch((e) => {
        setLinks([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  useEffect(() => {
    if (account && !locked) void reload();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const current = links?.find((l) => l.role === role);

  const make = async () => {
    setBusy(true);
    setError('');
    try {
      // карта должна быть в облаке: сначала сохранить и отправить последние правки
      await flushSave();
      await syncNow().catch(() => {});
      const r = await createShare(docId, role);
      await reload();
      await send(r.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      toast(t('Ссылка скопирована'));
    } catch {
      toast(t('Не удалось скопировать'));
    }
  };

  /** Отправить: на телефоне — системное меню «Поделиться», на компьютере — копировать */
  const send = async (token: string) => {
    const url = shareUrl(token);
    const text = t('Карта «{title}» в SuperMind', { title: title || t('Без названия') });
    if (isNative()) {
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: text, text, url });
        return;
      } catch {
        /* отменили или нет меню — копируем */
      }
    } else if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    await copy(token);
  };

  const revoke = async (l: ShareLink) => {
    try {
      await revokeShare(l.token);
      toast(t('Ссылка отключена — по ней карту больше не открыть'));
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const ROLES: { id: ShareRole; icon: typeof Eye; title: string; text: string }[] = [
    { id: 'view', icon: Eye, title: t('Только просмотр'), text: t('Видят карту и её обновления, но ничего не меняют') },
    { id: 'edit', icon: PencilSimple, title: t('Может редактировать'), text: t('Меняют карту вместе с вами — правки видны всем') },
  ];

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal share-dlg" role="dialog" aria-label={t('Поделиться картой')}>
        <div className="row">
          <h2 className="grow">{t('Поделиться картой')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Закрыть')}>
            <X />
          </button>
        </div>

        {!account ? (
          <p className="share-note">{t('Войдите в аккаунт, чтобы делиться картами по ссылке: Настройки → «Аккаунт и синхронизация».')}</p>
        ) : locked ? (
          <p className="share-note">{t('Карту с паролем нельзя открыть по ссылке — сначала снимите пароль.')}</p>
        ) : (
          <>
            <p className="share-note">{t('Кто откроет ссылку, увидит эту карту у себя в «Картах» с вашим именем. Карта остаётся вашей.')}</p>
            <div className="share-roles" role="radiogroup" aria-label={t('Что можно по ссылке')}>
              {ROLES.map((r) => (
                <button key={r.id} role="radio" aria-checked={role === r.id} className={`share-role${role === r.id ? ' on' : ''}`} onClick={() => setRole(r.id)}>
                  <r.icon size={22} weight={role === r.id ? 'fill' : 'regular'} />
                  <span className="share-role-text">
                    <b>{r.title}</b>
                    <span>{r.text}</span>
                  </span>
                </button>
              ))}
            </div>

            {current ? (
              <div className="share-link">
                <LinkSimple size={18} className="faint" />
                <input readOnly value={shareUrl(current.token)} onFocus={(e) => e.target.select()} aria-label={t('Ссылка')} />
                <button className="icon-btn" onClick={() => void copy(current.token)} aria-label={t('Копировать ссылку')} title={t('Копировать')}>
                  <Copy size={18} />
                </button>
              </div>
            ) : null}
            <button className="btn btn-primary share-go" disabled={busy || links === null} onClick={() => (current ? void send(current.token) : void make())}>
              <ShareNetwork size={18} weight="bold" /> {busy ? t('Создаю ссылку…') : current ? t('Отправить ссылку') : t('Создать ссылку')}
            </button>
            {error && <div className="share-error">{error}</div>}

            {links && links.length > 0 && (
              <div className="share-active">
                <div className="share-h">{t('Действующие ссылки')}</div>
                {links.map((l) => (
                  <div key={l.token} className="share-item">
                    {l.role === 'edit' ? <PencilSimple size={18} /> : <Eye size={18} />}
                    <span className="grow">
                      <b>{l.role === 'edit' ? t('Может редактировать') : t('Только просмотр')}</b>
                      <span className="share-sub">{l.people ? t('Открыли: {n}', { n: l.people }) + ' ' + tn(l.people, 'человек', 'человека', 'человек') : t('Ещё никто не открывал')}</span>
                    </span>
                    <button className="btn btn-sm" onClick={() => void revoke(l)}>
                      <Trash size={15} /> {t('Отключить')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
