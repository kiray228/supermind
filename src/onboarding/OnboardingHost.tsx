/**
 * Первый запуск и обновления:
 * — новое устройство без данных → знакомство (Onboarding);
 * — версия изменилась → «Что нового».
 * Для проверки: ?onboarding=1 и ?whatsnew=1 показывают окна принудительно.
 */
import { useEffect, useState } from 'react';
import { APP_VERSION } from '../store/safety';
import { get } from '../store/kv';
import { useWhatsNew, lsGet, lsSet, ONBOARDED_KEY, WHATSNEW_KEY } from './state';
import { entriesFor, isRealVersion } from './changelog';
import Onboarding from './Onboarding';
import WhatsNew from './WhatsNew';
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

export default function OnboardingHost() {
  const [onboarding, setOnboarding] = useState(false);
  const wn = useWhatsNew((s) => s.open);

  useEffect(() => {
    if (decided) return;
    const t = setTimeout(async () => {
      if (decided) return;
      decided = true;
      const forceOb = takeParam('onboarding');
      const forceWn = takeParam('whatsnew');
      if (forceOb) return setOnboarding(true);
      if (forceWn) return useWhatsNew.setState({ open: 'auto', since: null });
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
      if (seen === APP_VERSION || !isRealVersion(APP_VERSION)) return;
      if (entriesFor(APP_VERSION, seen, false).length) useWhatsNew.setState({ open: 'auto', since: seen });
      else lsSet(WHATSNEW_KEY, APP_VERSION);
    }, 900);
    return () => clearTimeout(t);
  }, []);

  const doneOnboarding = () => {
    lsSet(ONBOARDED_KEY, String(Date.now()));
    lsSet(WHATSNEW_KEY, APP_VERSION);
    setOnboarding(false);
  };
  const closeWhatsNew = () => {
    lsSet(WHATSNEW_KEY, APP_VERSION);
    useWhatsNew.setState({ open: null, since: null });
  };

  return (
    <>
      {onboarding && <Onboarding onDone={doneOnboarding} />}
      {wn && !onboarding && <WhatsNew onClose={closeWhatsNew} />}
    </>
  );
}
