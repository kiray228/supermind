/** «Что нового»: главное в каждой версии. Новые версии — сверху. */
import { Bot, CalendarClock, Cloud, LayoutGrid, Palette, Repeat, Search, Share2, Sparkles, Trophy, Wallet, Wrench, ShieldCheck, Sunrise } from 'lucide-react';

export interface ChangeItem {
  icon: typeof Sparkles;
  title: string;
  text: string;
}

export interface ChangelogEntry {
  /** версия без «v»: '1.8.1'; сравнивается по числам, '1.9' = '1.9.0' */
  version: string;
  title: string;
  items: ChangeItem[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.9',
    title: 'Поиск, виджет и надёжная синхронизация',
    items: [
      { icon: ShieldCheck, title: 'Данные больше не теряются', text: 'Изменения с другого устройства не затираются правками на этом; если карту меняли одновременно, обе версии сохраняются. Вход в чужой аккаунт — с вопросом, что делать с данными.' },
      { icon: Search, title: 'Поиск по всему', text: 'Карты и их темы, задачи, заметки, цели, привычки, дневник и операции — в одном окне. Ctrl+K или «Ещё» → поиск; команды через «>».' },
      { icon: LayoutGrid, title: 'Виджет на Android', text: '«SuperMind — Сегодня» на главном экране: задачи на сегодня с отметкой выполнения, привычки и быстрое добавление.' },
      { icon: Share2, title: '«Поделиться → SuperMind»', text: 'Текст или ссылку из любого приложения — сразу в задачу, заметку или карту «Входящие».' },
      { icon: Sparkles, title: 'Знакомство и «Что нового»', text: 'Короткий тур при первом запуске, а после обновлений — это окно (открыть снова — в Настройках).' },
    ],
  },
  {
    version: '1.8.1',
    title: 'Исправления',
    items: [
      { icon: Wrench, title: 'Окна с клавиатурой', text: 'Окна операции и задачи больше не сжимаются, категория выбирается с первого нажатия.' },
      { icon: Sunrise, title: 'Точнее брифинг', text: 'Утренний брифинг считает только невыполненные привычки; счётчики показываются как «стакан: 3 / 8».' },
      { icon: Trophy, title: 'Уровень в меню', text: 'Значок уровня теперь в меню, а при запуске — аккуратная заставка. Окна в тёмной теме стали плотнее.' },
    ],
  },
  {
    version: '1.8',
    title: 'Привычки, ассистент и прогресс',
    items: [
      { icon: Repeat, title: 'Привычки как в MyLife', text: 'Дни недели или N раз в неделю, время и длительность, части дня, счётчики с целью, библиотека из 35 привычек, статистика и архив.' },
      { icon: CalendarClock, title: 'Календарь', text: 'Привычки со временем и сроки целей теперь видны в календаре.' },
      { icon: Bot, title: 'ИИ-ассистент и утренний брифинг', text: 'План на день — каждое утро уведомлением. Ассистент видит задачи, привычки, цели и финансы и предлагает действия в одно нажатие.' },
      { icon: Trophy, title: 'Уровни и достижения', text: 'Опыт за дела, 50 уровней со званиями, 40 достижений, сферы жизни и тепловая карта.' },
      { icon: ShieldCheck, title: 'Надёжнее синхронизация', text: 'Побеждает свежая версия дня; облачные копии — каждый час, на устройстве — каждые 3 часа.' },
    ],
  },
  {
    version: '1.7',
    title: 'Аккаунты, облако и Liquid Glass',
    items: [
      { icon: Cloud, title: 'Аккаунты и облачные копии', text: 'Синхронизация между устройствами, 14 последних копий на сервере и восстановление в один клик. Автокопии и на устройстве.' },
      { icon: Palette, title: 'Liquid Glass и цвета', text: 'Выберите цвет акцента, стеклянное оформление и фон «Аврора».' },
      { icon: Wallet, title: 'Финансы, Цели, Заметки', text: 'Новые разделы в меню — с синхронизацией и напоминаниями о платежах подписок.' },
    ],
  },
];

/** Сравнение версий: <0, 0, >0. Нечисловые части ('dev') считаются нулём. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const minorOf = (v: string) => v.split('.').slice(0, 2).map((x) => parseInt(x, 10) || 0).join('.');
export const isRealVersion = (v: string) => /^\d+\.\d+/.test(v);

/**
 * Какие версии показать.
 * all — всё, что не новее текущей; иначе — новее последней просмотренной
 * (если ничего не смотрели — версии той же ветки, что текущая: 1.8 и 1.8.1).
 */
export function entriesFor(current: string, seen: string | null, all: boolean): ChangelogEntry[] {
  const real = isRealVersion(current);
  const upTo = CHANGELOG.filter((e) => !real || cmpVersion(e.version, current) <= 0);
  if (all) return upTo;
  if (!real) return [];
  if (seen && isRealVersion(seen)) return upTo.filter((e) => cmpVersion(e.version, seen) > 0);
  return upTo.filter((e) => minorOf(e.version) === minorOf(current));
}
