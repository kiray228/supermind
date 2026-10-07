import { useState } from 'react';
import { CloudUpload, X } from 'lucide-react';
import { useCloud } from '../store/cloud';
import { useApp } from '../store/appStore';

const KEY = 'sm-nudge-off';
const WEEK = 7 * 86400000;

function hiddenUntil(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Напоминание без аккаунта: данные только на устройстве — предложить облако */
export function AccountNudge() {
  const { account, ready } = useCloud();
  const go = useApp((s) => s.go);
  const [hidden, setHidden] = useState(() => hiddenUntil() > Date.now());
  if (!ready || account || hidden) return null;
  return (
    <div className="nudge">
      <CloudUpload size={20} />
      <button className="nudge-text" onClick={() => go('settings')}>
        <b>Не потеряйте карты и задачи</b>
        <span>Создайте аккаунт — всё будет храниться в облаке и на всех устройствах</span>
      </button>
      <button
        className="icon-btn"
        aria-label="Скрыть"
        onClick={() => {
          try {
            localStorage.setItem(KEY, String(Date.now() + WEEK));
          } catch {
            /* приватный режим */
          }
          setHidden(true);
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
