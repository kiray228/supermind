import { ArrowClockwise, DownloadSimple, X } from '@phosphor-icons/react';
import { applyUpdate, dismissUpdate, useAppUpdate } from './appUpdate';

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
        <b>{update.version ? `Новая версия ${update.version}` : 'Доступно обновление'}</b>
        <span>{apk ? 'Ставится поверх — карты и задачи останутся' : 'Несохранённое сохранится само'}</span>
      </div>
      <button className="upd-go" onClick={() => void applyUpdate()}>
        {apk ? 'Скачать' : 'Обновить'}
      </button>
      <button className="icon-btn upd-close" onClick={dismissUpdate} aria-label="Не сейчас" title="Не сейчас">
        <X size={16} weight="bold" />
      </button>
    </div>
  );
}
