/**
 * «Первые шаги» — чек-лист первой недели. Отметки не хранятся: всё выводится из уже имеющихся данных,
 * поэтому совпадает на всех устройствах. Хранится только «скрыть» (на этом устройстве).
 */
import type { DocMeta, PlannerData } from '../types';
import type { TasksData } from '../tasks/model';
import type { View } from '../store/appStore';
import { lsGet, lsSet, ONBOARDED_KEY } from './state';
import { t } from '../i18n/index';

export const HIDDEN_KEY = 'sm-firststeps-hidden';
/** сколько дней после знакомства показывать */
export const SHOW_DAYS = 14;
/** название карты-знакомства (templates.ts): русское или переведённое */
const WELCOME_TITLES = ['Добро пожаловать', t('Добро пожаловать')];

export type StepId = 'install' | 'task' | 'habit' | 'map' | 'mood' | 'notify';

export interface Step {
  id: StepId;
  title: string;
  hint: string;
  done: boolean;
  /** куда ведёт нажатие ('notify' — запрос разрешения) */
  to: View | 'notify';
}

export interface ChecklistInput {
  tasks: TasksData | null;
  planner: PlannerData | null;
  docs: DocMeta[] | null;
  notifications: boolean;
}

export function firstSteps({ tasks, planner, docs, notifications }: ChecklistInput): Step[] {
  const days = Object.values(planner?.days ?? {});
  return [
    { id: 'install', title: t('Приложение установлено'), hint: t('Вы уже здесь'), done: true, to: 'home' },
    {
      id: 'task',
      title: t('Задача с напоминанием'),
      hint: t('Добавьте дело с датой — SuperMind напомнит'),
      done: !!tasks?.tasks.some((x) => !x.deleted && !!x.date && (x.reminders?.length ?? 0) > 0),
      to: 'tasks',
    },
    {
      id: 'habit',
      title: t('Отметить привычку'),
      hint: t('Одна отметка — и серия началась'),
      done: days.some((d) => Array.isArray(d?.habits) && d.habits.length > 0),
      to: 'habits',
    },
    {
      id: 'map',
      title: t('Создать карту'),
      hint: t('Интеллект-карта для идей или плана'),
      done: !!docs?.some((d) => !d.trashed && !WELCOME_TITLES.includes(d.title)),
      to: 'home',
    },
    { id: 'mood', title: t('Настроение дня'), hint: t('Отметьте, как прошёл день'), done: days.some((d) => !!d?.mood), to: 'habits' },
    { id: 'notify', title: t('Включить уведомления'), hint: t('Чтобы напоминания приходили вовремя'), done: notifications, to: 'notify' },
  ];
}

/** Показывать ли чек-лист: только новичкам, первые 14 дней, пока не скрыт */
export function checklistWindowOpen(now = Date.now()): boolean {
  if (lsGet(HIDDEN_KEY)) return false;
  // 'existing' — у пользователя уже были данные до знакомства: чек-лист ему не нужен
  const since = Number(lsGet(ONBOARDED_KEY));
  return since > 0 && now - since < SHOW_DAYS * 86400000;
}

export const hideChecklist = () => lsSet(HIDDEN_KEY, '1');
