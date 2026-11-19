/** Библиотека популярных привычек — добавляются в одно касание */
import type { Habit } from '../types';
import { uid } from '../utils/tree';
import { cleanHabit } from './model';
import { t } from '../i18n/index';

export type HabitCategory = 'health' | 'sport' | 'mind' | 'work' | 'people' | 'money' | 'calm';

export const HABIT_CATEGORIES: { id: HabitCategory; label: string; icon: string; color: string }[] = [
  { id: 'health', label: t('Здоровье'), icon: '❤️', color: '#ef4444' },
  { id: 'sport', label: t('Спорт'), icon: '🏃', color: '#f97316' },
  { id: 'mind', label: t('Ум'), icon: '🧠', color: '#6366f1' },
  { id: 'work', label: t('Продуктивность'), icon: '⚡', color: '#f59e0b' },
  { id: 'people', label: t('Отношения'), icon: '🤝', color: '#ec4899' },
  { id: 'money', label: t('Финансы'), icon: '💰', color: '#22c55e' },
  { id: 'calm', label: t('Осознанность'), icon: '🧘', color: '#14b8a6' },
];

export interface HabitPreset extends Omit<Habit, 'id' | 'color'> {
  cat: HabitCategory;
  color?: string;
  /** зачем — одна строка */
  why: string;
}

export const HABIT_LIBRARY: HabitPreset[] = [
  // Здоровье
  { cat: 'health', name: t('Пить воду'), icon: '💧', target: 8, unit: t('стакан'), part: 'any', color: '#3b82f6', why: t('8 стаканов в течение дня') },
  { cat: 'health', name: t('Витамины'), icon: '💊', time: '08:30', part: 'morning', why: t('Сразу после завтрака') },
  { cat: 'health', name: t('Лекарства утром и вечером'), icon: '💊', times: ['08:00', '20:00'], color: '#ef4444', why: t('Два приёма — напомним о каждом') },
  { cat: 'health', name: t('Лечь спать до 23:00'), icon: '😴', time: '22:30', part: 'evening', color: '#6366f1', why: t('Высыпаться и вставать легко') },
  { cat: 'health', name: t('10 000 шагов'), icon: '👣', part: 'day', why: t('Больше движения в течение дня') },
  { cat: 'health', name: t('Без сладкого'), icon: '🍬', part: 'any', why: t('Стабильная энергия без сахарных качелей') },
  { cat: 'health', name: t('Овощи и фрукты'), icon: '🥗', target: 5, unit: t('порция'), part: 'any', color: '#22c55e', why: t('5 порций в день') },
  { cat: 'health', name: t('Зубная нить'), icon: '🦷', time: '22:15', part: 'evening', why: t('Две минуты перед сном') },
  // Спорт
  { cat: 'sport', name: t('Зарядка'), icon: '🤸', time: '07:00', duration: 10, part: 'morning', why: t('Проснуться и размяться') },
  { cat: 'sport', name: t('Пробежка'), icon: '🏃', freq: 'weekly', perWeek: 3, time: '07:30', duration: 30, part: 'morning', why: t('3 раза в неделю по 30 минут') },
  { cat: 'sport', name: t('Тренировка'), icon: '🏋️', freq: 'weekdays', days: [1, 3, 5], time: '19:00', duration: 60, part: 'evening', why: t('Пн, Ср, Пт — силовая') },
  { cat: 'sport', name: t('Растяжка'), icon: '🧘‍♀️', time: '21:30', duration: 10, part: 'evening', why: t('Гибкость и расслабление перед сном') },
  { cat: 'sport', name: t('Прогулка'), icon: '🚶', duration: 30, part: 'day', why: t('30 минут на свежем воздухе') },
  { cat: 'sport', name: t('Отжимания'), icon: '💪', target: 3, unit: t('подход'), part: 'any', why: t('3 подхода в течение дня') },
  // Ум
  { cat: 'mind', name: t('Чтение'), icon: '📚', time: '21:00', duration: 20, part: 'evening', why: t('20 минут книги вместо ленты') },
  { cat: 'mind', name: t('Английский'), icon: '🗣️', duration: 15, part: 'day', why: t('15 минут практики каждый день') },
  { cat: 'mind', name: t('Подкаст или лекция'), icon: '🎧', duration: 20, part: 'day', why: t('Учиться в дороге') },
  { cat: 'mind', name: t('Онлайн-курс'), icon: '🎓', freq: 'weekly', perWeek: 3, duration: 45, part: 'evening', why: t('3 урока в неделю') },
  // Продуктивность
  { cat: 'work', name: t('План на день'), icon: '📝', time: '08:00', duration: 5, part: 'morning', why: t('5 минут — и день под контролем') },
  { cat: 'work', name: t('Главная задача утром'), icon: '🐸', part: 'morning', why: t('Сначала — самое важное и трудное') },
  { cat: 'work', name: t('Первый час без телефона'), icon: '📵', part: 'morning', why: t('Утро для себя, а не для уведомлений') },
  { cat: 'work', name: t('Глубокая работа'), icon: '🎯', freq: 'weekdays', days: [1, 2, 3, 4, 5], time: '10:00', duration: 90, part: 'morning', why: t('90 минут без отвлечений по будням') },
  { cat: 'work', name: t('Обзор недели'), icon: '🗓️', freq: 'weekdays', days: [0], time: '19:00', duration: 30, part: 'evening', why: t('Итоги и план по воскресеньям') },
  // Отношения
  { cat: 'people', name: t('Позвонить родителям'), icon: '📞', freq: 'weekly', perWeek: 2, part: 'evening', why: t('Пару раз в неделю') },
  { cat: 'people', name: t('Время с семьёй'), icon: '👨‍👩‍👧', duration: 30, part: 'evening', why: t('Без телефонов и спешки') },
  { cat: 'people', name: t('Доброе слово'), icon: '💬', part: 'any', why: t('Комплимент или благодарность кому-то') },
  { cat: 'people', name: t('Написать другу'), icon: '✉️', freq: 'weekly', perWeek: 2, part: 'any', why: t('Поддерживать связь') },
  // Финансы
  { cat: 'money', name: t('Записать расходы'), icon: '💸', time: '21:00', duration: 5, part: 'evening', why: t('Знать, куда уходят деньги') },
  { cat: 'money', name: t('Без импульсивных покупок'), icon: '🛍️', part: 'any', why: t('Подождать сутки перед покупкой') },
  { cat: 'money', name: t('Отложить деньги'), icon: '🐷', freq: 'weekly', perWeek: 1, part: 'any', why: t('Раз в неделю — в копилку') },
  { cat: 'money', name: t('Проверить бюджет'), icon: '📊', freq: 'weekdays', days: [0], time: '18:00', duration: 15, part: 'evening', why: t('Еженедельная сверка') },
  // Осознанность
  { cat: 'calm', name: t('Медитация'), icon: '🧘', time: '07:15', duration: 10, part: 'morning', why: t('10 минут тишины') },
  { cat: 'calm', name: t('Дневник благодарности'), icon: '🙏', time: '22:00', duration: 5, part: 'evening', why: t('3 вещи, за которые благодарен') },
  { cat: 'calm', name: t('Без экранов перед сном'), icon: '🌙', time: '22:00', part: 'evening', why: t('Час до сна — без гаджетов') },
  { cat: 'calm', name: t('Дыхательная практика'), icon: '🌬️', duration: 5, part: 'day', why: t('5 минут, чтобы снять напряжение') },
  { cat: 'calm', name: t('Рефлексия дня'), icon: '✍️', time: '22:15', duration: 10, part: 'evening', why: t('Что получилось, что улучшить') },
];

/** Привычка из шаблона библиотеки */
export function habitFromPreset(p: HabitPreset): Habit {
  const { cat, why: _why, color, ...rest } = p;
  void _why;
  return cleanHabit({ ...rest, id: uid(), color: color ?? HABIT_CATEGORIES.find((c) => c.id === cat)?.color ?? '#22c55e', createdAt: Date.now() });
}
