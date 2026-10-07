import { useEffect, useState } from 'react';
import { Sparkles, Sun, Moon, Monitor, Smartphone, Eye, EyeOff, CheckCircle2, Info, BellRing, CalendarPlus } from 'lucide-react';
import { isNative } from '../platform';
import { AccountCard, PushCard } from '../ui/AccountCard';
import { DataCard } from '../ui/DataCard';
import { ACCENTS } from '../ui/appearance';
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
  syncCalendar,
  type NotifyPermission,
  type PhoneCalendar,
} from '../tasks/sync';
import { useApp, toast } from '../store/appStore';
import { AI_MODELS, streamText, AIError } from '../ai/claude';

export default function Settings() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const [key, setKey] = useState(settings.apiKey);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);

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

  return (
    <div className="page">
      <div className="page-header"><h1>Настройки</h1></div>
      <div className="page-body">
        <div className="settings">
          <AccountCard />
          <section className="card set-card">
            <h3><Sparkles size={18} color="var(--accent)" /> Искусственный интеллект</h3>
            <p className="muted small">
              ИИ-функции (генерация карт, мозговой штурм, задачи, резюме, перевод, чат) работают на Claude от Anthropic. Получите ключ на{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> — он хранится только на этом устройстве и отправляется напрямую в Anthropic.
            </p>
            <label className="label">API-ключ</label>
            <div className="row">
              <input className="input" type={show ? 'text' : 'password'} autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} onBlur={saveKey} />
              <button className="icon-btn" onClick={() => setShow(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
            <label className="label">Модель</label>
            <select className="select" value={settings.model} onChange={(e) => setSettings({ model: e.target.value })}>
              {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="btn" style={{ marginTop: 12 }} onClick={test} disabled={!key.trim() || testing}>
              <CheckCircle2 size={16} /> {testing ? 'Проверяю…' : 'Проверить подключение'}
            </button>
          </section>

          <TaskSettings />

          <section className="card set-card">
            <h3>Оформление</h3>
            <div className="segmented">
              <button className={settings.theme === 'system' ? 'active' : ''} onClick={() => setSettings({ theme: 'system' })}><Monitor size={14} /> Авто</button>
              <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => setSettings({ theme: 'light' })}><Sun size={14} /> Светлая</button>
              <button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => setSettings({ theme: 'dark' })}><Moon size={14} /> Тёмная</button>
            </div>
            <label className="label">Цвет акцента</label>
            <div className="ap-accents">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  className={`ap-accent${(settings.accent ?? 'flame') === a.id ? ' active' : ''}`}
                  style={{ '--a1': a.color, '--a2': a.color2 } as React.CSSProperties}
                  onClick={() => setSettings({ accent: a.id })}
                  aria-label={a.name}
                >
                  <i />
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
            <label className="label">Стекло</label>
            <div className="segmented">
              <button className={(settings.glass ?? 'liquid') === 'liquid' ? 'active' : ''} onClick={() => setSettings({ glass: 'liquid' })}>Liquid Glass</button>
              <button className={settings.glass === 'soft' ? 'active' : ''} onClick={() => setSettings({ glass: 'soft' })}>Спокойное</button>
            </div>
            <label className="label">Фон</label>
            <div className="segmented">
              <button className={(settings.backdrop ?? 'aurora') === 'aurora' ? 'active' : ''} onClick={() => setSettings({ backdrop: 'aurora' })}>Аврора</button>
              <button className={settings.backdrop === 'gradient' ? 'active' : ''} onClick={() => setSettings({ backdrop: 'gradient' })}>Мягкий</button>
              <button className={settings.backdrop === 'plain' ? 'active' : ''} onClick={() => setSettings({ backdrop: 'plain' })}>Однотонный</button>
            </div>
          </section>

          <DataCard />

          <section className="card set-card">
            <h3><Smartphone size={18} /> Установка на телефон</h3>
            <p className="small"><b>iPhone:</b> откройте сайт в Safari → «Поделиться» → «На экран „Домой“». Приложение будет работать как обычное, в том числе офлайн.</p>
            <p className="small"><b>Android:</b> установите APK-файл SuperMind или в Chrome откройте меню ⋮ → «Установить приложение».</p>
          </section>

          <section className="card set-card">
            <h3><Info size={18} /> О приложении</h3>
            <p className="small muted" style={{ margin: 0 }}>SuperMind 1.8 — бесплатные интеллект-карты, задачи с напоминаниями, календарь, привычки, ИИ-ассистент, заметки, цели, финансы, прогресс, фокус, ежедневник и доска задач. Все функции открыты, без подписок.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

const PERM_TEXT: Record<NotifyPermission, string> = {
  granted: 'разрешены',
  denied: 'запрещены — включите в настройках телефона/браузера',
  prompt: 'ещё не разрешены',
  unsupported: 'не поддерживаются этим браузером',
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
    <section className="card set-card">
      <h3>
        <BellRing size={18} color="var(--accent)" /> Задачи и напоминания
      </h3>
      <label className="row small" style={{ gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={p.notify} onChange={(e) => setPrefs({ notify: e.target.checked })} />
        Напоминания о задачах и привычках
      </label>
      {perm && (
        <p className="small muted" style={{ margin: '8px 0' }}>
          Уведомления: <b>{PERM_TEXT[perm]}</b>{' '}
          {perm === 'prompt' && (
            <button className="btn btn-sm" onClick={async () => setPerm(await requestNotifyPermission())}>
              Разрешить
            </button>
          )}
        </p>
      )}
      {native && exact === 'denied' && (
        <p className="small muted" style={{ margin: '8px 0' }}>
          Точные будильники выключены — напоминания могут опаздывать.{' '}
          <button className="btn btn-sm" onClick={() => void openExactAlarmSettings().then(() => exactAlarmState().then(setExact))}>
            Включить
          </button>
        </p>
      )}
      <PushCard />
      {!native && (
        <p className="tiny muted" style={{ margin: '6px 0' }}>
          {isIOS()
            ? 'iPhone: уведомления работают, когда SuperMind добавлен на экран «Домой» (iOS 16.4+) и запущен. Чтобы напоминание пришло даже при закрытом приложении, добавьте задачи в Календарь iPhone кнопкой ниже — он напомнит сам.'
            : 'В браузере напоминания приходят, пока вкладка или установленное приложение открыто. В APK для Android напоминания работают всегда.'}
        </p>
      )}
      <label className="label">По умолчанию для задач со временем</label>
      <select className="select" value={one(p.timedReminders)} onChange={(e) => setPrefs({ timedReminders: fromSel(e.target.value) })}>
        <option value="none">Без напоминания</option>
        {TIMED_REMINDER_OPTIONS.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
      <label className="label">По умолчанию для задач на весь день</label>
      <select className="select" value={one(p.allDayReminders)} onChange={(e) => setPrefs({ allDayReminders: fromSel(e.target.value) })}>
        <option value="none">Без напоминания</option>
        {ALLDAY_REMINDER_OPTIONS.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
      <label className="label">Настойчивое напоминание</label>
      <select className="select" value={p.nag} onChange={(e) => setPrefs({ nag: Number(e.target.value) })}>
        <option value={0}>Выключено</option>
        {[5, 10, 15, 30].map((n) => (
          <option key={n} value={n}>
            Повторять каждые {n} мин (3 раза), пока не выполнено
          </option>
        ))}
      </select>

      <label className="label">Утренний брифинг</label>
      <select className="select" value={p.briefing ?? '08:00'} onChange={(e) => setPrefs({ briefing: e.target.value })}>
        <option value="">Выключен</option>
        {['06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00'].map((t) => (
          <option key={t} value={t}>
            Каждый день в {t} — план на день в уведомлении
          </option>
        ))}
      </select>

      <label className="label">Календарь телефона</label>
      {native ? (
        <>
          <label className="row small" style={{ gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={p.calendarSync}
              onChange={async (e) => {
                if (e.target.checked) await enableCalendarSync();
                else {
                  setPrefs({ calendarSync: false });
                  void syncCalendar();
                }
              }}
            />
            Записывать задачи с датой в календарь телефона
          </label>
          {p.calendarSync && cals.length > 0 && (
            <select className="select" style={{ marginTop: 8 }} value={p.calendarId ?? ''} onChange={(e) => setPrefs({ calendarId: e.target.value || undefined })}>
              <option value="">Основной календарь</option>
              {cals.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.account && c.account !== c.name ? `(${c.account})` : ''}
                </option>
              ))}
            </select>
          )}
          <label className="row small" style={{ gap: 10, cursor: 'pointer', marginTop: 8 }}>
            <input type="checkbox" checked={p.showPhoneEvents} onChange={(e) => setPrefs({ showPhoneEvents: e.target.checked })} />
            Показывать события календаря телефона в разделе «Календарь»
          </label>
        </>
      ) : (
        <p className="tiny muted" style={{ margin: 0 }}>
          Автоматическая запись в календарь работает в приложении для Android. Здесь можно выгрузить задачи файлом .ics — его принимают Календарь iPhone, Google Календарь и Outlook.
        </p>
      )}
      <button className="btn" style={{ marginTop: 10 }} onClick={() => void exportTasksIcs(data.tasks.filter((t) => !t.done))}>
        <CalendarPlus size={16} /> Все задачи в календарь (.ics)
      </button>
    </section>
  );
}
