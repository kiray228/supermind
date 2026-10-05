import { Capacitor } from '@capacitor/core';
import { useApp } from './store/appStore';
import { useDoc, flushSave } from './store/docStore';
import { leaveEditor } from './actions';
import { runBack } from './ui/dialogs';

export const isNative = () => Capacitor.isNativePlatform();

/** Сохранить файл в нативном приложении (Android): кэш + системное меню «Поделиться/Сохранить» */
export async function nativeSaveBlob(blob: Blob, filename: string) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const data = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  const written = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
  try {
    // копия в «Документы», чтобы файл остался на устройстве
    await Filesystem.writeFile({ path: '2Mind/' + filename, data, directory: Directory.Documents, recursive: true });
  } catch {
    /* нет разрешения — достаточно «Поделиться» */
  }
  await Share.share({ title: filename, files: [written.uri] });
}

export function setupPlatform() {
  // iOS Safari игнорирует запрет масштабирования страницы — блокируем жесты вручную,
  // чтобы щипок всегда масштабировал карту, а не весь интерфейс
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop);
  document.addEventListener('gesturechange', stop);
  document.addEventListener('gestureend', stop);
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  if (isNative()) {
    document.documentElement.classList.add('native');
    import('@capacitor/app').then(({ App }) => {
      App.addListener('backButton', async () => {
        const app = useApp.getState();
        const doc = useDoc.getState();
        // сначала закрываем окна, меню и панели
        if (runBack()) return;
        if (app.view === 'editor') {
          if (doc.editingId) doc.setEditing(null);
          else await leaveEditor('home');
        } else if (app.view !== 'home') app.go('home');
        else {
          await flushSave();
          App.exitApp();
        }
      });
      App.addListener('pause', () => void flushSave());
    });
    import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      const apply = () => {
        const dark = document.documentElement.dataset.theme === 'dark';
        StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
        StatusBar.setBackgroundColor({ color: dark ? '#17191e' : '#ffffff' }).catch(() => {});
      };
      apply();
      new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    });
    import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide().catch(() => {}));
  } else if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}
