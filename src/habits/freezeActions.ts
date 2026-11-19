/**
 * Заморозка серии — действия раздела (пропуск дня, пауза, возобновление) и подписи состояния.
 * Лист с кнопками — в freeze.tsx.
 */
import type { Habit, PlannerData, PlannerDay } from '../types';
import { toast } from '../store/appStore';
import { syncSoon } from '../tasks/sync';
import { addDaysYmd, fromYmd } from '../utils/mapTasks';
import { isEn, LOCALE, t } from '../i18n/index';
import { cleanHabit, frozenOn, pauseUntilLabel, WD_SHORT_BY_DAY, withPause, withResume, withSkip } from './model';

type Days = PlannerData['days'];

export interface FreezeHandlers {
  /** пропуск дня по уважительной причине: поставить / снять */
  skip: (h: Habit, ymd: string, on: boolean) => void;
  /** пауза с `from` по `to` включительно — для одной привычки или для всех */
  pause: (h: Habit | 'all', from: string, to: string) => void;
  /** снять паузу с сегодняшнего дня */
  resume: (h: Habit | 'all') => void;
}

export interface FreezeOpts {
  /** изменить список привычек (на свежих данных раздела) */
  updateHabits: (fn: (list: Habit[]) => Habit[]) => void;
  updateDay: (ymd: string, fn: (d: PlannerDay) => PlannerDay) => void;
  today: string;
  /** отклик (вибрация) */
  feedback?: () => void;
}

/**
 * Действия заморозки для раздела: пропуск — правка дня (как отметка), пауза — правка привычки
 * (cleanHabit ставит updatedAt — при синхронизации побеждает свежая версия привычки).
 * После каждого действия пересчитываются напоминания. Настройки берутся в момент действия.
 */
export function freezeHandlers(opts: () => FreezeOpts): FreezeHandlers {
  return {
    skip: (h, ymd, on) => {
      const o = opts();
      o.updateDay(ymd, (d) => withSkip(d, h, on));
      if (ymd >= o.today) syncSoon(1500);
      o.feedback?.();
      if (on) toast(t('❄️ «{name}» — пропуск, серия не прервётся', { name: h.name }));
    },
    pause: (target, from, to) => {
      const o = opts();
      // «для всех» — все активные привычки
      const hit = (x: Habit) => (target === 'all' ? !x.deleted && !x.archived : x.id === target.id);
      o.updateHabits((list) => list.map((x) => (hit(x) ? cleanHabit(withPause(x, from, to)) : x)));
      syncSoon(300);
      o.feedback?.();
      const back = fromYmd(addDaysYmd(to, 1));
      const until = to === o.today ? t('до завтра') : t('до {date}', { date: dayMonthShort(back) });
      toast(target === 'all' ? t('⏸ Все привычки на паузе {until}', { until }) : t('⏸ «{name}» на паузе {until}', { name: target.name, until }));
    },
    resume: (target) => {
      const o = opts();
      const hit = (x: Habit) => (target === 'all' ? !x.deleted && hasPauseAhead(x, o.today) : x.id === target.id);
      o.updateHabits((list) => list.map((x) => (hit(x) ? cleanHabit(withResume(x, o.today)) : x)));
      syncSoon(300);
      toast(target === 'all' ? t('▶︎ Привычки снова по плану') : t('▶︎ «{name}» снова по плану', { name: target.name }));
    },
  };
}

export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
/** «15 окт» / «Oct 15» */
const dayMonthShort = (d: Date) => (isEn ? d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' }) : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`);
export const shortDay = (ymd: string) => {
  const d = fromYmd(ymd);
  return `${WD_SHORT_BY_DAY[d.getDay()]}, ${dayMonthShort(d)}`;
};

/** Есть ли пауза, которая идёт сегодня или будет позже (её можно снять «Возобновить») */
export const hasPauseAhead = (h: Habit, today: string) => !!h.pauses?.some((p) => p.to >= today);

/** Текст состояния заморозки на день: «Пропуск — серия сохранится», «На паузе до 15 окт» */
export function freezeStatus(days: Days, h: Habit, ymd: string): string | null {
  const fz = frozenOn(days, h, ymd);
  if (fz === 'skip') return t('Пропуск — серия сохранится');
  if (fz === 'pause') return t('На паузе {until}', { until: pauseUntilLabel(h, ymd) ?? '' }).trim();
  return null;
}

