import { t } from './i18n/index';
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
  { id: 'priority', name: t('Приоритет'), exclusive: true },
  { id: 'progress', name: t('Прогресс'), exclusive: true },
  { id: 'flag', name: t('Флажки'), exclusive: true },
  { id: 'star', name: t('Звёзды'), exclusive: true },
  { id: 'smile', name: t('Эмоции'), exclusive: true },
  { id: 'task', name: t('Задачи'), exclusive: true },
  { id: 'symbol', name: t('Символы'), exclusive: false },
  { id: 'people', name: t('Люди'), exclusive: false },
  { id: 'arrow', name: t('Стрелки'), exclusive: true },
];

const PRIORITY_COLORS = ['#e11d48', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#64748b', '#334155'];

export const MARKERS: MarkerDef[] = [
  ...PRIORITY_COLORS.map((c, i) => ({
    id: `priority-${i + 1}`,
    group: 'priority',
    kind: 'priority' as const,
    value: String(i + 1),
    color: c,
    title: t('Приоритет {n}', { n: i + 1 }),
  })),
  ...[0, 1, 2, 3, 4].map((v) => ({
    id: `progress-${v}`,
    group: 'progress',
    kind: 'progress' as const,
    value: String(v),
    color: '#16a34a',
    title: t('Прогресс {n}%', { n: v * 25 }),
  })),
  ...([
    ['red', '🚩'],
    ['blue', '🏳️'],
    ['check', '🏁'],
  ] as const).map(([k, e]) => ({ id: `flag-${k}`, group: 'flag', kind: 'emoji' as const, value: e, title: t('Флажок') })),
  ...['⭐', '🌟', '✨', '💫'].map((e, i) => ({ id: `star-${i}`, group: 'star', kind: 'emoji' as const, value: e, title: t('Звезда') })),
  ...['😀', '😍', '🤔', '😢', '😡', '😴', '🥳', '😎'].map((e, i) => ({
    id: `smile-${i}`,
    group: 'smile',
    kind: 'emoji' as const,
    value: e,
    title: t('Эмоция'),
  })),
  ...['✅', '❌', '⏳', '❓', '⚠️', '🔥'].map((e, i) => ({ id: `task-${i}`, group: 'task', kind: 'emoji' as const, value: e, title: t('Задача') })),
  ...['💡', '📌', '📎', '🎯', '💰', '📅', '📞', '✉️', '🔒', '❤️', '👍', '👎', '🚀', '🧠', '📚', '🛠️'].map((e, i) => ({
    id: `symbol-${i}`,
    group: 'symbol',
    kind: 'emoji' as const,
    value: e,
    title: t('Символ'),
  })),
  ...['👤', '👥', '👨‍💻', '👩‍💼', '🧑‍🎓', '🤝'].map((e, i) => ({ id: `people-${i}`, group: 'people', kind: 'emoji' as const, value: e, title: t('Люди') })),
  ...['⬆️', '⬇️', '⬅️', '➡️', '↗️', '🔄'].map((e, i) => ({ id: `arrow-${i}`, group: 'arrow', kind: 'emoji' as const, value: e, title: t('Стрелка') })),
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
