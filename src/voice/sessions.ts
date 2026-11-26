/** Сеансы распознавания одной фразы — без зависимостей от приложения (тесты гоняют их в Node на подделках) */
import { LOCALE, t } from '../i18n/index';

import { SILENCE_MS, silenceTimer } from './silence';

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
  /** громкость голоса 0…1 (если распознаватель её сообщает) — сфера «дышит» в такт речи */
  onLevel?: (level: number) => void;
}

export type SR = {
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
export type SRCtor = new () => SR;

/** Одна фраза через Web Speech API (в тестах — подделка распознавателя) */
export function webSession(C: SRCtor, o: ListenOpts): Listening | null {
  const r = new C();
  r.lang = LOCALE;
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;
  let text = '';
  let failed = false;
  const stopNow = () => {
    try {
      r.stop();
    } catch {
      /* уже остановлено */
    }
  };
  // браузер обычно сам заканчивает фразу на паузе, но Safari и часть Android — нет
  const quiet = silenceTimer(SILENCE_MS, stopNow);
  r.onresult = (e) => {
    let s = '';
    for (let i = 0; i < e.results.length; i++) s += e.results[i][0]?.transcript ?? '';
    text = s.replace(/\s+/g, ' ').trim();
    o.onText(text);
    if (text) quiet.bump();
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    failed = true;
    o.onError(
      e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? t('Нет доступа к микрофону — разрешите его в настройках')
        : e.error === 'network'
          ? t('Для распознавания речи нужен интернет')
          : t('Не удалось распознать речь'),
    );
  };
  r.onend = () => {
    quiet.clear();
    if (!failed) o.onDone(text);
  };
  try {
    r.start();
  } catch {
    return null;
  }
  return {
    stop: stopNow,
    abort: () => {
      quiet.clear();
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

/** Что нужно от нативного плагина распознавания (в тестах — подделка) */
export interface NativeSR {
  stop(): Promise<unknown>;
  start(o: { language: string; maxResults: number; partialResults: boolean; popup: boolean }): Promise<unknown>;
  addListener(ev: 'partialResults', fn: (d: { matches?: string[] }) => void): Promise<{ remove(): Promise<void> }>;
  addListener(ev: 'listeningState', fn: (d: { status: string }) => void): Promise<{ remove(): Promise<void> }>;
}

/** Сколько ждать первое слово: распознаватель на тишине молча останавливается — страховка */
export const NO_SPEECH_MS = 9000;

/**
 * Одна фраза через нативный плагин. На Android плагин с промежуточными результатами включает режим диктовки:
 * распознаватель паузу не замечает и не останавливается сам, ошибки после старта до JS не доходят.
 * Поэтому конец фразы ловим сами: пауза после последнего слова → стоп → чуть ждём окончательный текст.
 */
export async function nativeSession(SR: NativeSR, o: ListenOpts): Promise<Listening | null> {
  let text = '';
  let done = false;
  /** фраза закончена (пауза, «стоп» или распознаватель остановился) — ждём только окончательный текст */
  let ending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let noSpeech: ReturnType<typeof setTimeout> | undefined;
  const handles: { remove(): Promise<void> }[] = [];
  const halt = () => void SR.stop().catch(() => {});
  const finish = (fire: boolean) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearTimeout(noSpeech);
    quiet.clear();
    for (const h of handles) void h.remove().catch(() => {});
    if (fire) o.onDone(text);
  };
  const settle = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => finish(true), ms);
  };
  const end = (wait: number) => {
    if (done) return;
    ending = true;
    quiet.clear();
    settle(wait);
  };
  const quiet = silenceTimer(SILENCE_MS, () => {
    halt();
    end(450);
  });
  handles.push(
    await SR.addListener('partialResults', (d) => {
      if (done) return;
      const s = (d.matches?.[0] ?? '').trim();
      if (!s) return;
      text = s;
      clearTimeout(noSpeech);
      o.onText(s);
      // после конца фразы приходит окончательный вариант — берём его и сразу заканчиваем
      if (ending) settle(250);
      else quiet.bump();
    }),
  );
  handles.push(
    await SR.addListener('listeningState', (d) => {
      if (d.status === 'stopped' && !done) end(text ? 900 : 1500);
    }),
  );
  try {
    await SR.start({ language: LOCALE, maxResults: 1, partialResults: true, popup: false });
  } catch (e) {
    finish(false);
    o.onError(e instanceof Error && e.message ? t('Не удалось распознать: {error}', { error: e.message }) : t('Не удалось начать распознавание'));
    return null;
  }
  noSpeech = setTimeout(() => {
    if (text || done) return;
    halt();
    finish(true);
  }, NO_SPEECH_MS);
  return {
    stop: () => {
      halt();
      end(700);
    },
    abort: () => {
      halt();
      finish(false);
    },
  };
}

// ---------- Android: свой модуль SmSpeech (android/…/SmSpeechPlugin.java) ----------

export interface SmSpeechEvent {
  type: 'ready' | 'begin' | 'level' | 'partial' | 'end' | 'result' | 'error';
  session: number;
  text?: string;
  level?: number;
  code?: 'no-speech' | 'permission' | 'network' | 'language' | 'busy' | 'failed';
}

/** Что нужно от модуля SmSpeech (в тестах — подделка) */
export interface SmSpeechSR {
  start(o: { language: string }): Promise<{ session: number }>;
  stop(): Promise<unknown>;
  cancel(): Promise<unknown>;
  addListener(ev: 'speech', fn: (e: SmSpeechEvent) => void): Promise<{ remove(): Promise<void> }>;
}

/** Сколько ждать окончательный текст после конца фразы */
export const RESULT_WAIT_MS = 2500;

/** Текст ошибки — литералами t('…'), чтобы проверка переводов их видела */
function smError(code: string | undefined): string {
  if (code === 'permission') return t('Нет доступа к микрофону — разрешите его в настройках');
  if (code === 'network') return t('Для распознавания речи нужен интернет');
  if (code === 'language') return t('Распознавание речи на этом языке недоступно — установите голосовой ввод Google');
  if (code === 'busy') return t('Микрофон занят другим приложением — попробуйте ещё раз');
  return t('Не удалось распознать речь');
}

/**
 * Одна фраза через SmSpeech: распознаватель сам сообщает конец речи, окончательный текст и ошибки,
 * а пауза после последнего слова — запасной способ закончить фразу, если он промолчит.
 */
export async function smSession(SR: SmSpeechSR, o: ListenOpts): Promise<Listening | null> {
  let text = '';
  let done = false;
  let ending = false;
  let mine: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let noSpeech: ReturnType<typeof setTimeout> | undefined;
  let handle: { remove(): Promise<void> } | undefined;
  const finish = (fire: boolean, error?: string) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearTimeout(noSpeech);
    quiet.clear();
    void handle?.remove().catch(() => {});
    if (error) o.onError(error);
    else if (fire) o.onDone(text);
  };
  const end = (wait: number) => {
    if (done) return;
    ending = true;
    quiet.clear();
    clearTimeout(timer);
    timer = setTimeout(() => finish(true), wait);
  };
  const quiet = silenceTimer(SILENCE_MS, () => {
    void SR.stop().catch(() => {});
    end(RESULT_WAIT_MS);
  });
  handle = await SR.addListener('speech', (e) => {
    if (done || (mine !== null && e.session !== mine)) return;
    switch (e.type) {
      case 'level':
        // rmsdB у Android примерно −2…10 → 0…1
        o.onLevel?.(Math.max(0, Math.min(1, ((e.level ?? 0) + 2) / 12)));
        break;
      case 'partial': {
        const s = (e.text ?? '').trim();
        if (!s) break;
        text = s;
        clearTimeout(noSpeech);
        o.onText(s);
        if (!ending) quiet.bump();
        break;
      }
      case 'end':
        end(RESULT_WAIT_MS);
        break;
      case 'result': {
        const s = (e.text ?? '').trim();
        if (s) {
          text = s;
          o.onText(s);
        }
        finish(true);
        break;
      }
      case 'error':
        // «ничего не сказали» — не ошибка: окно само скажет «ничего не услышал»; сказанное до сбоя не теряем
        if (e.code === 'no-speech' || (text && e.code !== 'permission')) finish(true);
        else finish(false, smError(e.code));
        break;
    }
  });
  try {
    mine = (await SR.start({ language: LOCALE })).session;
  } catch (e) {
    const perm = e instanceof Error && /permission|microphone/i.test(e.message);
    finish(false, perm ? smError('permission') : t('Не удалось начать распознавание'));
    return null;
  }
  noSpeech = setTimeout(() => {
    if (text || done) return;
    void SR.cancel().catch(() => {});
    finish(true);
  }, NO_SPEECH_MS);
  return {
    stop: () => {
      void SR.stop().catch(() => {});
      end(1200);
    },
    abort: () => {
      void SR.cancel().catch(() => {});
      finish(false);
    },
  };
}
