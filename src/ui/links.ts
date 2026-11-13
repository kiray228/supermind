/** Внешние страницы SuperMind и открытие ссылок в браузере телефона */
import { isAndroidApp } from '../platform';

export const PRIVACY_URL = 'https://supermind.kz/privacy.html';
export const DELETE_ACCOUNT_URL = 'https://supermind.kz/delete-account.html';

/**
 * Открыть ссылку в браузере: Android — системным браузером (WebView сам новые окна не открывает),
 * iPhone и сайт — новым окном (на iPhone Capacitor отдаёт его Safari).
 */
export async function openExternal(url: string): Promise<void> {
  if (isAndroidApp()) {
    try {
      const { nativeOpenUrl } = await import('../native/widget');
      await nativeOpenUrl(url);
      return;
    } catch {
      /* старая сборка без openUrl — как на сайте */
    }
  }
  window.open(url, '_blank', 'noopener');
}
