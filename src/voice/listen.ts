/**
 * Распознавание одной фразы: в приложении на Android — системный распознаватель Google
 * (плагин), в браузере — Web Speech API (Chrome, Safari). Бесплатно, без ключей.
 */
import { isNative } from '../platform';

export interface Listening {
  /** закончить и дождаться итогового текста */
  stop(): void;
  /** прервать без результата */
  abort(): void;
}

export interface ListenOpts {
  /** текущий текст (по мере распознавания) */
  onText: (text: string) => void;
  /** фраза закончилась: итоговый текст (может быть пустым) */
  onDone: (text: string) => void;
  onError: (msg: string) => void;
}

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SRCtor = new () => SR;

function webCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Есть ли распознавание речи (в приложении — проверяется при запуске) */
export const canListen = () => isNative() || !!webCtor();

export async function listen(o: ListenOpts): Promise<Listening | null> {
  return isNative() ? listenNative(o) : listenWeb(o);
}

function listenWeb(o: ListenOpts): Listening | null {
  const C = webCtor();
  if (!C) return null;
  const r = new C();
  r.lang = 'ru-RU';
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;
  let text = '';
  let failed = false;
  r.onresult = (e) => {
    let s = '';
    for (let i = 0; i < e.results.length; i++) s += e.results[i][0]?.transcript ?? '';
    text = s.replace(/\s+/g, ' ').trim();
    o.onText(text);
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    failed = true;
    o.onError(
      e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Нет доступа к микрофону — разрешите его в настройках'
        : e.error === 'network'
          ? 'Для распознавания речи нужен интернет'
          : 'Не удалось распознать речь',
    );
  };
  r.onend = () => {
    if (!failed) o.onDone(text);
  };
  try {
    r.start();
  } catch {
    return null;
  }
  return {
    stop: () => {
      try {
        r.stop();
      } catch {
        /* уже остановлено */
      }
    },
    abort: () => {
      r.onend = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {
        /* уже остановлено */
      }
    },
  };
}

async function listenNative(o: ListenOpts): Promise<Listening | null> {
  const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
  try {
    const { available } = await SpeechRecognition.available();
    if (!available) {
      o.onError('На телефоне нет распознавания речи — установите приложение Google');
      return null;
    }
    let perm = await SpeechRecognition.checkPermissions();
    if (perm.speechRecognition !== 'granted') perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== 'granted') {
      o.onError('Нет доступа к микрофону — разрешите его в настройках');
      return null;
    }
  } catch (e) {
    o.onError(e instanceof Error ? e.message : 'Распознавание речи недоступно');
    return null;
  }

  let text = '';
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const handles: { remove(): Promise<void> }[] = [];
  const finish = (fire: boolean) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const h of handles) void h.remove();
    if (fire) o.onDone(text);
  };
  // окончательный результат приходит чуть позже конца речи — ждём его, но недолго
  const settle = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => finish(true), ms);
  };
  let ended = false;
  handles.push(
    await SpeechRecognition.addListener('partialResults', (d) => {
      const t = (d.matches?.[0] ?? '').trim();
      if (t) {
        text = t;
        o.onText(t);
      }
      if (ended) settle(350);
    }),
  );
  handles.push(
    await SpeechRecognition.addListener('listeningState', (d) => {
      if (d.status === 'stopped') {
        ended = true;
        settle(1500);
      }
    }),
  );
  try {
    await SpeechRecognition.start({ language: 'ru-RU', maxResults: 1, partialResults: true, popup: false });
  } catch (e) {
    finish(false);
    o.onError(e instanceof Error && e.message ? 'Не удалось распознать: ' + e.message : 'Не удалось начать распознавание');
    return null;
  }
  // тишина без единого слова — распознаватель молча останавливается: страховка
  timer = setTimeout(() => {
    if (!text) {
      void SpeechRecognition.stop().catch(() => {});
      finish(true);
    }
  }, 9000);
  return {
    stop: () => {
      ended = true;
      void SpeechRecognition.stop().catch(() => {});
      settle(900);
    },
    abort: () => {
      void SpeechRecognition.stop().catch(() => {});
      finish(false);
    },
  };
}
