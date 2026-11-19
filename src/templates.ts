import type { MindDoc, StructureType } from './types';
import { markdownToTopic } from './io/markdown';
import { newDoc, newSheet } from './store/docStore';
import { t } from './i18n/index';

export interface Template {
  id: string;
  name: string;
  desc: string;
  structure: StructureType;
  themeId: string;
  md: string;
}

export const TEMPLATES: Template[] = [
  { id: 'blank-map', name: t('Интеллект-карта'), desc: t('Пустая карта'), structure: 'map', themeId: 'classic', md: t('# Центральная тема\n- Основная тема 1\n- Основная тема 2\n- Основная тема 3\n- Основная тема 4') },
  { id: 'blank-logic', name: t('Логическая схема'), desc: t('Слева направо'), structure: 'logic-right', themeId: 'ocean', md: t('# Центральная тема\n- Основная тема 1\n- Основная тема 2\n- Основная тема 3') },
  { id: 'blank-org', name: t('Орг-структура'), desc: t('Иерархия сверху вниз'), structure: 'org', themeId: 'forest', md: t('# Руководитель\n- Отдел 1\n  - Сотрудник\n- Отдел 2\n  - Сотрудник\n- Отдел 3') },
  { id: 'blank-tree', name: t('Дерево'), desc: t('Отступами'), structure: 'tree', themeId: 'paper', md: t('# Центральная тема\n- Раздел 1\n  - Пункт\n  - Пункт\n- Раздел 2\n  - Пункт') },
  { id: 'blank-timeline', name: t('Таймлайн'), desc: t('События во времени'), structure: 'timeline', themeId: 'candy', md: t('# Проект\n- Январь\n  - Старт\n- Февраль\n  - Разработка\n- Март\n  - Тестирование\n- Апрель\n  - Запуск') },
  { id: 'blank-fishbone', name: t('Рыбья кость'), desc: t('Поиск причин проблемы'), structure: 'fishbone', themeId: 'fire', md: t('# Проблема\n- Люди\n  - Причина\n- Процессы\n  - Причина\n- Оборудование\n  - Причина\n- Материалы\n  - Причина') },
  {
    id: 'swot', name: t('SWOT-анализ'), desc: t('Сильные и слабые стороны'), structure: 'map', themeId: 'classic',
    md: t('# SWOT-анализ\n- Сильные стороны\n  - Преимущество 1\n  - Преимущество 2\n- Слабые стороны\n  - Недостаток 1\n- Возможности\n  - Возможность 1\n- Угрозы\n  - Угроза 1'),
  },
  {
    id: 'project', name: t('План проекта'), desc: t('Цели, этапы, задачи'), structure: 'logic-right', themeId: 'ocean',
    md: t('# Новый проект\n- Цели\n  - Главная цель\n  - Метрики успеха\n- Этапы\n  - [ ] Исследование\n  - [ ] Прототип\n  - [ ] Разработка\n  - [ ] Запуск\n- Команда\n  - Роли\n- Риски\n  - Риск 1\n- Бюджет'),
  },
  {
    id: 'week', name: t('План недели'), desc: t('Дни недели и задачи'), structure: 'timeline', themeId: 'candy',
    md: t('# Моя неделя\n- Понедельник\n  - [ ] Задача\n- Вторник\n  - [ ] Задача\n- Среда\n  - [ ] Задача\n- Четверг\n  - [ ] Задача\n- Пятница\n  - [ ] Задача\n- Выходные\n  - Отдых'),
  },
  {
    id: 'meeting', name: t('Протокол встречи'), desc: t('Повестка, решения, задачи'), structure: 'logic-right', themeId: 'mono',
    md: t('# Встреча\n- Участники\n- Повестка\n  - Вопрос 1\n  - Вопрос 2\n- Решения\n- Задачи\n  - [ ] Задача — ответственный\n- Следующая встреча'),
  },
  {
    id: 'book', name: t('Конспект книги'), desc: t('Идеи, цитаты, выводы'), structure: 'map', themeId: 'paper',
    md: t('# Название книги\n- Об авторе\n- Ключевые идеи\n  - Идея 1\n  - Идея 2\n- Цитаты\n- Применение в жизни\n- Оценка'),
  },
  {
    id: 'goals', name: t('Цели на год (OKR)'), desc: t('Цели и ключевые результаты'), structure: 'map', themeId: 'neon',
    md: t('# Цели на год\n- Здоровье\n  - [ ] Спорт 3 раза в неделю\n- Карьера\n  - [ ] Новый навык\n- Финансы\n  - [ ] Подушка безопасности\n- Отношения\n- Саморазвитие\n  - [ ] 24 книги'),
  },
  {
    id: 'brainstorm', name: t('Мозговой штурм'), desc: t('Генерация идей'), structure: 'map', themeId: 'fire',
    md: t('# Вопрос для штурма\n- Идеи\n  - Идея 1\n  - Идея 2\n- Плюсы\n- Минусы\n- Следующий шаг'),
  },
  {
    id: 'study', name: t('Конспект лекции'), desc: t('Учёба и подготовка'), structure: 'tree', themeId: 'forest',
    md: t('# Тема лекции\n- Основные понятия\n  - Термин 1\n  - Термин 2\n- Ключевые тезисы\n- Примеры\n- Вопросы к экзамену'),
  },
];

export function docFromTemplate(tpl: Template): MindDoc {
  const root = markdownToTopic(tpl.md);
  const sheet = newSheet(t('Лист {n}', { n: 1 }), root.text, tpl.structure);
  sheet.root = root;
  sheet.themeId = tpl.themeId;
  return newDoc(tpl.id.startsWith('blank') ? t('Новая карта') : tpl.name, sheet);
}

export function docFromMarkdown(md: string, title?: string, structure: StructureType = 'map'): MindDoc {
  const root = markdownToTopic(md);
  const sheet = newSheet(t('Лист {n}', { n: 1 }), root.text, structure);
  sheet.root = root;
  return newDoc(title ?? (root.text || t('Новая карта')), sheet);
}

export const WELCOME_MD = t('# Добро пожаловать в SuperMind\n- Основы\n  - Нажмите на тему — выбрать\n  - Нажмите ещё раз — изменить текст\n  - Кнопка «+» рядом с темой — подтема\n  - Удерживайте тему — меню\n  - Удерживайте и тяните — перенести\n  - Два пальца — масштаб и прокрутка\n- Нижняя панель\n  - Подтема и тема рядом\n  - Связь между темами\n  - Граница и итог\n  - Удалить и отменить\n- Верхняя панель\n  - ✨ — ИИ-помощник\n  - Ползунки — стиль, маркеры, задачи\n  - Карта, Структура, Гант\n  - «…» — экспорт, презентация, пароль\n- Ещё в приложении\n  - Доска задач\n  - Привычки, здоровье и финансы\n  - Работает без интернета');

export function welcomeDoc(): MindDoc {
  const doc = docFromMarkdown(WELCOME_MD, t('Добро пожаловать'), 'logic-right');
  doc.sheets[0].themeId = 'classic';
  return doc;
}
