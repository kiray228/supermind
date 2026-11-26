/** Проговорить ответ вслух: Android — системный синтез речи (плагин), браузер и iPhone — speechSynthesis */
import { isNative } from '../platform';
import { shareLocal } from '../store/sharedPrefs';
import { isEn, isKk, LOCALE } from '../i18n/index';

const KEY = 'sm-voice-speak';

/** Озвучивать ответы (по умолчанию да); выключается кнопкой в окне голосовой команды */
export function speakEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}
export function setSpeakEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* без сохранения */
  }
  void shareLocal(KEY);
}

/** «12 500 ₸» → «12 500 тенге»: так синтезатор читает правильно (по-английски $ и € он читает сам) */
const forSpeech = (s: string) =>
  (isEn
    ? s.replace(/₸/g, ' tenge').replace(/₽/g, ' rubles')
    : isKk
      ? s.replace(/₸/g, ' теңге').replace(/₽/g, ' рубль').replace(/\$/g, ' доллар').replace(/€/g, ' еуро')
      : s.replace(/₸/g, ' тенге').replace(/₽/g, ' рублей').replace(/\$/g, ' долларов').replace(/€/g, ' евро')
  )
    .replace(/[«»"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export async function speak(text: string): Promise<void> {
  const t = forSpeech(text);
  if (!t) return;
  if (isNative()) {
    try {
      const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
      await TextToSpeech.stop().catch(() => {});
      await TextToSpeech.speak({ text: t, lang: LOCALE, rate: 1.0 });
    } catch {
      /* нет голосового движка — ответ всё равно виден на экране */
    }
    return;
  }
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(t);
  // голос — на языке интерфейса (ответы на нём же)
  u.lang = LOCALE;
  const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(LOCALE.slice(0, 2)));
  if (voice) u.voice = voice;
  // промис — до конца фразы: сфера «говорит», пока звучит ответ (страховка — браузер иногда не присылает конец)
  await new Promise<void>((done) => {
    const end = setTimeout(done, 1500 + t.length * 90);
    u.onend = u.onerror = () => (clearTimeout(end), done());
    synth.speak(u);
  });
}

export async function stopSpeaking() {
  if (isNative()) {
    try {
      const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
      await TextToSpeech.stop();
    } catch {
      /* ничего */
    }
    return;
  }
  window.speechSynthesis?.cancel();
}
