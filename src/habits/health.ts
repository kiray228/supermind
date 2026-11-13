/** «Здоровье и спорт»: какие привычки относятся к здоровью и спорту (без зависимостей от интерфейса — проверяется тестами) */
import type { Habit } from '../types';
import { HABIT_LIBRARY, type HabitPreset } from './library';

/** Шаблоны библиотеки для раздела: здоровье, затем спорт */
export const HEALTH_PRESETS: HabitPreset[] = HABIT_LIBRARY.filter((p) => p.cat === 'health' || p.cat === 'sport');

const PRESET_NAMES = new Set(HEALTH_PRESETS.map((p) => p.name.toLowerCase()));

/** Слова в названии своей привычки: вода, сон, шаги, тренировки, питание, лекарства… */
const WORDS =
  /(^|[^а-яё])(вод[аыуе]|стакан|спать|сон(?![а-яё])|сна(?![а-яё])|выспа|шаг|трениров|пробеж|бег(?![а-яё])|бегать|зарядк|растяжк|йог|спорт|фитнес|кардио|зал(?![а-яё])|качалк|отжим|присед|подтяг|пресс|планк|плаван|бассейн|велосип|прогулк|ходьб|витамин|лекарств|таблет|овощ|фрукт|сладк|сахар|диет|калори|здоров|вес(?![а-яё])|зуб|workout|run|gym|steps|water|sleep)/i;

const ICONS = new Set(['💧', '💊', '😴', '👣', '🍬', '🥗', '🦷', '🤸', '🏃', '🏋️', '🧘‍♀️', '🚶', '💪', '🚴', '🏊', '⚽', '🥊', '🍎', '🛌', '❤️']);

/** Привычка про здоровье или спорт: из этих шаблонов, по значку или по словам в названии */
export function isHealthHabit(h: Pick<Habit, 'name' | 'icon'>): boolean {
  const name = h.name.trim().toLowerCase();
  if (PRESET_NAMES.has(name)) return true;
  if (h.icon && ICONS.has(h.icon)) return true;
  return WORDS.test(name);
}
