/** Команды поиска: создать, перейти, тема, синхронизация, копия данных */
import { useApp, toast, type View } from '../store/appStore';
import { createAndOpen } from '../actions';
import { docFromTemplate, TEMPLATES } from '../templates';
import { openQuickAdd } from '../tasks/store';
import { createNote, ensureNotes, openNote } from '../notes/store';
import { ensureGoals } from '../goals/store';
import { openTxSheet } from '../finance/ui/state';
import { syncNow, useCloud } from '../store/cloud';
import { takeSnapshot } from '../store/safety';
import { useSearchUi } from './state';
import { entry, nav, whenShown, type Entry } from './sources';

const GO: { view: Exclude<View, 'editor'>; label: string; emoji: string; alias: string }[] = [
  { view: 'home', label: 'Карты', emoji: '🧠', alias: 'интеллект карты главная mind map' },
  { view: 'tasks', label: 'Задачи', emoji: '✅', alias: 'дела todo список' },
  { view: 'calendar', label: 'Календарь', emoji: '📅', alias: 'расписание неделя месяц' },
  { view: 'planner', label: 'Ежедневник', emoji: '📓', alias: 'дневник привычки день журнал' },
  { view: 'assistant', label: 'Ассистент', emoji: '🤖', alias: 'ии ai чат брифинг' },
  { view: 'notes', label: 'Заметки', emoji: '📝', alias: 'записи' },
  { view: 'goals', label: 'Цели', emoji: '🎯', alias: 'колесо баланса сферы' },
  { view: 'finance', label: 'Финансы', emoji: '💰', alias: 'деньги бюджет расходы доходы счета' },
  { view: 'progress', label: 'Прогресс', emoji: '🏆', alias: 'уровень достижения опыт' },
  { view: 'focus', label: 'Фокус', emoji: '⏱️', alias: 'помодоро таймер' },
  { view: 'board', label: 'Доска', emoji: '🗂️', alias: 'канбан kanban' },
  { view: 'settings', label: 'Настройки', emoji: '⚙️', alias: 'параметры аккаунт оформление' },
];

function isDark(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

export function buildCommands(): Entry[] {
  const set = useApp.getState().setSettings;
  const theme = useApp.getState().settings.theme;
  const cmds: Entry[] = [
    entry({
      key: 'c:new-map',
      kind: 'cmd',
      title: 'Новая карта',
      emoji: '🧠',
      body: 'создать добавить интеллект карту mind map',
      run: () => createAndOpen(docFromTemplate(TEMPLATES[0])),
    }),
    entry({
      key: 'c:new-task',
      kind: 'cmd',
      title: 'Новая задача',
      emoji: '✅',
      body: 'создать добавить задачу дело',
      run: () => openQuickAdd(),
    }),
    entry({
      key: 'c:new-note',
      kind: 'cmd',
      title: 'Новая заметка',
      emoji: '📝',
      body: 'создать добавить заметку запись',
      run: async () => {
        await ensureNotes();
        const m = createNote();
        if (!m) return;
        await openNote(m.id);
        await nav('notes');
      },
    }),
    entry({
      key: 'c:new-goal',
      kind: 'cmd',
      title: 'Новая цель',
      emoji: '🎯',
      body: 'создать добавить цель',
      run: async () => {
        await ensureGoals();
        await nav('goals');
        whenShown('.gl-page', () => useSearchUi.setState({ newGoal: true }));
      },
    }),
    entry({
      key: 'c:new-tx',
      kind: 'cmd',
      title: 'Новая операция',
      emoji: '💸',
      body: 'расход доход финансы добавить трата покупка',
      run: async () => {
        await nav('finance');
        openTxSheet();
      },
    }),
    ...GO.map((g) =>
      entry({
        key: 'c:go-' + g.view,
        kind: 'cmd',
        title: 'Перейти: ' + g.label,
        emoji: g.emoji,
        body: 'открыть раздел ' + g.alias,
        run: () => nav(g.view),
      }),
    ),
    isDark()
      ? entry({ key: 'c:light', kind: 'cmd', title: 'Светлая тема', emoji: '☀️', body: 'оформление день светлый режим', run: () => set({ theme: 'light' }) })
      : entry({ key: 'c:dark', kind: 'cmd', title: 'Тёмная тема', emoji: '🌙', body: 'оформление ночь тёмный режим', run: () => set({ theme: 'dark' }) }),
    ...(theme !== 'system'
      ? [entry({ key: 'c:system', kind: 'cmd', title: 'Тема как в системе', emoji: '🖥️', body: 'оформление авто автоматически', run: () => set({ theme: 'system' }) })]
      : []),
    entry({
      key: 'c:sync',
      kind: 'cmd',
      title: 'Синхронизировать',
      emoji: '🔄',
      body: 'облако аккаунт обновить синхронизация',
      run: async () => {
        if (!useCloud.getState().account) {
          toast('Войдите в аккаунт — Настройки → Аккаунт');
          return;
        }
        toast('Синхронизация…');
        try {
          await syncNow();
          const st = useCloud.getState().status;
          toast(st === 'offline' ? 'Нет связи — синхронизация позже' : st === 'error' ? 'Не удалось синхронизировать' : 'Синхронизировано');
        } catch {
          toast('Не удалось синхронизировать');
        }
      },
    }),
    entry({
      key: 'c:snapshot',
      kind: 'cmd',
      title: 'Сделать копию данных',
      emoji: '💾',
      body: 'резервная копия бэкап backup сохранить',
      run: async () => toast((await takeSnapshot('manual')) ? 'Копия сохранена на устройстве' : 'Пока нечего копировать'),
    }),
  ];
  // команды без даты изменения — небольшая прибавка, чтобы точное совпадение было сверху
  for (const c of cmds) c.boost = 1;
  return cmds;
}
