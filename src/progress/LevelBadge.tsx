import { useId } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../store/appStore';
import { useLevel } from './hooks';
import './level.css';

/** Кольцо прогресса уровня (градиент акцентного цвета) */
export function LevelRing({ pct, size = 96, stroke = 8, children }: { pct: number; size?: number; stroke?: number; children?: ReactNode }) {
  const id = 'lvlg' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return (
    <span className="lvl-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--accent-2)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--accent)' }} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="lvl-ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${len * p} ${len}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="lvl-ring-bar"
          opacity={p > 0 ? 1 : 0}
        />
      </svg>
      <span className="lvl-ring-inner">{children}</span>
    </span>
  );
}

/**
 * Значок уровня: кольцо с номером и (необязательно) звание.
 * По нажатию открывает раздел «Прогресс». Пока данные загружаются — ничего не показывает.
 */
export function LevelBadge({ compact = false, onClick, className = '' }: { compact?: boolean; onClick?: () => void; className?: string }) {
  const lv = useLevel();
  if (!lv) return null;
  return (
    <button
      type="button"
      className={`lvl-badge${compact ? ' compact' : ''} ${className}`}
      onClick={onClick ?? (() => useApp.getState().go('progress'))}
      title={`Уровень ${lv.level} · ${lv.title} · ${lv.xp.toLocaleString('ru-RU')} XP`}
    >
      <LevelRing pct={lv.pct} size={compact ? 24 : 28} stroke={3}>
        <b>{lv.level}</b>
      </LevelRing>
      {!compact && (
        <span className="lvl-badge-text">
          <span className="lvl-badge-title">{lv.title}</span>
          <span className="lvl-badge-xp">{lv.cur.toLocaleString('ru-RU')} / {lv.need.toLocaleString('ru-RU')} XP</span>
        </span>
      )}
    </button>
  );
}
