/** Команды поиска: создать, перейти, тема, синхронизация, копия данных */
import { useApp, toast, type View } from '../store/appStore';
import { t } from '../i18n/index';
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
  { view: 'today', label: t('Сегодня'), emoji: '☀️', alias: 'день главная план привычки деньги' },
  { view: 'home', label: t('Карты'), emoji: '🧠', alias: 'интеллект карты mind map' },
  { view: 'tasks', label: t('Задачи'), emoji: '✅', alias: 'дела todo список' },
  { view: 'calendar', label: t('Календарь'), emoji: '📅', alias: 'расписание неделя месяц' },
  { view: 'habits', label: t('Привычки'), emoji: '🔥', alias: 'привычки дневник день журнал настроение ежедневник' },
  { view: 'assistant', label: t('Ассистент'), emoji: '🤖', alias: 'ии ai чат брифинг' },
  { view: 'notes', label: t('Заметки'), emoji: '📝', alias: 'записи' },
  { view: 'goals', label: t('Цели'), emoji: '🎯', alias: 'колесо баланса сферы' },
  { view: 'finance', label: t('Финансы'), emoji: '💰', alias: 'деньги бюджет расходы доходы счета' },
  { view: 'progress', label: t('Прогресс'), emoji: '🏆', alias: 'уровень достижения опыт' },
  { view: 'focus', label: t('Фокус'), emoji: '⏱️', alias: 'помодоро таймер' },
  { view: 'board', label: t('Доска'), emoji: '🗂️', alias: 'канбан kanban' },
  { view: 'settings', label: t('Настройки'), emoji: '⚙️', alias: 'параметры аккаунт оформление' },
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
      title: t('Новая карта'),
      emoji: '🧠',
      body: 'создать добавить интеллект карту mind map',
      run: () => createAndOpen(docFromTemplate(TEMPLATES[0])),
    }),
    entry({
      key: 'c:new-task',
      kind: 'cmd',
      title: t('Новая задача'),
      emoji: '✅',
      body: 'создать добавить задачу дело',
      run: () => openQuickAdd(),
    }),
    entry({
      key: 'c:new-note',
      kind: 'cmd',
      title: t('Новая заметка'),
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
      key: 'c:ask-brain',
      kind: 'cmd',
      title: t('Спросить у мозга'),
      emoji: '🧠',
      body: 'вопрос ответ по заметкам ии найти что я писал второй мозг',
      run: async () => {
        await nav('notes');
        (await import('../notes/brainAsk')).openAsk();
      },
    }),
    entry({
      key: 'c:brain-hub',
      kind: 'cmd',
      title: t('Второй мозг: что умеет'),
      emoji: '🧠',
      body: 'второй мозг возможности функции связи граф конспект карточки дневник обзор справка помощь',
      run: async () => {
        await nav('notes');
        setTimeout(() => window.dispatchEvent(new Event('sm-open-brain-hub')), 200);
      },
    }),
    entry({
      key: 'c:save-article',
      kind: 'cmd',
      title: t('Сохранить статью по ссылке'),
      emoji: '📰',
      body: 'статья ссылка сайт url прочитать позже пересказ главное сохранить страницу',
      run: async () => {
        await (await import('../notes/article')).askArticle();
      },
    }),
    entry({
      key: 'c:cards-review',
      kind: 'cmd',
      title: t('Повторение карточек'),
      emoji: '🎓',
      body: 'карточки повторить вспомнить выучить запомнить anki флешкарты',
      run: async () => {
        await nav('notes');
        (await import('../notes/cards')).openCardsReview();
      },
    }),
    entry({
      key: 'c:daily-note',
      kind: 'cmd',
      title: t('Заметка дня'),
      emoji: '📔',
      body: 'дневник сегодня запись дня ежедневная заметка итоги дня мысли',
      run: async () => {
        await (await import('../notes/daily')).openDailyNote();
      },
    }),
    entry({
      key: 'c:note-template',
      kind: 'cmd',
      title: t('Заметка по шаблону'),
      emoji: '🧩',
      body: 'шаблон шаблоны заготовка встреча книга проект новая заметка template',
      run: async () => {
        await ensureNotes();
        await nav('notes');
        (await import('../notes/templates')).openTemplates();
      },
    }),
    entry({
      key: 'c:new-goal',
      kind: 'cmd',
      title: t('Новая цель'),
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
      title: t('Новая операция'),
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
        title: t('Перейти: {name}', { name: g.label }),
        emoji: g.emoji,
        body: 'открыть раздел ' + g.alias,
        run: () => nav(g.view),
      }),
    ),
    isDark()
      ? entry({ key: 'c:light', kind: 'cmd', title: t('Светлая тема'), emoji: '☀️', body: 'оформление день светлый режим', run: () => set({ theme: 'light' }) })
      : entry({ key: 'c:dark', kind: 'cmd', title: t('Тёмная тема'), emoji: '🌙', body: 'оформление ночь тёмный режим', run: () => set({ theme: 'dark' }) }),
    ...(theme !== 'system'
      ? [entry({ key: 'c:system', kind: 'cmd', title: t('Тема как в системе'), emoji: '🖥️', body: 'оформление авто автоматически', run: () => set({ theme: 'system' }) })]
      : []),
    entry({
      key: 'c:sync',
      kind: 'cmd',
      title: t('Синхронизировать'),
      emoji: '🔄',
      body: 'облако аккаунт обновить синхронизация',
      run: async () => {
        if (!useCloud.getState().account) {
          toast(t('Войдите в аккаунт — Настройки → Аккаунт'));
          return;
        }
        toast(t('Синхронизация…'));
        try {
          await syncNow();
          const st = useCloud.getState().status;
          toast(st === 'offline' ? t('Нет связи — синхронизация позже') : st === 'error' ? t('Не удалось синхронизировать') : t('Синхронизировано'));
        } catch {
          toast(t('Не удалось синхронизировать'));
        }
      },
    }),
    entry({
      key: 'c:snapshot',
      kind: 'cmd',
      title: t('Сделать копию данных'),
      emoji: '💾',
      body: 'резервная копия бэкап backup сохранить',
      run: async () => toast((await takeSnapshot('manual')) ? t('Копия сохранена на устройстве') : t('Пока нечего копировать')),
    }),
  ];
  // команды без даты изменения — небольшая прибавка, чтобы точное совпадение было сверху
  for (const c of cmds) c.boost = 1;
  return cmds;
}
