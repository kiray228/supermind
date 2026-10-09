import { useEffect, useState, type ReactNode } from 'react';
import { DownloadSimple, WindowsLogo } from '@phosphor-icons/react';
import { installMode, installPwa, onInstallChange, WINDOWS_SETUP_URL } from '../platform';
import { toast } from '../store/appStore';

/** На Windows — «Скачать для Windows» (установщик SuperMind), на других системах — установка из браузера */
export function InstallAppButton({ className, iconSize = 16, wrap }: { className: string; iconSize?: number; wrap?: (label: string) => ReactNode }) {
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
  const label = mode === 'exe' ? 'Скачать для Windows' : 'Установить приложение';
  return (
    <button type="button" className={className} onClick={install} title={mode === 'exe' ? 'Установщик SuperMind: ярлык на рабочем столе и в меню «Пуск»' : 'Ярлык на рабочем столе, отдельное окно, работает офлайн'}>
      {mode === 'exe' ? <WindowsLogo size={iconSize} weight="fill" /> : <DownloadSimple size={iconSize} weight="bold" />} {wrap ? wrap(label) : label}
    </button>
  );
}
