/** Настройки → Оформление → «Иконка приложения»: сетка вариантов (только в приложениях для iPhone и Android) */
import { useEffect, useState } from 'react';
import { appIconPreview, appIconSupported, APP_ICONS, currentAppIcon, setAppIcon, type AppIconId } from '../native/appIcon';
import { isAndroidApp } from '../platform';
import { toast } from '../store/appStore';
import { t } from '../i18n/index';
import { ListCell, ListRow } from './list';
import './appIcon.css';

export function AppIconPicker() {
  const [cur, setCur] = useState<AppIconId | null>(null);
  const [busy, setBusy] = useState(false);
  const native = appIconSupported();

  useEffect(() => {
    if (!native) return;
    let alive = true;
    void currentAppIcon().then((r) => alive && setCur(r.supported ? r.id : null));
    return () => {
      alive = false;
    };
  }, [native]);

  // в браузере и на компьютере строки нет
  if (!native || !cur) return null;

  const pick = async (id: AppIconId) => {
    if (busy || id === cur) return;
    setBusy(true);
    try {
      await setAppIcon(id);
      setCur(id);
      // Android: лаунчеру нужно несколько секунд
      if (isAndroidApp()) toast(t('Иконка сменится через несколько секунд'));
    } catch {
      toast(t('Не удалось сменить иконку'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ListRow title={t('Иконка приложения')} subtitle={t('Как SuperMind выглядит на экране «Домой»')} />
      <ListCell>
        <div className="ai-grid" role="radiogroup" aria-label={t('Иконка приложения')}>
          {APP_ICONS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={cur === x.id}
              className={`ai-item${cur === x.id ? ' active' : ''}`}
              disabled={busy}
              onClick={() => void pick(x.id)}
            >
              <img src={appIconPreview(x.id)} alt="" width={56} height={56} loading="lazy" />
              <span>{x.name}</span>
            </button>
          ))}
        </div>
      </ListCell>
    </>
  );
}
