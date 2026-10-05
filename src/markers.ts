export interface MarkerDef {
  id: string;
  group: string;
  kind: 'priority' | 'progress' | 'emoji';
  /** для priority — номер, для progress — 0..4, для emoji — символ */
  value: string;
  color?: string;
  title: string;
}

export interface MarkerGroup {
  id: string;
  name: string;
  /** только один маркер группы на тему */
  exclusive: boolean;
}

export const MARKER_GROUPS: MarkerGroup[] = [
  { id: 'priority', name: 'Приоритет', exclusive: true },
  { id: 'progress', name: 'Прогресс', exclusive: true },
  { id: 'flag', name: 'Флажки', exclusive: true },
  { id: 'star', name: 'Звёзды', exclusive: true },
  { id: 'smile', name: 'Эмоции', exclusive: true },
  { id: 'task', name: 'Задачи', exclusive: true },
  { id: 'symbol', name: 'Символы', exclusive: false },
  { id: 'people', name: 'Люди', exclusive: false },
  { id: 'arrow', name: 'Стрелки', exclusive: true },
];

const PRIORITY_COLORS = ['#e11d48', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#64748b', '#334155'];

export const MARKERS: MarkerDef[] = [
  ...PRIORITY_COLORS.map((c, i) => ({
    id: `priority-${i + 1}`,
    group: 'priority',
    kind: 'priority' as const,
    value: String(i + 1),
    color: c,
    title: `Приоритет ${i + 1}`,
  })),
  ...[0, 1, 2, 3, 4].map((v) => ({
    id: `progress-${v}`,
    group: 'progress',
    kind: 'progress' as const,
    value: String(v),
    color: '#16a34a',
    title: `Прогресс ${v * 25}%`,
  })),
  ...([
    ['red', '🚩'],
    ['blue', '🏳️'],
    ['check', '🏁'],
  ] as const).map(([k, e]) => ({ id: `flag-${k}`, group: 'flag', kind: 'emoji' as const, value: e, title: 'Флажок' })),
  ...['⭐', '🌟', '✨', '💫'].map((e, i) => ({ id: `star-${i}`, group: 'star', kind: 'emoji' as const, value: e, title: 'Звезда' })),
  ...['😀', '😍', '🤔', '😢', '😡', '😴', '🥳', '😎'].map((e, i) => ({
    id: `smile-${i}`,
    group: 'smile',
    kind: 'emoji' as const,
    value: e,
    title: 'Эмоция',
  })),
  ...['✅', '❌', '⏳', '❓', '⚠️', '🔥'].map((e, i) => ({ id: `task-${i}`, group: 'task', kind: 'emoji' as const, value: e, title: 'Задача' })),
  ...['💡', '📌', '📎', '🎯', '💰', '📅', '📞', '✉️', '🔒', '❤️', '👍', '👎', '🚀', '🧠', '📚', '🛠️'].map((e, i) => ({
    id: `symbol-${i}`,
    group: 'symbol',
    kind: 'emoji' as const,
    value: e,
    title: 'Символ',
  })),
  ...['👤', '👥', '👨‍💻', '👩‍💼', '🧑‍🎓', '🤝'].map((e, i) => ({ id: `people-${i}`, group: 'people', kind: 'emoji' as const, value: e, title: 'Люди' })),
  ...['⬆️', '⬇️', '⬅️', '➡️', '↗️', '🔄'].map((e, i) => ({ id: `arrow-${i}`, group: 'arrow', kind: 'emoji' as const, value: e, title: 'Стрелка' })),
];

export const MARKER_MAP: Record<string, MarkerDef> = Object.fromEntries(MARKERS.map((m) => [m.id, m]));

/** Переключить маркер с учётом эксклюзивных групп */
export function toggleMarker(list: string[] | undefined, id: string): string[] {
  const cur = list ?? [];
  if (cur.includes(id)) return cur.filter((x) => x !== id);
  const def = MARKER_MAP[id];
  const grp = MARKER_GROUPS.find((g) => g.id === def?.group);
  const filtered = grp?.exclusive ? cur.filter((x) => MARKER_MAP[x]?.group !== def.group) : cur;
  return [...filtered, id];
}
