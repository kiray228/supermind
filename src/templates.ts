import type { MindDoc, StructureType } from './types';
import { markdownToTopic } from './io/markdown';
import { newDoc, newSheet } from './store/docStore';

export interface Template {
  id: string;
  name: string;
  desc: string;
  structure: StructureType;
  themeId: string;
  md: string;
}

export const TEMPLATES: Template[] = [
  { id: 'blank-map', name: 'Интеллект-карта', desc: 'Пустая карта', structure: 'map', themeId: 'classic', md: '# Центральная тема\n- Основная тема 1\n- Основная тема 2\n- Основная тема 3\n- Основная тема 4' },
  { id: 'blank-logic', name: 'Логическая схема', desc: 'Слева направо', structure: 'logic-right', themeId: 'ocean', md: '# Центральная тема\n- Основная тема 1\n- Основная тема 2\n- Основная тема 3' },
  { id: 'blank-org', name: 'Орг-структура', desc: 'Иерархия сверху вниз', structure: 'org', themeId: 'forest', md: '# Руководитель\n- Отдел 1\n  - Сотрудник\n- Отдел 2\n  - Сотрудник\n- Отдел 3' },
  { id: 'blank-tree', name: 'Дерево', desc: 'Отступами', structure: 'tree', themeId: 'paper', md: '# Центральная тема\n- Раздел 1\n  - Пункт\n  - Пункт\n- Раздел 2\n  - Пункт' },
  { id: 'blank-timeline', name: 'Таймлайн', desc: 'События во времени', structure: 'timeline', themeId: 'candy', md: '# Проект\n- Январь\n  - Старт\n- Февраль\n  - Разработка\n- Март\n  - Тестирование\n- Апрель\n  - Запуск' },
  { id: 'blank-fishbone', name: 'Рыбья кость', desc: 'Поиск причин проблемы', structure: 'fishbone', themeId: 'fire', md: '# Проблема\n- Люди\n  - Причина\n- Процессы\n  - Причина\n- Оборудование\n  - Причина\n- Материалы\n  - Причина' },
  {
    id: 'swot', name: 'SWOT-анализ', desc: 'Сильные и слабые стороны', structure: 'map', themeId: 'classic',
    md: '# SWOT-анализ\n- Сильные стороны\n  - Преимущество 1\n  - Преимущество 2\n- Слабые стороны\n  - Недостаток 1\n- Возможности\n  - Возможность 1\n- Угрозы\n  - Угроза 1',
  },
  {
    id: 'project', name: 'План проекта', desc: 'Цели, этапы, задачи', structure: 'logic-right', themeId: 'ocean',
    md: '# Новый проект\n- Цели\n  - Главная цель\n  - Метрики успеха\n- Этапы\n  - [ ] Исследование\n  - [ ] Прототип\n  - [ ] Разработка\n  - [ ] Запуск\n- Команда\n  - Роли\n- Риски\n  - Риск 1\n- Бюджет',
  },
  {
    id: 'week', name: 'План недели', desc: 'Дни недели и задачи', structure: 'timeline', themeId: 'candy',
    md: '# Моя неделя\n- Понедельник\n  - [ ] Задача\n- Вторник\n  - [ ] Задача\n- Среда\n  - [ ] Задача\n- Четверг\n  - [ ] Задача\n- Пятница\n  - [ ] Задача\n- Выходные\n  - Отдых',
  },
  {
    id: 'meeting', name: 'Протокол встречи', desc: 'Повестка, решения, задачи', structure: 'logic-right', themeId: 'mono',
    md: '# Встреча\n- Участники\n- Повестка\n  - Вопрос 1\n  - Вопрос 2\n- Решения\n- Задачи\n  - [ ] Задача — ответственный\n- Следующая встреча',
  },
  {
    id: 'book', name: 'Конспект книги', desc: 'Идеи, цитаты, выводы', structure: 'map', themeId: 'paper',
    md: '# Название книги\n- Об авторе\n- Ключевые идеи\n  - Идея 1\n  - Идея 2\n- Цитаты\n- Применение в жизни\n- Оценка',
  },
  {
    id: 'goals', name: 'Цели на год (OKR)', desc: 'Цели и ключевые результаты', structure: 'map', themeId: 'neon',
    md: '# Цели на год\n- Здоровье\n  - [ ] Спорт 3 раза в неделю\n- Карьера\n  - [ ] Новый навык\n- Финансы\n  - [ ] Подушка безопасности\n- Отношения\n- Саморазвитие\n  - [ ] 24 книги',
  },
  {
    id: 'brainstorm', name: 'Мозговой штурм', desc: 'Генерация идей', structure: 'map', themeId: 'fire',
    md: '# Вопрос для штурма\n- Идеи\n  - Идея 1\n  - Идея 2\n- Плюсы\n- Минусы\n- Следующий шаг',
  },
  {
    id: 'study', name: 'Конспект лекции', desc: 'Учёба и подготовка', structure: 'tree', themeId: 'forest',
    md: '# Тема лекции\n- Основные понятия\n  - Термин 1\n  - Термин 2\n- Ключевые тезисы\n- Примеры\n- Вопросы к экзамену',
  },
];

export function docFromTemplate(t: Template): MindDoc {
  const root = markdownToTopic(t.md);
  const sheet = newSheet('Лист 1', root.text, t.structure);
  sheet.root = root;
  sheet.themeId = t.themeId;
  return newDoc(t.id.startsWith('blank') ? 'Новая карта' : t.name, sheet);
}

export function docFromMarkdown(md: string, title?: string, structure: StructureType = 'map'): MindDoc {
  const root = markdownToTopic(md);
  const sheet = newSheet('Лист 1', root.text, structure);
  sheet.root = root;
  return newDoc(title ?? (root.text || 'Новая карта'), sheet);
}

export const WELCOME_MD = `# Добро пожаловать в SuperMind
- Основы
  - Нажмите на тему — выбрать
  - Нажмите ещё раз — изменить текст
  - Кнопка «+» рядом с темой — подтема
  - Удерживайте тему — меню
  - Удерживайте и тяните — перенести
  - Два пальца — масштаб и прокрутка
- Нижняя панель
  - Подтема и тема рядом
  - Связь между темами
  - Граница и итог
  - Удалить и отменить
- Верхняя панель
  - ✨ — ИИ-помощник
  - Ползунки — стиль, маркеры, задачи
  - Карта, Структура, Гант
  - «…» — экспорт, презентация, пароль
- Ещё в приложении
  - Доска задач
  - Ежедневник и привычки
  - Работает без интернета`;

export function welcomeDoc(): MindDoc {
  const doc = docFromMarkdown(WELCOME_MD, 'Добро пожаловать', 'logic-right');
  doc.sheets[0].themeId = 'classic';
  return doc;
}
