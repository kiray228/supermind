/** Библиотека популярных привычек — добавляются в одно касание */
import type { Habit } from '../types';
import { uid } from '../utils/tree';
import { cleanHabit } from './model';

export type HabitCategory = 'health' | 'sport' | 'mind' | 'work' | 'people' | 'money' | 'calm';

export const HABIT_CATEGORIES: { id: HabitCategory; label: string; icon: string; color: string }[] = [
  { id: 'health', label: 'Здоровье', icon: '❤️', color: '#ef4444' },
  { id: 'sport', label: 'Спорт', icon: '🏃', color: '#f97316' },
  { id: 'mind', label: 'Ум', icon: '🧠', color: '#6366f1' },
  { id: 'work', label: 'Продуктивность', icon: '⚡', color: '#f59e0b' },
  { id: 'people', label: 'Отношения', icon: '🤝', color: '#ec4899' },
  { id: 'money', label: 'Финансы', icon: '💰', color: '#22c55e' },
  { id: 'calm', label: 'Осознанность', icon: '🧘', color: '#14b8a6' },
];

export interface HabitPreset extends Omit<Habit, 'id' | 'color'> {
  cat: HabitCategory;
  color?: string;
  /** зачем — одна строка */
  why: string;
}

export const HABIT_LIBRARY: HabitPreset[] = [
  // Здоровье
  { cat: 'health', name: 'Пить воду', icon: '💧', target: 8, unit: 'стакан', part: 'any', color: '#3b82f6', why: '8 стаканов в течение дня' },
  { cat: 'health', name: 'Витамины', icon: '💊', time: '08:30', part: 'morning', why: 'Сразу после завтрака' },
  { cat: 'health', name: 'Лекарства утром и вечером', icon: '💊', times: ['08:00', '20:00'], color: '#ef4444', why: 'Два приёма — напомним о каждом' },
  { cat: 'health', name: 'Лечь спать до 23:00', icon: '😴', time: '22:30', part: 'evening', color: '#6366f1', why: 'Высыпаться и вставать легко' },
  { cat: 'health', name: '10 000 шагов', icon: '👣', part: 'day', why: 'Больше движения в течение дня' },
  { cat: 'health', name: 'Без сладкого', icon: '🍬', part: 'any', why: 'Стабильная энергия без сахарных качелей' },
  { cat: 'health', name: 'Овощи и фрукты', icon: '🥗', target: 5, unit: 'порция', part: 'any', color: '#22c55e', why: '5 порций в день' },
  { cat: 'health', name: 'Зубная нить', icon: '🦷', time: '22:15', part: 'evening', why: 'Две минуты перед сном' },
  // Спорт
  { cat: 'sport', name: 'Зарядка', icon: '🤸', time: '07:00', duration: 10, part: 'morning', why: 'Проснуться и размяться' },
  { cat: 'sport', name: 'Пробежка', icon: '🏃', freq: 'weekly', perWeek: 3, time: '07:30', duration: 30, part: 'morning', why: '3 раза в неделю по 30 минут' },
  { cat: 'sport', name: 'Тренировка', icon: '🏋️', freq: 'weekdays', days: [1, 3, 5], time: '19:00', duration: 60, part: 'evening', why: 'Пн, Ср, Пт — силовая' },
  { cat: 'sport', name: 'Растяжка', icon: '🧘‍♀️', time: '21:30', duration: 10, part: 'evening', why: 'Гибкость и расслабление перед сном' },
  { cat: 'sport', name: 'Прогулка', icon: '🚶', duration: 30, part: 'day', why: '30 минут на свежем воздухе' },
  { cat: 'sport', name: 'Отжимания', icon: '💪', target: 3, unit: 'подход', part: 'any', why: '3 подхода в течение дня' },
  // Ум
  { cat: 'mind', name: 'Чтение', icon: '📚', time: '21:00', duration: 20, part: 'evening', why: '20 минут книги вместо ленты' },
  { cat: 'mind', name: 'Английский', icon: '🗣️', duration: 15, part: 'day', why: '15 минут практики каждый день' },
  { cat: 'mind', name: 'Подкаст или лекция', icon: '🎧', duration: 20, part: 'day', why: 'Учиться в дороге' },
  { cat: 'mind', name: 'Онлайн-курс', icon: '🎓', freq: 'weekly', perWeek: 3, duration: 45, part: 'evening', why: '3 урока в неделю' },
  // Продуктивность
  { cat: 'work', name: 'План на день', icon: '📝', time: '08:00', duration: 5, part: 'morning', why: '5 минут — и день под контролем' },
  { cat: 'work', name: 'Главная задача утром', icon: '🐸', part: 'morning', why: 'Сначала — самое важное и трудное' },
  { cat: 'work', name: 'Первый час без телефона', icon: '📵', part: 'morning', why: 'Утро для себя, а не для уведомлений' },
  { cat: 'work', name: 'Глубокая работа', icon: '🎯', freq: 'weekdays', days: [1, 2, 3, 4, 5], time: '10:00', duration: 90, part: 'morning', why: '90 минут без отвлечений по будням' },
  { cat: 'work', name: 'Обзор недели', icon: '🗓️', freq: 'weekdays', days: [0], time: '19:00', duration: 30, part: 'evening', why: 'Итоги и план по воскресеньям' },
  // Отношения
  { cat: 'people', name: 'Позвонить родителям', icon: '📞', freq: 'weekly', perWeek: 2, part: 'evening', why: 'Пару раз в неделю' },
  { cat: 'people', name: 'Время с семьёй', icon: '👨‍👩‍👧', duration: 30, part: 'evening', why: 'Без телефонов и спешки' },
  { cat: 'people', name: 'Доброе слово', icon: '💬', part: 'any', why: 'Комплимент или благодарность кому-то' },
  { cat: 'people', name: 'Написать другу', icon: '✉️', freq: 'weekly', perWeek: 2, part: 'any', why: 'Поддерживать связь' },
  // Финансы
  { cat: 'money', name: 'Записать расходы', icon: '💸', time: '21:00', duration: 5, part: 'evening', why: 'Знать, куда уходят деньги' },
  { cat: 'money', name: 'Без импульсивных покупок', icon: '🛍️', part: 'any', why: 'Подождать сутки перед покупкой' },
  { cat: 'money', name: 'Отложить деньги', icon: '🐷', freq: 'weekly', perWeek: 1, part: 'any', why: 'Раз в неделю — в копилку' },
  { cat: 'money', name: 'Проверить бюджет', icon: '📊', freq: 'weekdays', days: [0], time: '18:00', duration: 15, part: 'evening', why: 'Еженедельная сверка' },
  // Осознанность
  { cat: 'calm', name: 'Медитация', icon: '🧘', time: '07:15', duration: 10, part: 'morning', why: '10 минут тишины' },
  { cat: 'calm', name: 'Дневник благодарности', icon: '🙏', time: '22:00', duration: 5, part: 'evening', why: '3 вещи, за которые благодарен' },
  { cat: 'calm', name: 'Без экранов перед сном', icon: '🌙', time: '22:00', part: 'evening', why: 'Час до сна — без гаджетов' },
  { cat: 'calm', name: 'Дыхательная практика', icon: '🌬️', duration: 5, part: 'day', why: '5 минут, чтобы снять напряжение' },
  { cat: 'calm', name: 'Рефлексия дня', icon: '✍️', time: '22:15', duration: 10, part: 'evening', why: 'Что получилось, что улучшить' },
];

/** Привычка из шаблона библиотеки */
export function habitFromPreset(p: HabitPreset): Habit {
  const { cat, why: _why, color, ...rest } = p;
  void _why;
  return cleanHabit({ ...rest, id: uid(), color: color ?? HABIT_CATEGORIES.find((c) => c.id === cat)?.color ?? '#22c55e', createdAt: Date.now() });
}
