import { useEffect, useState, type CSSProperties } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { isNative } from '../platform';
import { AccountCard, PushCard } from '../ui/AccountCard';
import { DataCard } from '../ui/DataCard';
import { ACCENTS, DEFAULT_ACCENT } from '../ui/appearance';
import { isIOS } from '../io/download';
import { ensureTasks, setPrefs, useTasks } from '../tasks/store';
import { ALLDAY_REMINDER_OPTIONS, TIMED_REMINDER_OPTIONS } from '../tasks/model';
import {
  enableCalendarSync,
  exactAlarmState,
  exportTasksIcs,
  listPhoneCalendars,
  notifyPermission,
  openExactAlarmSettings,
  requestNotifyPermission,
  STREAK_SAVER_DEFAULT,
  syncCalendar,
  type NotifyPermission,
  type PhoneCalendar,
} from '../tasks/sync';
import { useApp, toast } from '../store/appStore';
import { AI_MODELS, streamText, AIError } from '../ai/claude';
import { openWhatsNew } from '../onboarding/state';
import { openSupport, SupportHost } from '../ui/Support';
import { Bug, Lightbulb } from '@phosphor-icons/react';
import { APP_VERSION } from '../store/safety';
import { IconTile } from '../ui/icons';
import { ListCell, ListRow, ListSection, SelectRow, SwitchRow } from '../ui/list';
import { celebrate, celebrationsOn, setCelebrations } from '../ui/celebrate';
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
} from '@phosphor-icons/react';

export default function Settings() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
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

  const saveKey = () => {
    setSettings({ apiKey: key.trim() });
    toast(key.trim() ? 'Ключ сохранён' : 'Ключ удалён');
  };

  const test = async () => {
    saveKey();
    setTesting(true);
    try {
      const r = await streamText({ system: 'Отвечай одним словом.', messages: [{ role: 'user', content: 'Скажи «работает»' }], effort: 'low' });
      toast('✅ ИИ ' + r.trim().toLowerCase());
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
        <h1>Настройки</h1>
      </div>
      <div className="page-body">
        <div className="settings">
          <AccountCard />

          <ListSection
            header="Искусственный интеллект"
            footer={
              <>
                ИИ-функции (генерация карт, мозговой штурм, задачи, резюме, перевод, чат) работают на Claude от Anthropic. Ключ можно получить на{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                  console.anthropic.com
                </a>
                . Он хранится только на этом устройстве и отправляется напрямую в Anthropic.
              </>
            }
          >
            <div className="ls-field has-icon">
              <IconTile icon={Key} tone="magenta" size="list" />
              <input
                className="ls-input"
                type={show ? 'text' : 'password'}
                autoComplete="off"
                placeholder="API-ключ sk-ant-…"
                aria-label="API-ключ"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onBlur={saveKey}
              />
              <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Скрыть ключ' : 'Показать ключ'}>
                {show ? <EyeOff /> : <Eye />}
              </button>
            </div>
            <SelectRow
              icon={<IconTile icon={Cpu} tone="indigo" size="list" />}
              title="Модель"
              value={model.id}
              display={model.name.split(' — ')[0].replace(/^Claude /, '')}
              options={AI_MODELS.map((m) => ({ value: m.id, label: m.name }))}
              onChange={(v) => setSettings({ model: v })}
            />
            <ListRow
              icon={<IconTile icon={Sparkle} tone="violet" size="list" />}
              title={testing ? 'Проверяю…' : 'Проверить подключение'}
              tone="accent"
              onClick={() => void test()}
              disabled={!key.trim() || testing}
            />
          </ListSection>

          <TaskSettings />

          <ListSection header="Оформление">
            <ListCell>
              <div className="segmented" role="tablist" aria-label="Тема">
                <button className={settings.theme === 'system' ? 'active' : ''} onClick={() => setSettings({ theme: 'system' })}>
                  <CircleHalf size={15} weight="fill" /> Авто
                </button>
                <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => setSettings({ theme: 'light' })}>
                  <SunHorizon size={15} weight="fill" /> Светлая
                </button>
                <button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => setSettings({ theme: 'dark' })}>
                  <Moon size={15} weight="fill" /> Тёмная
                </button>
              </div>
            </ListCell>
            <SelectRow
              icon={<IconTile icon={Drop} tone="cyan" size="list" />}
              title="Стекло"
              value={settings.glass ?? 'liquid'}
              options={[
                { value: 'liquid', label: 'Liquid Glass' },
                { value: 'soft', label: 'Спокойное' },
              ]}
              onChange={(v) => setSettings({ glass: v as 'liquid' | 'soft' })}
            />
            <SelectRow
              icon={<IconTile icon={ImageIcon} tone="orange" size="list" />}
              title="Фон"
              value={settings.backdrop ?? 'aurora'}
              options={[
                { value: 'aurora', label: 'Аврора' },
                { value: 'gradient', label: 'Мягкий' },
                { value: 'plain', label: 'Однотонный' },
              ]}
              onChange={(v) => setSettings({ backdrop: v as 'aurora' | 'gradient' | 'plain' })}
            />
            <SwitchRow
              icon={<IconTile icon={Confetti} tone="rose" size="list" />}
              title="Анимации успехов"
              subtitle="Конфетти за новый уровень, серию и выполненные привычки"
              checked={cheers}
              onChange={(v) => {
                setCelebrations(v);
                setCheers(v);
                if (v) celebrate();
              }}
            />
          </ListSection>

          <ListSection header="Цвет акцента" footer="Цвет кнопок, выбранных вкладок и отметок во всём приложении.">
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

          <DataCard />

          <ListSection header="Установка на телефон">
            <ListRow
              icon={<IconTile icon={AppleLogo} tone="gray" size="list" />}
              title="iPhone"
              subtitle="Откройте сайт в Safari → «Поделиться» → «На экран „Домой“». Приложение будет работать как обычное, в том числе офлайн."
            />
            <ListRow
              icon={<IconTile icon={AndroidLogo} tone="green" size="list" />}
              title="Android"
              subtitle="Установите APK-файл SuperMind или в Chrome откройте меню ⋮ → «Установить приложение»."
            />
          </ListSection>

          <ListSection header="Поддержка" footer="Нашли ошибку или есть идея? Напишите — ответим на почту аккаунта.">
            <ListRow icon={<IconTile icon={Bug} tone="red" size="list" />} title="Сообщить о проблеме" chevron onClick={() => openSupport('problem')} />
            <ListRow icon={<IconTile icon={Lightbulb} tone="yellow" size="list" />} title="Предложить идею" chevron onClick={() => openSupport('idea')} />
          </ListSection>
          <SupportHost />

          <ListSection
            header="О приложении"
            footer="SuperMind — бесплатные интеллект-карты, задачи с напоминаниями, календарь, привычки, ИИ-ассистент, заметки, цели, финансы, прогресс, фокус, и доска задач. Все функции открыты, без подписок."
          >
            <ListRow icon={<IconTile icon={InfoIcon} tone="gray" size="list" />} title="Версия" value={APP_VERSION} />
            <ListRow icon={<IconTile icon={Sparkle} tone="accent" size="list" />} title="Что нового" chevron onClick={openWhatsNew} />
          </ListSection>
        </div>
      </div>
    </div>
  );
}

const PERM_SHORT: Record<NotifyPermission, string> = {
  granted: 'Разрешены',
  denied: 'Запрещены',
  prompt: 'Не разрешены',
  unsupported: 'Недоступны',
};

function TaskSettings() {
  const data = useTasks((s) => s.data);
  const [perm, setPerm] = useState<NotifyPermission | null>(null);
  const [exact, setExact] = useState<'granted' | 'denied' | 'n/a'>('n/a');
  const [cals, setCals] = useState<PhoneCalendar[]>([]);
  const native = isNative();

  useEffect(() => {
    void ensureTasks();
    void notifyPermission().then(setPerm);
    void exactAlarmState().then(setExact);
  }, []);
  useEffect(() => {
    if (native && data?.prefs.calendarSync) void listPhoneCalendars().then((c) => setCals(c.filter((x) => x.writable)));
  }, [native, data?.prefs.calendarSync]);

  if (!data) return null;
  const p = data.prefs;
  const one = (arr: number[]) => (arr.length ? String(arr[0]) : 'none');
  const fromSel = (v: string) => (v === 'none' ? [] : [Number(v)]);

  return (
    <>
      <ListSection
        header="Задачи и напоминания"
        footer={
          !native &&
          (isIOS()
            ? 'iPhone: уведомления работают, когда SuperMind добавлен на экран «Домой» (iOS 16.4+) и запущен. Чтобы напоминание пришло даже при закрытом приложении, добавьте задачи в Календарь iPhone — он напомнит сам.'
            : 'В браузере напоминания приходят, пока вкладка или установленное приложение открыто. В APK для Android напоминания работают всегда.')
        }
      >
        <SwitchRow
          icon={<IconTile icon={BellRinging} tone="red" size="list" />}
          title="Напоминания"
          subtitle="О задачах и привычках"
          checked={p.notify}
          onChange={(v) => setPrefs({ notify: v })}
        />
        {perm && (
          <ListRow
            icon={<IconTile icon={EyeIcon} tone="gray" size="list" />}
            title="Уведомления"
            subtitle={perm === 'denied' ? 'Включите в настройках телефона или браузера' : undefined}
            value={perm === 'prompt' ? undefined : PERM_SHORT[perm]}
            trailing={
              perm === 'prompt' ? (
                <button className="btn btn-sm btn-tinted" onClick={async () => setPerm(await requestNotifyPermission())}>
                  Разрешить
                </button>
              ) : undefined
            }
          />
        )}
        {native && exact === 'denied' && (
          <ListRow
            icon={<IconTile icon={Alarm} tone="orange" size="list" />}
            title="Точные будильники выключены"
            subtitle="Напоминания могут опаздывать"
            trailing={
              <button className="btn btn-sm btn-tinted" onClick={() => void openExactAlarmSettings().then(() => exactAlarmState().then(setExact))}>
                Включить
              </button>
            }
          />
        )}
      </ListSection>

      <PushCard />

      <ListSection
        header="По умолчанию"
        footer="Настойчивое напоминание повторяется 3 раза, пока задача не выполнена. Утренний брифинг — план на день в уведомлении. «Серия под угрозой» — одно вечернее напоминание, если серия активных дней от 2 дней, а сегодня ещё ничего не отмечено."
      >
        <SelectRow
          title="Задачи со временем"
          value={one(p.timedReminders)}
          options={[{ value: 'none', label: 'Без напоминания' }, ...TIMED_REMINDER_OPTIONS.map((o) => ({ value: String(o.v), label: o.label }))]}
          onChange={(v) => setPrefs({ timedReminders: fromSel(v) })}
        />
        <SelectRow
          title="Задачи на весь день"
          value={one(p.allDayReminders)}
          options={[{ value: 'none', label: 'Без напоминания' }, ...ALLDAY_REMINDER_OPTIONS.map((o) => ({ value: String(o.v), label: o.label }))]}
          onChange={(v) => setPrefs({ allDayReminders: fromSel(v) })}
        />
        <SelectRow
          title="Настойчивое"
          value={String(p.nag)}
          options={[{ value: '0', label: 'Выключено' }, ...[5, 10, 15, 30].map((n) => ({ value: String(n), label: `Каждые ${n} мин` }))]}
          onChange={(v) => setPrefs({ nag: Number(v) })}
        />
        <SelectRow
          title="Утренний брифинг"
          value={p.briefing ?? '08:00'}
          options={[
            { value: '', label: 'Выключен' },
            ...['06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00'].map((t) => ({ value: t, label: `В ${t}` })),
          ]}
          onChange={(v) => setPrefs({ briefing: v })}
        />
        <SelectRow
          title="Серия под угрозой"
          value={p.streakSaver ?? (perm === 'granted' ? STREAK_SAVER_DEFAULT : '')}
          options={[
            { value: '', label: 'Выключено' },
            ...['19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'].map((t) => ({ value: t, label: `В ${t}` })),
          ]}
          onChange={(v) => setPrefs({ streakSaver: v })}
        />
      </ListSection>

      <ListSection
        header="Календарь телефона"
        footer={
          native
            ? undefined
            : 'Автоматическая запись в календарь работает в приложении для Android. Здесь можно выгрузить задачи файлом .ics — его принимают Календарь iPhone, Google Календарь и Outlook.'
        }
      >
        {native && (
          <>
            <SwitchRow
              icon={<IconTile icon={CalendarBlank} tone="red" size="list" />}
              title="Записывать задачи в календарь"
              subtitle="Задачи с датой появятся в календаре телефона"
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
                title="Календарь"
                value={p.calendarId ?? ''}
                options={[
                  { value: '', label: 'Основной календарь' },
                  ...cals.map((c) => ({ value: c.id, label: `${c.name}${c.account && c.account !== c.name ? ` (${c.account})` : ''}` })),
                ]}
                onChange={(v) => setPrefs({ calendarId: v || undefined })}
              />
            )}
            <SwitchRow
              icon={<IconTile icon={Repeat} tone="blue" size="list" />}
              title="События телефона"
              subtitle="Показывать в разделе «Календарь»"
              checked={p.showPhoneEvents}
              onChange={(v) => setPrefs({ showPhoneEvents: v })}
            />
          </>
        )}
        <ListRow
          icon={<IconTile icon={CalendarPlus} tone="red" size="list" />}
          title="Все задачи в календарь (.ics)"
          tone="accent"
          onClick={() => void exportTasksIcs(data.tasks.filter((t) => !t.done))}
        />
      </ListSection>
    </>
  );
}
