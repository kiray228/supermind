/** Знакомство с приложением: 6 шагов с пролистыванием */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellRing,
  Bot,
  CalendarRange,
  Check,
  CheckSquare,
  Cloud,
  HardDrive,
  Laptop,
  Network,
  CalendarDays,
  Repeat,
  ShieldCheck,
  Smartphone,
  StickyNote,
  Sunrise,
  Target,
  Wallet,
} from 'lucide-react';
import { useApp } from '../store/appStore';
import { useCloud } from '../store/cloud';
import { ACCENTS, DEFAULT_ACCENT } from '../ui/appearance';
import { HABIT_LIBRARY, habitFromPreset, type HabitPreset } from '../habits/library';
import { loadPlanner, savePlanner } from '../store/db';
import { notifyPermission, requestNotifyPermission, syncSoon, type NotifyPermission } from '../tasks/sync';
import { onBack } from '../ui/dialogs';
import { TAB_INFO, TAB_SLOTS, tabsFromInterests, type TabBlock } from '../store/phoneNav';
import { IconTile } from '../ui/icons';
import { t } from '../i18n/index';

const STARTER_NAMES = ['Пить воду', 'Зарядка', 'Чтение', 'Медитация', 'План на день', 'Прогулка', 'Лечь спать до 23:00', 'Записать расходы'];
// библиотека привычек может быть переведена — ищем и по русскому названию, и по переводу
const findPreset = (n: string) => HABIT_LIBRARY.find((p) => p.name === n || p.name === t(n));
const STARTERS: HabitPreset[] = STARTER_NAMES.map(findPreset).filter((p): p is HabitPreset => !!p);

const MODULES: { icon: typeof Network; label: string }[] = [
  { icon: Network, label: t('Карты') },
  { icon: CheckSquare, label: t('Задачи') },
  { icon: CalendarDays, label: t('Календарь') },
  { icon: Repeat, label: t('Привычки') },
  { icon: Target, label: t('Цели') },
  { icon: Wallet, label: t('Финансы') },
  { icon: StickyNote, label: t('Заметки') },
  { icon: Bot, label: t('ИИ-ассистент') },
];

const STEPS = 6;
/** Что важно — сколько можно выбрать: в панели «Сегодня» и ещё два раздела */
const PICK_MAX = TAB_SLOTS - 1;
const INTERESTS: TabBlock[] = ['home', 'notes', 'tasks', 'calendar', 'habits', 'health', 'finance', 'goals', 'focus', 'assistant'];

/** Добавить выбранные привычки (без повторов по названию) */
async function addStarterHabits(picked: HabitPreset[]) {
  if (!picked.length) return;
  const p = await loadPlanner();
  const habits = p.habits ?? [];
  const names = new Set(habits.filter((h) => !h.deleted).map((h) => h.name.toLowerCase()));
  const now = Date.now();
  const add = picked.filter((pr) => !names.has(pr.name.toLowerCase())).map((pr) => ({ ...habitFromPreset(pr), createdAt: now, updatedAt: now }));
  if (!add.length) return;
  await savePlanner({ ...p, days: p.days ?? {}, habits: [...habits, ...add] });
  window.dispatchEvent(new Event('sm-planner-changed'));
  syncSoon(300);
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [dx, setDx] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(['Пить воду', 'Чтение'].map((n) => findPreset(n)?.name ?? n)));
  const [perm, setPerm] = useState<NotifyPermission | null>(null);
  const [wants, setWants] = useState<TabBlock[]>([]);
  const accent = useApp((s) => s.settings.accent) ?? DEFAULT_ACCENT;
  // без аккаунта знакомство тоже показывается — последний слайд не должен обещать облако
  const account = useCloud((s) => !!s.account);
  const drag = useRef<{ x: number; y: number; id: number; active: boolean } | null>(null);
  const busy = useRef(false);

  const go = (n: number) => setStep(Math.max(0, Math.min(STEPS - 1, n)));

  /** skip — «Пропустить»: ничего не добавляем */
  const finish = async (to: 'home' | 'settings', skip = false) => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!skip) await addStarterHabits(STARTERS.filter((p) => picked.has(p.name)));
    } catch {
      /* привычки можно добавить и позже */
    }
    // нижняя панель: «Сегодня» и выбранное (не выбрали — как было)
    if (!skip && wants.length) useApp.getState().setTabs(tabsFromInterests(wants));
    onDone();
    // «Начать» — на экран дня (привычки, задачи, деньги); настройки — как просили
    useApp.getState().go(to === 'home' ? 'today' : to);
  };

  useEffect(() => {
    void notifyPermission()
      .then(setPerm)
      .catch(() => setPerm('unsupported'));
  }, []);

  // «назад» на Android и клавиши-стрелки
  useEffect(() => {
    const off = onBack(() => {
      setStep((s) => Math.max(0, s - 1));
      return true;
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((s) => Math.min(STEPS - 1, s + 1));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const onPointerDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false };
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my)) {
        if (Math.abs(my) > 12) drag.current = null;
        return;
      }
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    // у краёв — сопротивление
    const edge = (step === 0 && mx > 0) || (step === STEPS - 1 && mx < 0);
    setDx(edge ? mx / 3 : mx);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    if (dx < -50) go(step + 1);
    else if (dx > 50) go(step - 1);
    setDx(0);
  };

  const toggle = (name: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const want = (tab: TabBlock) =>
    setWants((w) => (w.includes(tab) ? w.filter((x) => x !== tab) : w.length >= PICK_MAX ? [...w.slice(1), tab] : [...w, tab]));

  const enableNotify = async () => {
    setPerm(await requestNotifyPermission());
  };

  const last = step === STEPS - 1;

  return (
    <div className="ob-root" role="dialog" aria-modal="true" aria-label={t('Знакомство с SuperMind')}>
      <div className="ob-glow" aria-hidden="true" />
      <div className="ob-card">
        <header className="ob-top">
          <div className="ob-brand">
            <img src="./icon.svg" alt="" width={24} height={24} />
            <span>SuperMind</span>
          </div>
          {!last && (
            <button className="btn btn-ghost btn-sm ob-skip" onClick={() => void finish('home', true)}>
              {t('Пропустить')}
            </button>
          )}
        </header>

        <div
          className="ob-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className={`ob-track${dx ? ' dragging' : ''}`} style={{ transform: `translateX(calc(${-step * 100}% + ${dx}px))` }}>
            {/* 1. Что такое SuperMind */}
            <section className="ob-slide" aria-hidden={step !== 0} inert={step !== 0}>
              <div className="ob-art ob-art-hero">
                <div className="ob-hero-ring" />
                <div className="ob-hero-logo">
                  <img src="./icon.svg" alt="" width={64} height={64} />
                </div>
              </div>
              <h1 className="ob-title">{t('Добро пожаловать в SuperMind')}</h1>
              <p className="ob-text">{t('Интеллект-карты, задачи и вся ваша жизнь — в одном бесплатном приложении. Без подписок.')}</p>
              <div className="ob-modules">
                {MODULES.map((m, i) => (
                  <div key={m.label} className="ob-module" style={{ animationDelay: `${i * 45}ms` }}>
                    <m.icon size={20} />
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* 2. Всё в одном месте */}
            <section className="ob-slide" aria-hidden={step !== 1} inert={step !== 1}>
              <div className="ob-art ob-flow" aria-hidden="true">
                <div className="ob-flow-node">
                  <Network size={22} />
                  <span>{t('Идея')}</span>
                </div>
                <i className="ob-flow-line" />
                <div className="ob-flow-node">
                  <CheckSquare size={22} />
                  <span>{t('Задача')}</span>
                </div>
                <i className="ob-flow-line" />
                <div className="ob-flow-node">
                  <CalendarRange size={22} />
                  <span>{t('План')}</span>
                </div>
              </div>
              <h1 className="ob-title">{t('Всё в одном месте')}</h1>
              <p className="ob-text">{t('Разделы связаны между собой — не нужно держать пять приложений.')}</p>
              <ul className="ob-list">
                <li>
                  <Network size={18} /> {t('Задачи из карт попадают в общий список')}
                </li>
                <li>
                  <CalendarRange size={18} /> {t('Задачи, привычки и сроки целей — в одном календаре')}
                </li>
                <li>
                  <Wallet size={18} /> {t('Финансы, цели и заметки всегда под рукой')}
                </li>
                <li>
                  <Bot size={18} /> {t('ИИ-ассистент видит всё и подсказывает следующий шаг')}
                </li>
              </ul>
            </section>

            {/* 3. Что важно — разделы нижней панели */}
            <section className="ob-slide" aria-hidden={step !== 2} inert={step !== 2}>
              <h1 className="ob-title">{t('Что для вас важнее всего?')}</h1>
              <p className="ob-text">{t('Выберите до {n} разделов — они встанут в нижнюю панель рядом с «Сегодня». Поменять можно в любой момент в «Ещё».', { n: PICK_MAX })}</p>
              <div className="ob-habits">
                {INTERESTS.map((tab) => {
                  const n = wants.indexOf(tab);
                  return (
                    <button key={tab} className={`ob-habit${n >= 0 ? ' active' : ''}`} aria-pressed={n >= 0} onClick={() => want(tab)}>
                      <span className="ob-habit-ico">
                        <IconTile section={tab} size="list" />
                      </span>
                      <span className="ob-habit-txt">
                        <b>{TAB_INFO[tab].title}</b>
                        <small>{TAB_INFO[tab].hint}</small>
                      </span>
                      <span className="ob-habit-check">{n >= 0 && <Check size={14} />}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 4. Под себя: цвет и привычки */}
            <section className="ob-slide" aria-hidden={step !== 3} inert={step !== 3}>
              <h1 className="ob-title">{t('Сделайте своим')}</h1>
              <p className="ob-text">{t('Цвет оформления')}</p>
              <div className="ob-accents" role="radiogroup" aria-label={t('Цвет оформления')}>
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    role="radio"
                    aria-checked={accent === a.id}
                    title={a.name}
                    aria-label={a.name}
                    className={`ob-accent${accent === a.id ? ' active' : ''}`}
                    style={{ background: `linear-gradient(135deg, ${a.color}, ${a.color2})` }}
                    onClick={() => useApp.getState().setSettings({ accent: a.id })}
                  >
                    {accent === a.id && <Check size={18} />}
                  </button>
                ))}
              </div>
              <p className="ob-text">{t('С каких привычек начнём?')}</p>
              <div className="ob-habits">
                {STARTERS.map((p) => {
                  const on = picked.has(p.name);
                  return (
                    <button key={p.name} className={`ob-habit${on ? ' active' : ''}`} aria-pressed={on} onClick={() => toggle(p.name)}>
                      <span className="ob-habit-ico">{p.icon}</span>
                      <span className="ob-habit-txt">
                        <b>{p.name}</b>
                        <small>{p.why}</small>
                      </span>
                      <span className="ob-habit-check">{on && <Check size={14} />}</span>
                    </button>
                  );
                })}
              </div>
              <p className="ob-hint">{t('Ещё больше — в библиотеке раздела «Привычки».')}</p>
            </section>

            {/* 5. Напоминания и брифинг */}
            <section className="ob-slide" aria-hidden={step !== 4} inert={step !== 4}>
              <div className="ob-art ob-notifs" aria-hidden="true">
                <div className="ob-notif">
                  <span className="ob-notif-ico">
                    <Sunrise size={18} />
                  </span>
                  <span>
                    <b>{t('Доброе утро! План на сегодня')}</b>
                    <small>{t('3 задачи · 4 привычки · платёж завтра')}</small>
                  </span>
                </div>
                <div className="ob-notif">
                  <span className="ob-notif-ico">
                    <Bell size={18} />
                  </span>
                  <span>
                    <b>{t('Чтение · 21:00')}</b>
                    <small>{t('20 минут книги вместо ленты')}</small>
                  </span>
                </div>
              </div>
              <h1 className="ob-title">{t('Напоминания и брифинг')}</h1>
              <p className="ob-text">{t('Напоминания о задачах, привычках и платежах приходят вовремя, а каждое утро — короткий план на день.')}</p>
              <div className="ob-action">
                {perm === 'granted' ? (
                  <div className="ob-ok">
                    <Check size={18} /> {t('Уведомления включены')}
                  </div>
                ) : perm === 'unsupported' ? (
                  <p className="ob-hint">{t('Этот браузер не показывает уведомления — напоминания будут видны в приложении. На телефоне установите SuperMind на главный экран.')}</p>
                ) : perm === 'denied' ? (
                  <p className="ob-hint">{t('Уведомления запрещены — включите их в настройках телефона или браузера.')}</p>
                ) : (
                  <button className="ob-cta" onClick={() => void enableNotify()}>
                    <BellRing size={18} /> {t('Включить уведомления')}
                  </button>
                )}
              </div>
            </section>

            {/* 6. Сохраните данные */}
            <section className="ob-slide" aria-hidden={step !== 5} inert={step !== 5}>
              <div className="ob-art ob-cloud" aria-hidden="true">
                <div className="ob-dev">
                  <Smartphone size={26} />
                </div>
                <div className="ob-cloud-main">
                  <Cloud size={56} strokeWidth={1.6} />
                  <ShieldCheck size={22} className="ob-cloud-shield" />
                </div>
                <div className="ob-dev">
                  <Laptop size={26} />
                </div>
              </div>
              <h1 className="ob-title">{t('Данные в безопасности')}</h1>
              <p className="ob-text">
                {/* одна t() на обе строки: тест release152 проверяет текст ветвей; обе есть в словаре */}
                {t(
                  account
                    ? 'Вы вошли в аккаунт: всё сохраняется в облаке и одинаково на всех устройствах. Без интернета приложение тоже работает.'
                    : 'Всё хранится на этом устройстве и работает без интернета. Войдёте в аккаунт в настройках — данные появятся и на других устройствах.',
                )}
              </p>
              <ul className="ob-list">
                <li>
                  <HardDrive size={18} /> {t('Автокопии на устройстве — каждые 3 часа')}
                </li>
                <li>
                  <Cloud size={18} /> {account ? t('Синхронизация телефона и компьютера') : t('Синхронизация телефона и компьютера — после входа')}
                </li>
                <li>
                  <ShieldCheck size={18} /> {account ? t('Облачные копии каждый час, восстановление в один клик') : t('Облачные копии и восстановление в один клик — после входа')}
                </li>
              </ul>
              <div className="ob-action">
                <button className="ob-cta" onClick={() => void finish('home')}>
                  <Check size={18} /> {t('Начать')}
                </button>
              </div>
            </section>
          </div>
        </div>

        <footer className="ob-bottom">
          <button className="btn btn-ghost ob-back" onClick={() => go(step - 1)} disabled={step === 0} aria-label={t('Назад')}>
            <ArrowLeft size={18} />
          </button>
          <div className="ob-dots" role="tablist" aria-label={t('Шаги')}>
            {Array.from({ length: STEPS }, (_, i) => (
              <button key={i} role="tab" aria-selected={i === step} aria-label={t('Шаг {n}', { n: i + 1 })} className={`ob-dot${i === step ? ' active' : ''}`} onClick={() => go(i)} />
            ))}
          </div>
          {last ? (
            <button className="btn btn-primary ob-next" onClick={() => void finish('home')}>
              {t('Начать')}
            </button>
          ) : (
            <button className="btn btn-primary ob-next" onClick={() => go(step + 1)}>
              {t('Далее')} <ArrowRight size={18} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
