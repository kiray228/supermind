import { useEffect, useState, type ReactNode } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { installMode, installPwa, onInstallChange, WINDOWS_SETUP_URL } from '../platform';
import { toast } from '../store/appStore';

/** «Установить приложение»: из браузера в один клик, а где браузер не умеет — скачать программу для Windows */
export function InstallAppButton({ className, iconSize = 16, label = 'Установить приложение' }: { className: string; iconSize?: number; label?: ReactNode }) {
  const [mode, setMode] = useState(installMode);
  useEffect(() => onInstallChange(() => setMode(installMode())), []);
  if (!mode) return null;
  const install = () => {
    if (mode === 'exe') {
      location.href = WINDOWS_SETUP_URL;
      return;
    }
    void installPwa().then((ok) => ok && toast('SuperMind установлен — ярлык на рабочем столе и в меню «Пуск»'));
  };
  return (
    <button type="button" className={className} onClick={install} title={mode === 'pwa' ? 'Ярлык на рабочем столе, отдельное окно, работает офлайн' : 'Программа SuperMind для Windows'}>
      <DownloadSimple size={iconSize} weight="bold" /> {label}
    </button>
  );
}
