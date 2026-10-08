/** Проговорить ответ вслух: Android — системный синтез речи (плагин), браузер и iPhone — speechSynthesis */
import { isNative } from '../platform';

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
}

/** «12 500 ₸» → «12 500 тенге»: так синтезатор читает правильно */
const forSpeech = (s: string) =>
  s
    .replace(/₸/g, ' тенге')
    .replace(/₽/g, ' рублей')
    .replace(/\$/g, ' долларов')
    .replace(/€/g, ' евро')
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
      await TextToSpeech.speak({ text: t, lang: 'ru-RU', rate: 1.0 });
    } catch {
      /* нет голосового движка — ответ всё равно виден на экране */
    }
    return;
  }
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = 'ru-RU';
  const ru = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith('ru'));
  if (ru) u.voice = ru;
  synth.speak(u);
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
