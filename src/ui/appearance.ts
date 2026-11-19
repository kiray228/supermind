/** Внешний вид: цвет акцента, фон и сила эффекта Liquid Glass */
import { t } from '../i18n/index';

export interface AccentOption {
  id: string;
  name: string;
  color: string;
  /** второй цвет для градиентов */
  color2: string;
  /** вариант для тёмной темы (как системные цвета iOS — чуть светлее) */
  dark?: string;
}

/** Акцент по умолчанию */
export const DEFAULT_ACCENT = 'apple';

export const ACCENTS: AccentOption[] = [
  { id: 'apple', name: t('Стандарт'), color: '#007aff', color2: '#5ac8fa', dark: '#0a84ff' },
  { id: 'emerald', name: t('Изумруд'), color: '#0c9f6e', color2: '#34d399', dark: '#30d494' },
  { id: 'flame', name: t('Огонь'), color: '#ff4a2b', color2: '#ff9a3d', dark: '#ff5a3c' },
  { id: 'ocean', name: t('Океан'), color: '#2f6bff', color2: '#22c1ee', dark: '#4c82ff' },
  { id: 'violet', name: t('Фиалка'), color: '#7c4dff', color2: '#d946ef', dark: '#9b75ff' },
  { id: 'rose', name: t('Роза'), color: '#e8336d', color2: '#ff8fb1', dark: '#ff4f86' },
  { id: 'amber', name: t('Янтарь'), color: '#e08600', color2: '#ffc93c', dark: '#ff9f0a' },
  { id: 'teal', name: t('Лагуна'), color: '#0d9488', color2: '#38bdf8', dark: '#2bb5a7' },
  { id: 'graphite', name: t('Графит'), color: '#475569', color2: '#94a3b8', dark: '#8e9aae' },
];

export type GlassLevel = 'soft' | 'liquid';
export type BackdropStyle = 'gradient' | 'aurora' | 'plain';

export function applyAppearance(o: { accent?: string; glass?: GlassLevel; backdrop?: BackdropStyle }) {
  const root = document.documentElement;
  const a = ACCENTS.find((x) => x.id === o.accent) ?? ACCENTS.find((x) => x.id === DEFAULT_ACCENT)!;
  // цвет для светлой и тёмной темы выбирает CSS (src/ui/appearance.css)
  root.style.removeProperty('--accent');
  root.style.setProperty('--accent-l', a.color);
  root.style.setProperty('--accent-d', a.dark ?? a.color);
  root.style.setProperty('--accent-2', a.color2);
  root.dataset.accent = a.id;
  root.dataset.glass = o.glass ?? 'liquid';
  root.dataset.backdrop = o.backdrop ?? 'aurora';
}
