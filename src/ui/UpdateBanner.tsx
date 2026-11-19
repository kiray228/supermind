import { ArrowClockwise, DownloadSimple, X } from '@phosphor-icons/react';
import { applyUpdate, dismissUpdate, useAppUpdate } from './appUpdate';
import { t } from '../i18n/index';

/** «Доступна новая версия»: сайт — перезагрузить, Android (APK с сайта) — скачать новый APK */
export function UpdateBanner() {
  const update = useAppUpdate((s) => s.update);
  const dismissed = useAppUpdate((s) => s.dismissed);
  if (!update || (update.version && update.version === dismissed)) return null;
  const apk = update.kind === 'apk';
  return (
    <div className="upd-banner" role="status">
      <div className="upd-icon">{apk ? <DownloadSimple weight="bold" /> : <ArrowClockwise weight="bold" />}</div>
      <div className="upd-text">
        <b>{update.version ? t('Новая версия {version}', { version: update.version }) : t('Доступно обновление')}</b>
        <span>{apk ? t('Ставится поверх — карты и задачи останутся') : t('Несохранённое сохранится само')}</span>
      </div>
      <button className="upd-go" onClick={() => void applyUpdate()}>
        {apk ? t('Скачать') : t('Обновить')}
      </button>
      <button className="icon-btn upd-close" onClick={dismissUpdate} aria-label={t('Не сейчас')} title={t('Не сейчас')}>
        <X size={16} weight="bold" />
      </button>
    </div>
  );
}
