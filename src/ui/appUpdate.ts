/**
 * Обновление без переустановки.
 * - Сайт и программа для Windows (окно с сайтом): на сайте новая сборка (version.json) → «Обновить» —
 *   сохранить несохранённое и перезагрузить. Саму программу для Windows обновляет она сама
 *   (tauri-plugin-updater в desktop/src-tauri), здесь — только сайт внутри неё.
 * - Android, APK с сайта: на GitHub новый релиз → «Скачать»: APK открывается в браузере и ставится поверх,
 *   данные остаются (тот же ключ подписи).
 * - Google Play и iPhone обновляет магазин — здесь ничего.
 */
import { create } from 'zustand';
import { isAndroidApp, isNative } from '../platform';
import { APP_VERSION } from '../store/safety';
import { apkUpdate, newer, webUpdate, type AppUpdate } from './updateCheck';

export type { AppUpdate };

declare const __BUILD_ID__: string;
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const RELEASES_API = 'https://api.github.com/repos/kiray228/supermind/releases/latest';
/** версия, о которой просили не напоминать (×) */
const DISMISS_KEY = 'sm-update-dismissed';
/** Android: когда последний раз спрашивали GitHub (без входа — 60 запросов в час на адрес) */
const APK_CHECKED_KEY = 'sm-update-checked';
/** Android: найденное обновление — видно и после перезапуска, до следующей проверки */
const APK_FOUND_KEY = 'sm-update-apk';

const WEB_EVERY = 30 * 60_000;
const APK_EVERY = 6 * 3600_000;


interface UpdateState {
  update: AppUpdate | null;
  checking: boolean;
  dismissed: string | null;
}

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* не страшно */
  }
};

export const useAppUpdate = create<UpdateState>(() => ({ update: null, checking: false, dismissed: lsGet(DISMISS_KEY) }));

type Mode = 'web' | 'apk' | 'none';
let modeP: Promise<Mode> | null = null;
function mode(): Promise<Mode> {
  modeP ??= (async () => {
    if (import.meta.env.DEV) return 'none';
    if (!isNative()) return 'web';
    // iPhone — App Store
    if (!isAndroidApp()) return 'none';
    const { nativeInstallSource } = await import('../native/widget');
    return (await nativeInstallSource()) === 'com.android.vending' ? 'none' : 'apk';
  })();
  return modeP;
}

/** Обновления проверяются в этой версии приложения (для Настроек) */
export const updatesSupported = async () => (await mode()) !== 'none';

let lastWeb = 0;
let running: Promise<AppUpdate | null> | null = null;

/** Проверить сейчас. manual — по кнопке: и Android без паузы в 6 часов */
export function checkForUpdate(manual = false): Promise<AppUpdate | null> {
  running ??= (async () => {
    const m = await mode();
    if (m === 'none') return null;
    if (!manual && m === 'apk' && Date.now() - Number(lsGet(APK_CHECKED_KEY) || 0) < APK_EVERY) return useAppUpdate.getState().update;
    useAppUpdate.setState({ checking: true });
    try {
      let u: AppUpdate | null;
      if (m === 'web') {
        lastWeb = Date.now();
        const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
        u = r.ok ? webUpdate(await r.json(), BUILD, APP_VERSION) : null;
      } else {
        const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
        if (!r.ok) return useAppUpdate.getState().update;
        lsSet(APK_CHECKED_KEY, String(Date.now()));
        u = apkUpdate(await r.json(), APP_VERSION);
        lsSet(APK_FOUND_KEY, u ? JSON.stringify(u) : '');
      }
      useAppUpdate.setState({ update: u });
      return u;
    } catch {
      // нет сети — спросим в следующий раз
      return useAppUpdate.getState().update;
    } finally {
      useAppUpdate.setState({ checking: false });
      running = null;
    }
  })();
  return running;
}

/** Плашку этой версии больше не показывать (в Настройках обновление остаётся) */
export function dismissUpdate() {
  const v = useAppUpdate.getState().update?.version ?? '';
  lsSet(DISMISS_KEY, v);
  useAppUpdate.setState({ dismissed: v });
}

/** Записать всё несохранённое во всех разделах */
async function flushAll() {
  // разделы, которые сохраняются по pagehide (заметки, привычки и др.)
  window.dispatchEvent(new Event('pagehide'));
  const tasks: Promise<unknown>[] = [
    import('../store/docStore').then((m) => m.settleSave()),
    import('../tasks/store').then((m) => m.flushTasks()),
    import('../finance/store').then((m) => m.flushFinance()),
    import('../goals/store').then((m) => m.flushGoals()),
  ];
  await Promise.all(tasks.map((p) => p.catch(() => {})));
  await new Promise((r) => setTimeout(r, 300));
}

let applying = false;
/** «Обновить»: сайт — сохранить и перезагрузить; Android — скачать новый APK */
export async function applyUpdate() {
  const u = useAppUpdate.getState().update;
  if (!u || applying) return;
  const { toast } = await import('../store/appStore');
  if (u.kind === 'apk') {
    const { nativeOpenUrl } = await import('../native/widget');
    try {
      await nativeOpenUrl(u.url!);
      toast(`Скачивается SuperMind ${u.version}. Откройте файл и нажмите «Установить» — карты и задачи останутся`);
    } catch {
      toast('Не удалось открыть браузер. Скачайте новую версию на сайте SuperMind');
    }
    return;
  }
  applying = true;
  try {
    await flushAll();
    // новый service worker — чтобы офлайн-копия тоже была новой
    await navigator.serviceWorker
      ?.getRegistration()
      .then((r) => r?.update())
      .catch(() => {});
    location.reload();
  } catch {
    applying = false;
    toast('Не удалось обновить — попробуйте ещё раз');
  }
}

/** Проверять при запуске, каждые полчаса и при возвращении в приложение */
let started = false;
export function initAppUpdates() {
  if (started) return;
  started = true;
  void mode().then((m) => {
    if (m === 'none') return;
    if (m === 'apk') {
      try {
        const u = JSON.parse(lsGet(APK_FOUND_KEY) || 'null') as AppUpdate | null;
        // уже обновились — забыть
        if (u?.url && newer(u.version, APP_VERSION)) useAppUpdate.setState({ update: u });
      } catch {
        /* нет сохранённого */
      }
    }
    setTimeout(() => void checkForUpdate(), 30_000);
    setInterval(() => void checkForUpdate(), m === 'web' ? WEB_EVERY : APK_EVERY);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (m === 'apk' || Date.now() - lastWeb > 10 * 60_000) void checkForUpdate();
    });
  });
}
