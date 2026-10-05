import type { LineStyle, ShapeType } from './types';

export interface LevelStyle {
  fill: string;
  textColor: string;
  borderColor: string;
  borderWidth: number;
  shape: ShapeType;
  fontSize: number;
  bold: boolean;
}

export interface Theme {
  id: string;
  name: string;
  background: string;
  dark?: boolean;
  central: LevelStyle;
  main: LevelStyle;
  sub: LevelStyle;
  floating: LevelStyle;
  lineColor: string;
  lineWidth: number;
  lineStyle: LineStyle;
  /** палитра для радужных ветвей */
  palette: string[];
  /** заливать ли основные темы цветом ветви в радужном режиме */
  fillMainWithBranch?: boolean;
  relColor: string;
}

const base = (o: Partial<LevelStyle>, d: LevelStyle): LevelStyle => ({ ...d, ...o });

const SUB: LevelStyle = {
  fill: 'transparent',
  textColor: '#1f2937',
  borderColor: 'transparent',
  borderWidth: 0,
  shape: 'underline',
  fontSize: 14,
  bold: false,
};

export const THEMES: Theme[] = [
  {
    id: 'classic',
    name: 'Классика',
    background: '#ffffff',
    central: { fill: '#1e293b', textColor: '#ffffff', borderColor: 'transparent', borderWidth: 0, shape: 'rounded', fontSize: 22, bold: true },
    main: { fill: '#eef2ff', textColor: '#1e293b', borderColor: '#c7d2fe', borderWidth: 1.5, shape: 'rounded', fontSize: 16, bold: true },
    sub: SUB,
    floating: { fill: '#fef3c7', textColor: '#78350f', borderColor: '#fcd34d', borderWidth: 1, shape: 'rounded', fontSize: 15, bold: false },
    lineColor: '#94a3b8',
    lineWidth: 2,
    lineStyle: 'curve',
    palette: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'],
    relColor: '#64748b',
  },
  {
    id: 'fire',
    name: 'Огонь',
    background: '#fff7f5',
    central: { fill: '#f43f1a', textColor: '#ffffff', borderColor: 'transparent', borderWidth: 0, shape: 'pill', fontSize: 22, bold: true },
    main: { fill: '#ffffff', textColor: '#7c2d12', borderColor: '#fb7d5b', borderWidth: 2, shape: 'pill', fontSize: 16, bold: true },
    sub: base({ textColor: '#7c2d12' }, SUB),
    floating: { fill: '#ffe4dc', textColor: '#7c2d12', borderColor: '#fb7d5b', borderWidth: 1, shape: 'pill', fontSize: 15, bold: false },
    lineColor: '#fb7d5b',
    lineWidth: 2.5,
    lineStyle: 'taper',
    palette: ['#f43f1a', '#fb923c', '#f59e0b', '#e11d48', '#db2777', '#c2410c'],
    relColor: '#c2410c',
  },
  {
    id: 'ocean',
    name: 'Океан',
    background: '#f0f9ff',
    central: { fill: '#0369a1', textColor: '#ffffff', borderColor: 'transparent', borderWidth: 0, shape: 'ellipse', fontSize: 22, bold: true },
    main: { fill: '#0ea5e9', textColor: '#ffffff', borderColor: 'transparent', borderWidth: 0, shape: 'rounded', fontSize: 16, bold: true },
    sub: base({ textColor: '#0c4a6e' }, SUB),
    floating: { fill: '#e0f2fe', textColor: '#0c4a6e', borderColor: '#7dd3fc', borderWidth: 1, shape: 'rounded', fontSize: 15, bold: false },
    lineColor: '#38bdf8',
    lineWidth: 2,
    lineStyle: 'curve',
    palette: ['#0284c7', '#0891b2', '#0d9488', '#2563eb', '#4f46e5', '#0ea5e9'],
    fillMainWithBranch: true,
    relColor: '#0369a1',
  },
  {
    id: 'forest',
    name: 'Лес',
    background: '#f6fbf4',
    central: { fill: '#166534', textColor: '#ffffff', borderColor: 'transparent', borderWidth: 0, shape: 'hexagon', fontSize: 22, bold: true },
    main: { fill: '#dcfce7', textColor: '#14532d', borderColor: '#4ade80', borderWidth: 1.5, shape: 'rect', fontSize: 16, bold: true },
    sub: base({ textColor: '#14532d' }, SUB),
    floating: { fill: '#fef9c3', textColor: '#713f12', borderColor: '#facc15', borderWidth: 1, shape: 'rect', fontSize: 15, bold: false },
    lineColor: '#4ade80',
    lineWidth: 2,
    lineStyle: 'rounded-elbow',
    palette: ['#16a34a', '#65a30d', '#059669', '#0d9488', '#ca8a04', '#15803d'],
    relColor: '#166534',
  },
  {
    id: 'mono',
    name: 'Минимализм',
    background: '#fafafa',
    central: { fill: '#ffffff', textColor: '#111111', borderColor: '#111111', borderWidth: 2.5, shape: 'rect', fontSize: 22, bold: true },
    main: { fill: '#ffffff', textColor: '#111111', borderColor: '#111111', borderWidth: 1.5, shape: 'rect', fontSize: 16, bold: false },
    sub: base({ textColor: '#111111' }, SUB),
    floating: { fill: '#ffffff', textColor: '#111111', borderColor: '#777777', borderWidth: 1, shape: 'rect', fontSize: 15, bold: false },
    lineColor: '#111111',
    lineWidth: 1.5,
    lineStyle: 'elbow',
    palette: ['#111111', '#444444', '#666666', '#888888'],
    relColor: '#555555',
  },
  {
    id: 'candy',
    name: 'Конфетти',
    background: '#fffbfe',
    central: { fill: '#a855f7', textColor: '#ffffff', borderColor: 'transparent', borderWidth: 0, shape: 'pill', fontSize: 22, bold: true },
    main: { fill: '#f5d0fe', textColor: '#581c87', borderColor: 'transparent', borderWidth: 0, shape: 'pill', fontSize: 16, bold: true },
    sub: base({ textColor: '#581c87' }, SUB),
    floating: { fill: '#fce7f3', textColor: '#831843', borderColor: '#f9a8d4', borderWidth: 1, shape: 'pill', fontSize: 15, bold: false },
    lineColor: '#d8b4fe',
    lineWidth: 3,
    lineStyle: 'taper',
    palette: ['#ec4899', '#a855f7', '#6366f1', '#14b8a6', '#f59e0b', '#f43f5e'],
    fillMainWithBranch: true,
    relColor: '#9333ea',
  },
  {
    id: 'night',
    name: 'Ночь',
    dark: true,
    background: '#0f172a',
    central: { fill: '#f8fafc', textColor: '#0f172a', borderColor: 'transparent', borderWidth: 0, shape: 'rounded', fontSize: 22, bold: true },
    main: { fill: '#1e293b', textColor: '#f1f5f9', borderColor: '#475569', borderWidth: 1.5, shape: 'rounded', fontSize: 16, bold: true },
    sub: base({ textColor: '#cbd5e1' }, SUB),
    floating: { fill: '#334155', textColor: '#f8fafc', borderColor: '#64748b', borderWidth: 1, shape: 'rounded', fontSize: 15, bold: false },
    lineColor: '#64748b',
    lineWidth: 2,
    lineStyle: 'curve',
    palette: ['#f87171', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6'],
    relColor: '#94a3b8',
  },
  {
    id: 'neon',
    name: 'Неон',
    dark: true,
    background: '#09090b',
    central: { fill: '#09090b', textColor: '#22d3ee', borderColor: '#22d3ee', borderWidth: 3, shape: 'hexagon', fontSize: 22, bold: true },
    main: { fill: '#09090b', textColor: '#ffffff', borderColor: '#a3e635', borderWidth: 2, shape: 'rounded', fontSize: 16, bold: true },
    sub: base({ textColor: '#e4e4e7' }, SUB),
    floating: { fill: '#18181b', textColor: '#f0abfc', borderColor: '#f0abfc', borderWidth: 1.5, shape: 'rounded', fontSize: 15, bold: false },
    lineColor: '#a3e635',
    lineWidth: 2,
    lineStyle: 'straight',
    palette: ['#22d3ee', '#a3e635', '#f0abfc', '#facc15', '#fb7185', '#818cf8'],
    relColor: '#f0abfc',
  },
  {
    id: 'paper',
    name: 'Бумага',
    background: '#f8f4ea',
    central: { fill: '#3f3a32', textColor: '#f8f4ea', borderColor: 'transparent', borderWidth: 0, shape: 'rounded', fontSize: 22, bold: true },
    main: { fill: '#efe7d4', textColor: '#3f3a32', borderColor: '#b8a88a', borderWidth: 1, shape: 'rounded', fontSize: 16, bold: true },
    sub: base({ textColor: '#3f3a32' }, SUB),
    floating: { fill: '#fffaf0', textColor: '#3f3a32', borderColor: '#b8a88a', borderWidth: 1, shape: 'rounded', fontSize: 15, bold: false },
    lineColor: '#a8987a',
    lineWidth: 1.8,
    lineStyle: 'curve',
    palette: ['#b45309', '#a16207', '#4d7c0f', '#0f766e', '#7c2d12', '#6b21a8'],
    relColor: '#7c6f57',
  },
];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export const COLOR_SWATCHES = [
  'transparent', '#ffffff', '#f1f5f9', '#94a3b8', '#334155', '#000000',
  '#fee2e2', '#ef4444', '#b91c1c', '#ffedd5', '#f97316', '#c2410c',
  '#fef9c3', '#eab308', '#a16207', '#dcfce7', '#22c55e', '#15803d',
  '#cffafe', '#06b6d4', '#0e7490', '#dbeafe', '#3b82f6', '#1d4ed8',
  '#ede9fe', '#8b5cf6', '#6d28d9', '#fce7f3', '#ec4899', '#be185d',
];
