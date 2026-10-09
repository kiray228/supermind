/**
 * Первый запуск и обновления:
 * — новое устройство без данных → знакомство (Onboarding);
 * — версия изменилась → «Что нового»;
 * — не открывали 3+ дня → «С возвращением!» (не в один запуск со знакомством или «Что нового»).
 * Для проверки: ?onboarding=1, ?whatsnew=1 и ?welcomeback=1 показывают окна принудительно.
 */
import { useEffect, useState } from 'react';
import { APP_VERSION } from '../store/safety';
import { useCloud } from '../store/cloud';
import { get } from '../store/kv';
import { useWhatsNew, lsGet, lsSet, touchLastOpen, AWAY_DAYS, ONBOARDED_KEY, WHATSNEW_KEY } from './state';
import { entriesFor, isRealVersion } from './changelog';
import Onboarding from './Onboarding';
import WhatsNew from './WhatsNew';
import WelcomeBack from './WelcomeBack';
import './onboarding.css';

/** Есть ли уже данные: карты (кроме приветственной), задачи или привычки */
async function hasUserData(): Promise<boolean> {
  try {
    const [docs, tasks, planner] = await Promise.all([
      get<unknown[]>('docs:index'),
      get<{ tasks?: unknown[] }>('tasks'),
      get<{ habits?: unknown[] }>('planner'),
    ]);
    return (docs?.length ?? 0) > 1 || (tasks?.tasks?.length ?? 0) > 0 || (planner?.habits?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Прочитать и убрать служебный параметр из адреса */
function takeParam(name: string): boolean {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get(name) !== '1') return false;
    url.searchParams.delete(name);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    return true;
  } catch {
    return false;
  }
}

let decided = false;
/** сколько дней не открывали приложение — на момент запуска */
const awayAtLaunch = touchLastOpen();

export default function OnboardingHost() {
  const [onboarding, setOnboarding] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const wn = useWhatsNew((s) => s.open);
  // сначала вход в аккаунт (обязателен), знакомство — после
  const signedIn = useCloud((s) => !!s.account);
  // данные аккаунта уже пришли (или сети нет): иначе на новом устройстве знакомство показалось бы
  // пользователю с данными, а стартовые привычки задвоились бы
  const synced = useCloud((s) => !!s.lastSync || s.status === 'error' || s.status === 'offline');

  useEffect(() => {
    if (decided || !signedIn || !synced) return;
    const t = setTimeout(async () => {
      if (decided) return;
      decided = true;
      const forceOb = takeParam('onboarding');
      const forceWn = takeParam('whatsnew');
      const forceWb = takeParam('welcomeback');
      if (forceOb) return setOnboarding(true);
      if (forceWn) return useWhatsNew.setState({ open: 'auto', since: null });
      if (forceWb) return setWelcome(true);
      const seen = lsGet(WHATSNEW_KEY);
      if (!lsGet(ONBOARDED_KEY)) {
        if (!(await hasUserData())) {
          // новая установка: вместо «Что нового» — знакомство
          lsSet(WHATSNEW_KEY, APP_VERSION);
          setOnboarding(true);
          return;
        }
        lsSet(ONBOARDED_KEY, 'existing');
      }
      if (seen !== APP_VERSION && isRealVersion(APP_VERSION)) {
        if (entriesFor(APP_VERSION, seen, false).length) return useWhatsNew.setState({ open: 'auto', since: seen });
        lsSet(WHATSNEW_KEY, APP_VERSION);
      }
      // после перерыва — тёплое «С возвращением!» (только если в этот запуск других окон нет)
      if (awayAtLaunch >= AWAY_DAYS) setWelcome(true);
    }, 900);
    return () => clearTimeout(t);
  }, [signedIn, synced]);

  const doneOnboarding = () => {
    lsSet(ONBOARDED_KEY, String(Date.now()));
    lsSet(WHATSNEW_KEY, APP_VERSION);
    setOnboarding(false);
  };
  // приложение на iPhone может днями «спать» в памяти — перерыв считаем и при возвращении
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      const away = touchLastOpen();
      if (decided && away >= AWAY_DAYS && !useWhatsNew.getState().open) setWelcome(true);
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);

  const closeWhatsNew = () => {
    lsSet(WHATSNEW_KEY, APP_VERSION);
    useWhatsNew.setState({ open: null, since: null });
  };

  if (!signedIn) return null;
  return (
    <>
      {onboarding && <Onboarding onDone={doneOnboarding} />}
      {wn && !onboarding && <WhatsNew onClose={closeWhatsNew} />}
      {welcome && !wn && !onboarding && <WelcomeBack onClose={() => setWelcome(false)} />}
    </>
  );
}
