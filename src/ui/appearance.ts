/** Внешний вид: цвет акцента, фон и сила эффекта Liquid Glass */

export interface AccentOption {
  id: string;
  name: string;
  color: string;
  /** второй цвет для градиентов */
  color2: string;
}

export const ACCENTS: AccentOption[] = [
  { id: 'flame', name: 'Огонь', color: '#ff4a2b', color2: '#ff9a3d' },
  { id: 'ocean', name: 'Океан', color: '#2f6bff', color2: '#22c1ee' },
  { id: 'violet', name: 'Фиалка', color: '#7c4dff', color2: '#d946ef' },
  { id: 'emerald', name: 'Изумруд', color: '#10a36b', color2: '#5fd68f' },
  { id: 'rose', name: 'Роза', color: '#e8336d', color2: '#ff8fb1' },
  { id: 'amber', name: 'Янтарь', color: '#e08600', color2: '#ffc93c' },
  { id: 'teal', name: 'Лагуна', color: '#0d9488', color2: '#38bdf8' },
  { id: 'graphite', name: 'Графит', color: '#475569', color2: '#94a3b8' },
];

export type GlassLevel = 'soft' | 'liquid';
export type BackdropStyle = 'gradient' | 'aurora' | 'plain';

export function applyAppearance(o: { accent?: string; glass?: GlassLevel; backdrop?: BackdropStyle }) {
  const root = document.documentElement;
  const a = ACCENTS.find((x) => x.id === o.accent) ?? ACCENTS[0];
  root.style.setProperty('--accent', a.color);
  root.style.setProperty('--accent-2', a.color2);
  root.dataset.accent = a.id;
  root.dataset.glass = o.glass ?? 'liquid';
  root.dataset.backdrop = o.backdrop ?? 'aurora';
}
