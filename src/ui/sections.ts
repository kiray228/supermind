/** Разделы приложения: иконки Phosphor и цвета плиток (используются в src/ui/icons.tsx) */
import {
  Graph,
  CheckCircle,
  CalendarDots,
  Repeat,
  SquaresFour,
  Notepad,
  Target,
  Wallet,
  Sparkle,
  Trophy,
  Timer,
  Kanban,
  GearSix,
  MagnifyingGlass,
  type Icon,
} from '@phosphor-icons/react';

export type SectionId =
  | 'home'
  | 'tasks'
  | 'calendar'
  | 'habits'
  | 'more'
  | 'notes'
  | 'goals'
  | 'finance'
  | 'assistant'
  | 'progress'
  | 'focus'
  | 'board'
  | 'settings'
  | 'search';

/** Иконка каждого раздела */
export const SECTION_ICONS: Record<SectionId, Icon> = {
  home: Graph,
  tasks: CheckCircle,
  calendar: CalendarDots,
  habits: Repeat,
  more: SquaresFour,
  notes: Notepad,
  goals: Target,
  finance: Wallet,
  assistant: Sparkle,
  progress: Trophy,
  focus: Timer,
  board: Kanban,
  settings: GearSix,
  search: MagnifyingGlass,
};

/** Цвета плиток: [верх-слева, низ-справа] — как значки приложений в iOS */
export const TONES = {
  violet: ['#7c3aed', '#b07cff'],
  blue: ['#1667ff', '#4fa3ff'],
  red: ['#f0302a', '#ff7a5c'],
  green: ['#12a150', '#46d97f'],
  yellow: ['#f2a500', '#ffd23f'],
  rose: ['#e0174f', '#ff6f96'],
  teal: ['#0b8f86', '#2ed3c0'],
  magenta: ['#8b3dff', '#ec4899'],
  orange: ['#f05a0a', '#ffa143'],
  indigo: ['#3b3fd8', '#7a83ff'],
  cyan: ['#0384c7', '#3cc8f5'],
  gray: ['#5d6270', '#9aa0ad'],
  slate: ['#3c4658', '#6b778c'],
  accent: ['var(--accent)', 'var(--accent-2)'],
} as const satisfies Record<string, readonly [string, string]>;

export type Tone = keyof typeof TONES;

export const SECTION_TONES: Record<SectionId, Tone> = {
  home: 'violet',
  tasks: 'blue',
  calendar: 'red',
  habits: 'green',
  more: 'gray',
  notes: 'yellow',
  goals: 'rose',
  finance: 'teal',
  assistant: 'magenta',
  progress: 'orange',
  focus: 'indigo',
  board: 'cyan',
  settings: 'gray',
  search: 'slate',
};
