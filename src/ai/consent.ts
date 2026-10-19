/**
 * Согласие на отправку данных стороннему ИИ — спрашиваем один раз перед первым запросом
 * (требование App Store 5.1.2(i) и раскрытие данных для Google Play). Отказ — запрос не уходит.
 */
import { AIError } from './claude';

export type AiProvider = 'server' | 'claude';

const KEY = 'sm-ai-consent';

function given(): Partial<Record<AiProvider, number>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<AiProvider, number>>;
  } catch {
    return {};
  }
}

export const aiConsentGiven = (p: AiProvider) => !!given()[p];

export function setAiConsent(p: AiProvider, on: boolean) {
  const g = given();
  if (on) {
    g[p] = Date.now();
    declined.delete(p);
  } else delete g[p];
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* не страшно: спросим ещё раз */
  }
}

const TEXT: Record<AiProvider, string> = {
  server:
    'Ваш запрос и нужные для ответа данные (например, текст карты или заметки, задачи и привычки дня) отправятся через сервер SuperMind бесплатной модели ИИ — Google Gemini или Groq. Эти сервисы могут использовать запросы для улучшения своих моделей. Финансы и настроение можно скрыть от ИИ в Настройках → «Искусственный интеллект».',
  claude: 'Ваш запрос и нужные для ответа данные (например, текст карты или заметки) отправятся напрямую в Anthropic (Claude) по вашему ключу.',
};

const pending: Partial<Record<AiProvider, Promise<boolean>>> = {};
/** «Не сейчас» — до перезапуска больше не спрашиваем (фоновые функции ИИ не должны донимать окном) */
const declined = new Set<AiProvider>();

/** true — можно отправлять; спрашивает, если ещё не спрашивали (несколько запросов сразу — одно окно) */
export async function askAiConsent(p: AiProvider): Promise<boolean> {
  if (aiConsentGiven(p)) return true;
  if (declined.has(p)) return false;
  pending[p] ??= import('../ui/dialogs')
    .then(({ confirmDialog }) => confirmDialog('Отправлять данные ИИ?', TEXT[p], { okText: 'Разрешить', cancelText: 'Не сейчас' }))
    .then((ok) => {
      if (ok) setAiConsent(p, true);
      else declined.add(p);
      return ok;
    })
    .finally(() => delete pending[p]);
  return pending[p];
}

/** Для запросов к ИИ: без согласия — понятная ошибка вместо отправки */
export async function requireAiConsent(p: AiProvider) {
  if (!(await askAiConsent(p))) throw new AIError('ИИ выключен: отправка данных не разрешена. Включить — Настройки → «Искусственный интеллект» → «Отправлять данные ИИ».');
}
