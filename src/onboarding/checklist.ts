/**
 * «Первые шаги» — чек-лист первой недели. Отметки не хранятся: всё выводится из уже имеющихся данных,
 * поэтому совпадает на всех устройствах. Хранится только «скрыть» (на этом устройстве).
 */
import type { DocMeta, PlannerData } from '../types';
import type { TasksData } from '../tasks/model';
import type { View } from '../store/appStore';
import { lsGet, lsSet, ONBOARDED_KEY } from './state';

export const HIDDEN_KEY = 'sm-firststeps-hidden';
/** сколько дней после знакомства показывать */
export const SHOW_DAYS = 14;
const WELCOME_TITLE = 'Добро пожаловать';

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
    { id: 'install', title: 'Приложение установлено', hint: 'Вы уже здесь', done: true, to: 'home' },
    {
      id: 'task',
      title: 'Задача с напоминанием',
      hint: 'Добавьте дело с датой — SuperMind напомнит',
      done: !!tasks?.tasks.some((t) => !t.deleted && !!t.date && (t.reminders?.length ?? 0) > 0),
      to: 'tasks',
    },
    {
      id: 'habit',
      title: 'Отметить привычку',
      hint: 'Одна отметка — и серия началась',
      done: days.some((d) => Array.isArray(d?.habits) && d.habits.length > 0),
      to: 'habits',
    },
    {
      id: 'map',
      title: 'Создать карту',
      hint: 'Интеллект-карта для идей или плана',
      done: !!docs?.some((d) => !d.trashed && d.title !== WELCOME_TITLE),
      to: 'home',
    },
    { id: 'mood', title: 'Настроение дня', hint: 'Отметьте, как прошёл день', done: days.some((d) => !!d?.mood), to: 'habits' },
    { id: 'notify', title: 'Включить уведомления', hint: 'Чтобы напоминания приходили вовремя', done: notifications, to: 'notify' },
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
