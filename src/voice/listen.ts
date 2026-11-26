/**
 * Распознавание одной фразы: в приложении на Android — системный распознаватель Google
 * (плагин), в браузере — Web Speech API (Chrome, Safari). Бесплатно, без ключей.
 */
import { isNative } from '../platform';
import { t } from '../i18n/index';
import { nativeSession, smSession, webSession, type Listening, type ListenOpts, type NativeSR, type SmSpeechSR, type SRCtor } from './sessions';
export type { Listening, ListenOpts };

function webCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Есть ли распознавание речи (в приложении — проверяется при запуске) */
export const canListen = () => isNative() || !!webCtor();

export async function listen(o: ListenOpts): Promise<Listening | null> {
  if (isNative()) return listenNative(o);
  const C = webCtor();
  return C ? webSession(C, o) : null;
}

interface SmSpeechPlugin extends SmSpeechSR {
  available(): Promise<{ available: boolean }>;
  checkPermissions(): Promise<{ microphone: string }>;
  requestPermissions(o: { permissions: string[] }): Promise<{ microphone: string }>;
}

/** Android: свой модуль SmSpeech (сторонний плагин в режиме диктовки не заканчивал фразу и молча падал на каждом втором запуске) */
async function listenAndroid(o: ListenOpts): Promise<Listening | null> {
  const { registerPlugin } = await import('@capacitor/core');
  const SR = registerPlugin<SmSpeechPlugin>('SmSpeech');
  try {
    const { available } = await SR.available();
    if (!available) {
      o.onError(t('На телефоне нет распознавания речи — установите приложение Google'));
      return null;
    }
    let perm = await SR.checkPermissions();
    if (perm.microphone !== 'granted') perm = await SR.requestPermissions({ permissions: ['microphone'] });
    if (perm.microphone !== 'granted') {
      o.onError(t('Нет доступа к микрофону — разрешите его в настройках'));
      return null;
    }
  } catch (e) {
    o.onError(e instanceof Error ? e.message : t('Распознавание речи недоступно'));
    return null;
  }
  return smSession(SR, o);
}

async function listenNative(o: ListenOpts): Promise<Listening | null> {
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('SmSpeech')) return listenAndroid(o);
  const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
  try {
    const { available } = await SpeechRecognition.available();
    if (!available) {
      o.onError(t('На телефоне нет распознавания речи — установите приложение Google'));
      return null;
    }
    let perm = await SpeechRecognition.checkPermissions();
    if (perm.speechRecognition !== 'granted') perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== 'granted') {
      o.onError(t('Нет доступа к микрофону — разрешите его в настройках'));
      return null;
    }
  } catch (e) {
    o.onError(e instanceof Error ? e.message : t('Распознавание речи недоступно'));
    return null;
  }
  return nativeSession(SpeechRecognition as unknown as NativeSR, o);
}
