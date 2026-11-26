import { AiHelperSettings } from '../ui/AiHelperSettings';
import { useEffect, useState, type CSSProperties } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { canInstallPwa, installPwa, isAndroidApp, isDesktopApp, isIOSApp, isNative, onInstallChange, WINDOWS_SETUP_URL } from '../platform';
import { AccountCard, PushCard } from '../ui/AccountCard';
import { DataCard } from '../ui/DataCard';
import { LockSettings } from '../ui/LockSettings';
import { AiPrivacySettings } from '../ui/AiPrivacySettings';
import { ACCENTS, DEFAULT_ACCENT } from '../ui/appearance';
import { isIOS } from '../io/download';
import { ensureTasks, setPrefs, useTasks } from '../tasks/store';
import { ALLDAY_REMINDER_OPTIONS, TIMED_REMINDER_OPTIONS } from '../tasks/model';
import {
  alarmFullScreen,
  enableCalendarSync,
  exactAlarmState,
  exportTasksIcs,
  listPhoneCalendars,
  notifyPermission,
  openAlarmFullScreenSettings,
  openExactAlarmSettings,
  requestNotifyPermission,
  testAlarm,
  STREAK_SAVER_DEFAULT,
  syncCalendar,
  phoneCalendarId,
  setPhoneCalendarId,
  type NotifyPermission,
  type PhoneCalendar,
} from '../tasks/sync';
import { useApp, toast } from '../store/appStore';
import { AI_MODELS, streamText, AIError } from '../ai/claude';
import { openWhatsNew } from '../onboarding/state';
import { openSupport } from '../ui/Support';
import { reportAI } from '../ui/ReportAI';
import { InboxHost, openInbox, useSupportAdmin } from '../ui/SupportInbox';
import { ArrowClockwise, Bug, Flag, Lightbulb, Question, ShieldCheck, SlidersHorizontal, Translate, Tray, Warning } from '@phosphor-icons/react';
import { langPref, setLangPref, t, type LangPref } from '../i18n/index';
import { TabsEditor } from '../ui/TabsEditor';
import { AppIconPicker } from '../ui/AppIconPicker';
import { openExternal, PRIVACY_URL } from '../ui/links';
import { applyUpdate, checkForUpdate, updatesSupported, useAppUpdate } from '../ui/appUpdate';
import { errorReportsOn, setErrorReports } from '../ui/errorReport';
import { APP_VERSION } from '../store/safety';
import { IconTile } from '../ui/icons';
import { ListCell, ListRow, ListSection, SelectRow, SwitchRow } from '../ui/list';
import { celebrate, celebrationsOn, setCelebrations } from '../ui/celebrate';
import { prefsShared, setPrefsShared } from '../store/sharedPrefs';
import {
  Alarm,
  AndroidLogo,
  AppleLogo,
  BellRinging,
  CalendarBlank,
  CalendarPlus,
  Cpu,
  Drop,
  Eye as EyeIcon,
  Info as InfoIcon,
  Key,
  Moon,
  Repeat,
  Sparkle,
  SunHorizon,
  Image as ImageIcon,
  CircleHalf,
  Confetti,
  Desktop,
  WindowsLogo,
  ArrowsClockwise,
} from '@phosphor-icons/react';

export default function Settings() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const support = useSupportAdmin();
  const [editTabs, setEditTabs] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const checking = useAppUpdate((s) => s.checking);
  const found = useAppUpdate((s) => s.update);
  useEffect(() => {
    void updatesSupported().then(setCanUpdate);
  }, []);
  const checkUpdates = async () => {
    const u = await checkForUpdate(true);
    if (u) toast(u.version ? t('Доступна версия {version}', { version: u.version }) : t('Доступно обновление'), { label: u.kind === 'apk' ? t('Скачать') : t('Обновить'), run: () => void applyUpdate() });
    else toast(t('У вас последняя версия — {version}', { version: APP_VERSION }));
  };
  const [errorReports, setErrorReportsState] = useState(errorReportsOn);
  const [key, setKey] = useState(settings.apiKey);
  // настройки читаются из базы после запуска: раздел, открытый сразу, сначала видит пустой ключ —
  // подхватить сохранённый, иначе «Сохранить»/«Проверить» стёрли бы его
  const [seenKey, setSeenKey] = useState(settings.apiKey);
  if (settings.apiKey !== seenKey) {
    setSeenKey(settings.apiKey);
    setKey(settings.apiKey);
  }
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [cheers, setCheers] = useState(celebrationsOn);
  const [shared, setShared] = useState(prefsShared);
  // настройки изменили на другом устройстве
  useEffect(() => {
    const on = () => setCheers(celebrationsOn());
    window.addEventListener('sm-prefs-changed', on);
    return () => window.removeEventListener('sm-prefs-changed', on);
  }, []);

  const saveKey = () => {
    setSettings({ apiKey: key.trim() });
    toast(key.trim() ? t('Ключ сохранён') : t('Ключ удалён'));
  };

  const test = async () => {
    saveKey();
    setTesting(true);
    try {
      const r = await streamText({ system: 'Отвечай одним словом.', messages: [{ role: 'user', content: 'Скажи «работает»' }], effort: 'low' });
      toast(t('✅ ИИ {answer}', { answer: r.trim().toLowerCase() }));
    } catch (e) {
      toast(e instanceof AIError ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const model = AI_MODELS.find((m) => m.id === settings.model) ?? AI_MODELS[0];
  const accent = settings.accent ?? DEFAULT_ACCENT;

  return (
    <div className="page">
      <div className="page-header">
        <IconTile section="settings" size="sm" className="ph-tile" />
        <h1>{t('Настройки')}</h1>
      </div>
      <div className="page-body">
        <div className="settings">
          <AccountCard />
          <LockSettings />

          <ListSection
            header={t('Искусственный интеллект')}
            footer={
              <>
                {t('ИИ-функции (генерация карт, мозговой штурм, задачи, резюме, перевод, чат) работают на Claude от Anthropic. Ключ можно получить на')}{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                  console.anthropic.com
                </a>
                {t('. Он хранится только на этом устройстве и отправляется напрямую в Anthropic.')}
              </>
            }
          >
            <div className="ls-field has-icon">
              <IconTile icon={Key} tone="magenta" size="list" />
              <input
                className="ls-input"
                type={show ? 'text' : 'password'}
                autoComplete="off"
                placeholder={t('API-ключ sk-ant-…')}
                aria-label={t('API-ключ')}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onBlur={saveKey}
              />
              <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? t('Скрыть ключ') : t('Показать ключ')}>
                {show ? <EyeOff /> : <Eye />}
              </button>
            </div>
            <SelectRow
              icon={<IconTile icon={Cpu} tone="indigo" size="list" />}
              title={t('Модель')}
              value={model.id}
              display={model.name.split(' — ')[0].replace(/^Claude /, '')}
              options={AI_MODELS.map((m) => ({ value: m.id, label: m.name }))}
              onChange={(v) => setSettings({ model: v })}
            />
            <ListRow
              icon={<IconTile icon={Sparkle} tone="violet" size="list" />}
              title={testing ? t('Проверяю…') : t('Проверить подключение')}
              tone="accent"
              onClick={() => void test()}
              disabled={!key.trim() || testing}
            />
          </ListSection>

          <AiPrivacySettings />

          <AiHelperSettings />

          <TaskSettings />

          <ListSection header={t('Оформление')}>
            <SelectRow
              icon={<IconTile icon={Translate} tone="indigo" size="list" />}
              title={t('Язык')}
              subtitle="Language"
              value={langPref()}
              options={[
                { value: 'auto', label: t('Как в системе') },
                { value: 'ru', label: 'Русский' },
                { value: 'en', label: 'English' },
                { value: 'kk', label: 'Қазақша' },
              ]}
              onChange={(v) => setLangPref(v as LangPref)}
            />
            <ListRow icon={<IconTile icon={SlidersHorizontal} tone="accent" size="list" />} title={t('Нижняя панель')} subtitle={t('Какие разделы стоят внизу на телефоне')} chevron onClick={() => setEditTabs(true)} />
            <ListCell>
              <div className="segmented" role="tablist" aria-label={t('Тема')}>
                <button className={settings.theme === 'system' ? 'active' : ''} onClick={() => setSettings({ theme: 'system' })}>
                  <CircleHalf size={15} weight="fill" /> {t('Авто')}
                </button>
                <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => setSettings({ theme: 'light' })}>
                  <SunHorizon size={15} weight="fill" /> {t('Светлая')}
                </button>
                <button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => setSettings({ theme: 'dark' })}>
                  <Moon size={15} weight="fill" /> {t('Тёмная')}
                </button>
              </div>
            </ListCell>
            <SelectRow
              icon={<IconTile icon={Drop} tone="cyan" size="list" />}
              title={t('Стекло')}
              value={settings.glass ?? 'liquid'}
              options={[
                { value: 'liquid', label: 'Liquid Glass' },
                { value: 'soft', label: t('Спокойное') },
              ]}
              onChange={(v) => setSettings({ glass: v as 'liquid' | 'soft' })}
            />
            <SelectRow
              icon={<IconTile icon={ImageIcon} tone="orange" size="list" />}
              title={t('Фон')}
              value={settings.backdrop ?? 'aurora'}
              options={[
                { value: 'aurora', label: t('Аврора') },
                { value: 'gradient', label: t('Мягкий') },
                { value: 'plain', label: t('Однотонный') },
              ]}
              onChange={(v) => setSettings({ backdrop: v as 'aurora' | 'gradient' | 'plain' })}
            />
            <SwitchRow
              icon={<IconTile icon={Confetti} tone="rose" size="list" />}
              title={t('Анимации успехов')}
              subtitle={t('Конфетти за новый уровень, серию и выполненные привычки')}
              checked={cheers}
              onChange={(v) => {
                setCelebrations(v);
                setCheers(v);
                if (v) celebrate();
              }}
            />
            <AppIconPicker />
          </ListSection>

          <ListSection header={t('Цвет акцента')} footer={t('Цвет кнопок, выбранных вкладок и отметок во всём приложении.')}>
            <ListCell>
              <div className="ap-accents">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    className={`ap-accent${accent === a.id ? ' active' : ''}`}
                    style={{ '--a1': a.color, '--a2': a.color2 } as CSSProperties}
                    onClick={() => setSettings({ accent: a.id })}
                    aria-label={a.name}
                    aria-pressed={accent === a.id}
                  >
                    <i />
                    <span>{a.name}</span>
                  </button>
                ))}
              </div>
            </ListCell>
          </ListSection>

          <ListSection
            header={t('Устройства')}
            footer={t('Тема, цвет, стекло, фон, модель Claude, анимации, озвучка ответов, что видит ассистент и утренние уведомления мозга — одинаковые на всех устройствах аккаунта. API-ключ, код-пароль и защита экрана всегда остаются только на этом устройстве.')}
          >
            <SwitchRow
              icon={<IconTile icon={ArrowsClockwise} tone="blue" size="list" />}
              title={t('Одинаковые настройки')}
              subtitle={shared ? t('Изменения переходят на другие устройства') : t('Только на этом устройстве')}
              checked={shared}
              onChange={(v) => {
                setPrefsShared(v);
                setShared(v);
              }}
            />
          </ListSection>

          <DataCard />

          {!isNative() && !isDesktopApp() && <DesktopInstall />}

          {!isNative() && (
          <ListSection header={t('Установка на телефон')}>
            <ListRow
              icon={<IconTile icon={AppleLogo} tone="gray" size="list" />}
              title="iPhone"
              subtitle={t('Откройте сайт в Safari → «Поделиться» → «На экран „Домой“». Приложение будет работать как обычное, в том числе офлайн.')}
            />
            <ListRow
              icon={<IconTile icon={AndroidLogo} tone="green" size="list" />}
              title="Android"
              subtitle={t('Установите APK-файл SuperMind или в Chrome откройте меню ⋮ → «Установить приложение».')}
            />
          </ListSection>
          )}

          <ListSection
            header={t('Поддержка')}
            footer={t('Нашли ошибку, есть идея или вопрос? Напишите — ответим в приложении и на почту аккаунта. Отчёты об ошибках содержат только текст ошибки, версию и устройство — без ваших данных.')}
          >
            <ListRow icon={<IconTile icon={Bug} tone="red" size="list" />} title={t('Сообщить о проблеме')} chevron onClick={() => openSupport('problem')} />
            <ListRow icon={<IconTile icon={Lightbulb} tone="yellow" size="list" />} title={t('Предложить идею')} chevron onClick={() => openSupport('idea')} />
            <ListRow icon={<IconTile icon={Question} tone="blue" size="list" />} title={t('Задать вопрос')} subtitle={t('На частые вопросы ИИ ответит сразу')} chevron onClick={() => openSupport('question')} />
            <ListRow
              icon={<IconTile icon={Flag} tone="orange" size="list" />}
              title={t('Пожаловаться на ответ ИИ')}
              subtitle={t('Оскорбительный, опасный или неверный ответ — пришлите, разберёмся')}
              chevron
              onClick={() => reportAI('', '')}
            />
            <SwitchRow
              icon={<IconTile icon={Warning} tone="orange" size="list" />}
              title={t('Отправлять отчёты об ошибках')}
              subtitle={t('Помогает находить и исправлять сбои')}
              checked={errorReports}
              onChange={(v) => {
                setErrorReports(v);
                setErrorReportsState(v);
              }}
            />
            {support.admin && (
              <ListRow
                icon={<IconTile icon={Tray} tone="violet" size="list" />}
                title={t('Входящие поддержки')}
                subtitle={support.openCount ? t('Новых: {n}', { n: support.openCount }) : t('Обращения пользователей')}
                chevron
                onClick={openInbox}
              />
            )}
          </ListSection>
          <InboxHost />

          <ListSection
            header={t('О приложении')}
            footer={t('SuperMind — бесплатные интеллект-карты, задачи с напоминаниями, календарь, привычки, ИИ-ассистент, заметки, цели, финансы, прогресс, фокус, и доска задач. Все функции открыты, без подписок.')}
          >
            <ListRow icon={<IconTile icon={InfoIcon} tone="gray" size="list" />} title={t('Версия')} value={APP_VERSION} />
            {canUpdate && (
              <ListRow
                icon={<IconTile icon={ArrowClockwise} tone="blue" size="list" />}
                title={found ? (found.kind === 'apk' ? t('Скачать версию {version}', { version: found.version }) : t('Обновить до новой версии')) : t('Проверить обновления')}
                subtitle={
                  found
                    ? found.kind === 'apk'
                      ? t('Ставится поверх — карты и задачи останутся')
                      : t('Несохранённое сохранится само')
                    : isDesktopApp()
                      ? t('Программа для Windows обновляется сама при запуске')
                      : isNative()
                        ? t('Новые версии приходят с GitHub')
                        : t('Сайт обновляется сам; открытое окно — по кнопке')
                }
                value={checking ? t('Проверяю…') : undefined}
                disabled={checking}
                chevron
                onClick={() => void (found ? applyUpdate() : checkUpdates())}
              />
            )}
            <ListRow icon={<IconTile icon={Sparkle} tone="accent" size="list" />} title={t('Что нового')} chevron onClick={openWhatsNew} />
            <ListRow icon={<IconTile icon={ShieldCheck} tone="gray" size="list" />} title={t('Политика конфиденциальности')} subtitle={t('Какие данные хранятся и куда передаются')} chevron onClick={() => void openExternal(PRIVACY_URL)} />
          </ListSection>
        </div>
      </div>
      {editTabs && <TabsEditor onClose={() => setEditTabs(false)} />}
    </div>
  );
}

const PERM_SHORT: Record<NotifyPermission, string> = {
  granted: t('Разрешены'),
  denied: t('Запрещены'),
  prompt: t('Не разрешены'),
  unsupported: t('Недоступны'),
};

/** Приложение на компьютер: установщик для Windows или установка сайта из Chrome/Edge */
function DesktopInstall() {
  const [canInstall, setCanInstall] = useState(canInstallPwa);
  useEffect(() => onInstallChange(() => setCanInstall(canInstallPwa())), []);
  // на Windows — только программа SuperMind: установка из браузера дала бы второй ярлык
  const windows = /Windows NT/.test(navigator.userAgent);
  return (
    <ListSection header={t('Установка на компьютер')} footer={t('SuperMind откроется в своём окне, с ярлыком на рабочем столе. Данные и вход в аккаунт — как в браузере, синхронизация через облако.')}>
      {windows ? (
        <ListRow
          icon={<IconTile icon={WindowsLogo} tone="blue" size="list" />}
          title={t('Скачать для Windows')}
          subtitle={t('Установщик SuperMind-Setup.exe. Если Windows предупредит о неизвестном издателе — «Подробнее» → «Выполнить в любом случае».')}
          chevron
          onClick={() => (location.href = WINDOWS_SETUP_URL)}
        />
      ) : (
        <ListRow
          icon={<IconTile icon={Desktop} tone="gray" size="list" />}
          title={t('Установить приложение')}
          subtitle={canInstall ? t('Без скачивания файлов — в один клик') : t('Chrome или Edge: значок установки в адресной строке → «Установить». Mac: Safari → Файл → «Добавить в Dock».')}
          tone={canInstall ? 'accent' : undefined}
          chevron={canInstall}
          onClick={canInstall ? () => void installPwa().then((ok) => ok && toast(t('SuperMind установлен'))) : undefined}
        />
      )}
    </ListSection>
  );
}

function TaskSettings() {
  const data = useTasks((s) => s.data);
  const [perm, setPerm] = useState<NotifyPermission | null>(null);
  const [exact, setExact] = useState<'granted' | 'denied' | 'n/a'>('n/a');
  const [fullScreen, setFullScreen] = useState<'granted' | 'denied' | 'n/a'>('n/a');
  const [cals, setCals] = useState<PhoneCalendar[]>([]);
  // календарь — свой у каждого телефона (номер календаря на другом устройстве означает другое)
  const [calId, setCalId] = useState(() => (data ? (phoneCalendarId(data) ?? '') : ''));
  const native = isNative();
  // будильники и календарь телефона — свои плагины только в приложении для Android
  const android = isAndroidApp();

  useEffect(() => {
    void ensureTasks();
    void notifyPermission().then(setPerm);
    void exactAlarmState().then(setExact);
    void alarmFullScreen().then(setFullScreen);
  }, []);
  useEffect(() => {
    if (android && data?.prefs.calendarSync) void listPhoneCalendars().then((c) => setCals(c.filter((x) => x.writable)));
  }, [android, data?.prefs.calendarSync]);

  if (!data) return null;
  const p = data.prefs;
  const one = (arr: number[]) => (arr.length ? String(arr[0]) : 'none');
  const fromSel = (v: string) => (v === 'none' ? [] : [Number(v)]);

  return (
    <>
      <ListSection
        header={t('Задачи и напоминания')}
        footer={
          !native &&
          (isIOS()
            ? t('iPhone: уведомления работают, когда SuperMind добавлен на экран «Домой» (iOS 16.4+) и запущен. Чтобы напоминание пришло даже при закрытом приложении, добавьте задачи в Календарь iPhone — он напомнит сам.')
            : t('В браузере напоминания приходят, пока вкладка или установленное приложение открыто. В APK для Android напоминания работают всегда.'))
        }
      >
        <SwitchRow
          icon={<IconTile icon={BellRinging} tone="red" size="list" />}
          title={t('Напоминания')}
          subtitle={t('О задачах и привычках')}
          checked={p.notify}
          onChange={(v) => setPrefs({ notify: v })}
        />
        {perm && (
          <ListRow
            icon={<IconTile icon={EyeIcon} tone="gray" size="list" />}
            title={t('Уведомления')}
            subtitle={perm === 'denied' ? t('Включите в настройках телефона или браузера') : undefined}
            value={perm === 'prompt' ? undefined : PERM_SHORT[perm]}
            trailing={
              perm === 'prompt' ? (
                <button className="btn btn-sm btn-tinted" onClick={async () => setPerm(await requestNotifyPermission())}>
                  {t('Разрешить')}
                </button>
              ) : undefined
            }
          />
        )}
        {android && exact === 'denied' && (
          <ListRow
            icon={<IconTile icon={Alarm} tone="orange" size="list" />}
            title={t('Точные будильники выключены')}
            subtitle={t('Напоминания могут опаздывать')}
            trailing={
              <button className="btn btn-sm btn-tinted" onClick={() => void openExactAlarmSettings().then(() => exactAlarmState().then(setExact))}>
                {t('Включить')}
              </button>
            }
          />
        )}
        {android && fullScreen === 'denied' && (
          <ListRow
            icon={<IconTile icon={Alarm} tone="orange" size="list" />}
            title={t('Будильник не откроется на заблокированном экране')}
            subtitle={t('Разрешите «Полноэкранные уведомления» — звонить он будет и так')}
            trailing={
              <button className="btn btn-sm btn-tinted" onClick={() => void openAlarmFullScreenSettings().then(() => alarmFullScreen().then(setFullScreen))}>
                {t('Разрешить')}
              </button>
            }
          />
        )}
        <ListRow
          icon={<IconTile icon={Alarm} tone="orange" size="list" />}
          title={t('Проверить будильник')}
          subtitle={android ? t('Напоминание-будильник: включается в окне даты задачи → «Как будильник»') : t('Звонит, пока SuperMind открыт. Включается в окне даты задачи → «Как будильник»')}
          chevron
          onClick={() => void testAlarm()}
        />
      </ListSection>

      <PushCard />

      <ListSection
        header={t('По умолчанию')}
        footer={t('Настойчивое напоминание повторяется 3 раза, пока задача не выполнена. Утренний брифинг — план на день в уведомлении. «Серия под угрозой» — одно вечернее напоминание, если серия активных дней от 2 дней, а сегодня ещё ничего не отмечено.')}
      >
        <SelectRow
          title={t('Задачи со временем')}
          value={one(p.timedReminders)}
          options={[{ value: 'none', label: t('Без напоминания') }, ...TIMED_REMINDER_OPTIONS.map((o) => ({ value: String(o.v), label: o.label }))]}
          onChange={(v) => setPrefs({ timedReminders: fromSel(v) })}
        />
        <SelectRow
          title={t('Задачи на весь день')}
          value={one(p.allDayReminders)}
          options={[{ value: 'none', label: t('Без напоминания') }, ...ALLDAY_REMINDER_OPTIONS.map((o) => ({ value: String(o.v), label: o.label }))]}
          onChange={(v) => setPrefs({ allDayReminders: fromSel(v) })}
        />
        <SelectRow
          title={t('Настойчивое')}
          value={String(p.nag)}
          options={[{ value: '0', label: t('Выключено') }, ...[5, 10, 15, 30].map((n) => ({ value: String(n), label: t('Каждые {n} мин', { n }) }))]}
          onChange={(v) => setPrefs({ nag: Number(v) })}
        />
        <SelectRow
          title={t('Утренний брифинг')}
          value={p.briefing ?? '08:00'}
          options={[
            { value: '', label: t('Выключен') },
            ...['06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00'].map((hm) => ({ value: hm, label: t('В {time}', { time: hm }) })),
          ]}
          onChange={(v) => setPrefs({ briefing: v })}
        />
        <SelectRow
          title={t('Серия под угрозой')}
          value={p.streakSaver ?? (perm === 'granted' ? STREAK_SAVER_DEFAULT : '')}
          options={[
            { value: '', label: t('Выключено') },
            ...['19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'].map((hm) => ({ value: hm, label: t('В {time}', { time: hm }) })),
          ]}
          onChange={(v) => setPrefs({ streakSaver: v })}
        />
      </ListSection>

      <ListSection
        header={t('Календарь телефона')}
        footer={
          android
            ? undefined
            : isIOSApp()
              ? t('Выгрузите задачи файлом .ics — Календарь iPhone добавит их вместе с напоминаниями.')
              : t('Автоматическая запись в календарь работает в приложении для Android. Здесь можно выгрузить задачи файлом .ics — его принимают Календарь iPhone, Google Календарь и Outlook.')
        }
      >
        {android && (
          <>
            <SwitchRow
              icon={<IconTile icon={CalendarBlank} tone="red" size="list" />}
              title={t('Записывать задачи в календарь')}
              subtitle={t('Задачи с датой появятся в календаре телефона')}
              checked={p.calendarSync}
              onChange={async (v) => {
                if (v) await enableCalendarSync();
                else {
                  setPrefs({ calendarSync: false });
                  void syncCalendar();
                }
              }}
            />
            {p.calendarSync && cals.length > 0 && (
              <SelectRow
                title={t('Календарь')}
                value={calId}
                options={[
                  { value: '', label: t('Основной календарь') },
                  ...cals.map((c) => ({ value: c.id, label: `${c.name}${c.account && c.account !== c.name ? ` (${c.account})` : ''}` })),
                ]}
                onChange={(v) => {
                  setPhoneCalendarId(v || undefined);
                  setCalId(v);
                  void syncCalendar();
                }}
              />
            )}
            <SwitchRow
              icon={<IconTile icon={Repeat} tone="blue" size="list" />}
              title={t('События телефона')}
              subtitle={t('Показывать в разделе «Календарь»')}
              checked={p.showPhoneEvents}
              onChange={(v) => setPrefs({ showPhoneEvents: v })}
            />
          </>
        )}
        <ListRow
          icon={<IconTile icon={CalendarPlus} tone="red" size="list" />}
          title={t('Все задачи в календарь (.ics)')}
          tone="accent"
          onClick={() => void exportTasksIcs(data.tasks.filter((t) => !t.done))}
        />
      </ListSection>
    </>
  );
}
