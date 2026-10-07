/** Опыт, уровни и достижения: публичный API */
export { LevelBadge, LevelRing } from './LevelBadge';
export { useLevel, useProgress, ensureProgressSources, refreshProgressSources } from './hooks';
export { levelInfo, levelTitle, xpForLevel, XP, LEVEL_TITLES, AREA_IDS } from './model';
export type { AreaId, LevelInfo, ProgressStats, Counters } from './model';
export { ACHIEVEMENTS, AREAS, achievementStates } from './achievements';
export type { Achievement, AchievementState } from './achievements';
