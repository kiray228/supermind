/** Оформление сфер и список достижений */
import {
  Barbell,
  BookOpen,
  Brain,
  CalendarCheck,
  CalendarDots,
  ChartPieSlice,
  Check,
  Crown,
  Diamond,
  Feather,
  Flag,
  Flame,
  FlowerLotus,
  Footprints,
  Graph,
  Hourglass,
  Leaf,
  Lightning,
  ListBullets,
  ListChecks,
  Medal,
  MedalMilitary,
  Moon,
  Mountains,
  Note,
  NotePencil,
  PenNib,
  PiggyBank,
  Plant,
  RocketLaunch,
  SealCheck,
  Shapes,
  Smiley,
  Sparkle,
  Star,
  SunHorizon,
  Target,
  Timer,
  Trophy,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';
import type { AreaId, Counters } from './model';

export interface AreaMeta {
  id: AreaId;
  label: string;
  color: string;
  icon: Icon;
}

export const AREAS: Record<AreaId, AreaMeta> = {
  tasks: { id: 'tasks', label: 'Дела', color: '#3b82f6', icon: ListChecks },
  habits: { id: 'habits', label: 'Привычки', color: '#22c55e', icon: Plant },
  goals: { id: 'goals', label: 'Цели', color: '#a855f7', icon: Target },
  focus: { id: 'focus', label: 'Фокус', color: '#f97316', icon: Timer },
  journal: { id: 'journal', label: 'Дневник', color: '#ec4899', icon: NotePencil },
  finance: { id: 'finance', label: 'Финансы', color: '#f59e0b', icon: Wallet },
  knowledge: { id: 'knowledge', label: 'Знания', color: '#14b8a6', icon: Brain },
};

export type Tier = 1 | 2 | 3;

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: Icon;
  /** цвет значка: сфера или «жизнь в целом» */
  area: AreaId | 'life';
  /** редкость: 1 — обычное, 2 — редкое, 3 — легендарное */
  tier: Tier;
  target: number;
  value: (c: Counters) => number;
  /** подпись прогресса, напр. «ч» для часов */
  unit?: string;
}

export const LIFE_COLOR = '#6366f1';

export const ACHIEVEMENTS: Achievement[] = [
  // --- Постоянство ---
  { id: 'first-step', title: 'Начало пути', desc: 'Получите первый опыт', icon: Sparkle, area: 'life', tier: 1, target: 1, value: (c) => c.activeDays },
  { id: 'streak-7', title: 'Неделя в ритме', desc: '7 активных дней подряд', icon: Flame, area: 'life', tier: 1, target: 7, value: (c) => c.bestStreak },
  { id: 'streak-30', title: 'Месяц силы', desc: '30 активных дней подряд', icon: Flame, area: 'life', tier: 2, target: 30, value: (c) => c.bestStreak },
  { id: 'streak-100', title: 'Несгибаемый', desc: '100 активных дней подряд', icon: Crown, area: 'life', tier: 3, target: 100, value: (c) => c.bestStreak },
  { id: 'active-50', title: 'Постоянство', desc: '50 активных дней', icon: CalendarCheck, area: 'life', tier: 2, target: 50, value: (c) => c.activeDays },
  { id: 'active-365', title: 'Год роста', desc: '365 активных дней', icon: CalendarDots, area: 'life', tier: 3, target: 365, value: (c) => c.activeDays },
  // --- Дела ---
  { id: 'task-1', title: 'Первая галочка', desc: 'Выполните первую задачу', icon: Check, area: 'tasks', tier: 1, target: 1, value: (c) => c.tasksDone },
  { id: 'task-50', title: 'Деловой', desc: 'Выполните 50 задач', icon: ListChecks, area: 'tasks', tier: 1, target: 50, value: (c) => c.tasksDone },
  { id: 'task-100', title: 'Сотня дел', desc: 'Выполните 100 задач', icon: Trophy, area: 'tasks', tier: 2, target: 100, value: (c) => c.tasksDone },
  { id: 'task-1000', title: 'Машина продуктивности', desc: 'Выполните 1000 задач', icon: RocketLaunch, area: 'tasks', tier: 3, target: 1000, value: (c) => c.tasksDone },
  { id: 'early-bird', title: 'Ранняя пташка', desc: '10 задач, выполненных до 9:00', icon: SunHorizon, area: 'tasks', tier: 2, target: 10, value: (c) => c.earlyTasks },
  { id: 'night-owl', title: 'Сова', desc: '10 задач, выполненных после 23:00', icon: Moon, area: 'tasks', tier: 1, target: 10, value: (c) => c.lateTasks },
  { id: 'task-day-10', title: 'Продуктивный день', desc: '10 задач за один день', icon: Lightning, area: 'tasks', tier: 2, target: 10, value: (c) => c.bestTaskDay },
  { id: 'high-25', title: 'Главное — вперёд', desc: '25 задач с высоким приоритетом', icon: Flag, area: 'tasks', tier: 2, target: 25, value: (c) => c.highTasks },
  { id: 'checklist-100', title: 'По пунктам', desc: 'Отметьте 100 пунктов чек-листов', icon: ListBullets, area: 'tasks', tier: 2, target: 100, value: (c) => c.checkItems },
  // --- Привычки ---
  { id: 'habit-1', title: 'Первое зерно', desc: 'Отметьте привычку', icon: Plant, area: 'habits', tier: 1, target: 1, value: (c) => c.habitChecks },
  { id: 'habit-21', title: 'Привычка формируется', desc: '21 день подряд с одной привычкой', icon: Leaf, area: 'habits', tier: 2, target: 21, value: (c) => c.bestHabitStreak },
  { id: 'habit-66', title: 'Железная воля', desc: '66 дней подряд с одной привычкой', icon: Barbell, area: 'habits', tier: 3, target: 66, value: (c) => c.bestHabitStreak },
  { id: 'habit-500', title: 'Полтысячи отметок', desc: 'Отметьте привычки 500 раз', icon: SealCheck, area: 'habits', tier: 3, target: 500, value: (c) => c.habitChecks },
  // --- Дневник ---
  { id: 'journal-1', title: 'Дорогой дневник', desc: 'Сделайте первую запись', icon: BookOpen, area: 'journal', tier: 1, target: 1, value: (c) => c.journalEntries },
  { id: 'journal-7', title: 'Летописец', desc: 'Пишите в дневник 7 дней подряд', icon: PenNib, area: 'journal', tier: 2, target: 7, value: (c) => c.bestJournalStreak },
  { id: 'journal-50', title: 'Писатель', desc: '50 записей в дневнике', icon: Feather, area: 'journal', tier: 2, target: 50, value: (c) => c.journalEntries },
  { id: 'mood-30', title: 'В ладу с собой', desc: 'Отметьте настроение 30 дней', icon: Smiley, area: 'journal', tier: 2, target: 30, value: (c) => c.moodDays },
  // --- Фокус ---
  { id: 'focus-1', title: 'Первый помидор', desc: 'Завершите сессию фокуса', icon: Timer, area: 'focus', tier: 1, target: 1, value: (c) => c.focusSessions },
  { id: 'focus-10h', title: 'Глубокое погружение', desc: '10 часов фокуса', icon: Brain, area: 'focus', tier: 2, target: 10, unit: 'ч', value: (c) => Math.floor(c.focusMinutes / 60) },
  { id: 'focus-100h', title: 'Монах', desc: '100 часов фокуса', icon: FlowerLotus, area: 'focus', tier: 3, target: 100, unit: 'ч', value: (c) => Math.floor(c.focusMinutes / 60) },
  { id: 'focus-day-4h', title: 'Марафон', desc: '4 часа фокуса за один день', icon: Hourglass, area: 'focus', tier: 2, target: 4, unit: 'ч', value: (c) => Math.floor(c.bestFocusDay / 60) },
  // --- Цели ---
  { id: 'goal-new', title: 'Мечтатель', desc: 'Поставьте первую цель', icon: Target, area: 'goals', tier: 1, target: 1, value: (c) => c.goalsCreated },
  { id: 'goal-done', title: 'Цель достигнута', desc: 'Завершите цель', icon: Medal, area: 'goals', tier: 2, target: 1, value: (c) => c.goalsDone },
  { id: 'goal-10', title: 'Покоритель вершин', desc: 'Завершите 10 целей', icon: Mountains, area: 'goals', tier: 3, target: 10, value: (c) => c.goalsDone },
  { id: 'steps-25', title: 'Шаг за шагом', desc: 'Выполните 25 шагов к целям', icon: Footprints, area: 'goals', tier: 2, target: 25, value: (c) => c.stepsDone },
  { id: 'wheel-3', title: 'Баланс', desc: 'Оцените колесо баланса 3 раза', icon: ChartPieSlice, area: 'goals', tier: 1, target: 3, value: (c) => c.wheelCount },
  // --- Финансы ---
  { id: 'money-30', title: 'Счетовод', desc: '30 дней с учётом финансов', icon: Wallet, area: 'finance', tier: 2, target: 30, value: (c) => c.financeDays },
  { id: 'budget-3', title: 'Бюджет под контролем', desc: '3 месяца в рамках бюджета', icon: PiggyBank, area: 'finance', tier: 2, target: 3, value: (c) => c.budgetMonths },
  // --- Знания ---
  { id: 'notes-10', title: 'Мыслитель', desc: 'Создайте 10 заметок', icon: Note, area: 'knowledge', tier: 1, target: 10, value: (c) => c.notes },
  { id: 'maps-5', title: 'Картограф', desc: 'Создайте 5 интеллект-карт', icon: Graph, area: 'knowledge', tier: 1, target: 5, value: (c) => c.maps },
  // --- Жизнь целиком ---
  { id: 'all-areas', title: 'Многогранность', desc: 'Получите опыт во всех 7 сферах', icon: Shapes, area: 'life', tier: 2, target: 7, value: (c) => c.areasTouched },
  { id: 'harmony-day', title: 'Гармоничный день', desc: 'Опыт в 4 сферах за один день', icon: MedalMilitary, area: 'life', tier: 2, target: 4, value: (c) => c.bestAreasDay },
  { id: 'level-10', title: 'Восходящая звезда', desc: 'Достигните 10 уровня', icon: Star, area: 'life', tier: 2, target: 10, value: (c) => c.level },
  { id: 'level-25', title: 'Бриллиант', desc: 'Достигните 25 уровня', icon: Diamond, area: 'life', tier: 3, target: 25, value: (c) => c.level },
];

export interface AchievementState {
  a: Achievement;
  value: number;
  done: boolean;
  /** 0..1 */
  pct: number;
}

export function achievementStates(c: Counters): AchievementState[] {
  return ACHIEVEMENTS.map((a) => {
    const value = Math.max(0, a.value(c));
    return { a, value, done: value >= a.target, pct: Math.min(1, value / a.target) };
  });
}

export const achievementColor = (a: Achievement) => (a.area === 'life' ? LIFE_COLOR : AREAS[a.area].color);
