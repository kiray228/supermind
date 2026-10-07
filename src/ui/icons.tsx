/** Общие иконки разделов (Phosphor) и цветные «плитки» в стиле iOS — для меню, «Ещё» и шапок разделов */
import type { CSSProperties } from 'react';
import { SquaresFour, type Icon, type IconWeight } from '@phosphor-icons/react';
import { SECTION_ICONS, SECTION_TONES, TONES, type SectionId, type Tone } from './sections';

export { SECTION_ICONS, SECTION_TONES, TONES };
export type { SectionId, Tone };

const TILE_PX = { xs: 26, list: 29, sm: 32, md: 40, lg: 56 } as const;
export type TileSize = keyof typeof TILE_PX;

interface TileProps {
  /** раздел — задаёт иконку и цвет */
  section?: SectionId;
  /** своя иконка (вместо иконки раздела) */
  icon?: Icon;
  /** свой цвет (вместо цвета раздела) */
  tone?: Tone;
  size?: TileSize;
  weight?: IconWeight;
  className?: string;
}

/** Скруглённая плитка с градиентом и белой иконкой — как в «Настройках» iPhone */
export function IconTile({ section, icon, tone, size = 'md', weight = 'fill', className }: TileProps) {
  const I = icon ?? (section ? SECTION_ICONS[section] : SquaresFour);
  const [c1, c2] = TONES[tone ?? (section ? SECTION_TONES[section] : 'accent')];
  const px = TILE_PX[size];
  const style = { '--t1': c1, '--t2': c2, '--tile': `${px}px` } as CSSProperties;
  return (
    <span className={`itile itile-${size}${className ? ' ' + className : ''}`} style={style} aria-hidden="true">
      <I size={Math.round(px * 0.6)} weight={weight} />
    </span>
  );
}

/** Иконка раздела без плитки (меню, пустые состояния) */
export function SectionIcon({ section, size = 24, weight = 'regular', className }: { section: SectionId; size?: number; weight?: IconWeight; className?: string }) {
  const I = SECTION_ICONS[section];
  return <I size={size} weight={weight} className={className} />;
}
