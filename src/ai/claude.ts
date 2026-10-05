import Anthropic from '@anthropic-ai/sdk';
import type { Sheet, Topic } from '../types';
import { useApp } from '../store/appStore';
import { sheetToMarkdown } from '../io/markdown';

export const AI_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 — самый умный' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 — быстрый и дешевле' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 — самый быстрый' },
];

export class AIError extends Error {}

function client() {
  const { apiKey } = useApp.getState().settings;
  if (!apiKey.trim()) throw new AIError('Добавьте API-ключ Claude в Настройках, чтобы пользоваться ИИ.');
  return new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface StreamOpts {
  system: string;
  messages: ChatTurn[];
  onText?: (full: string) => void;
  signal?: AbortSignal;
  effort?: 'low' | 'medium' | 'high';
}

/** Потоковый запрос к Claude, возвращает итоговый текст */
export async function streamText({ system, messages, onText, signal, effort = 'medium' }: StreamOpts): Promise<string> {
  const c = client();
  const model = useApp.getState().settings.model || AI_MODELS[0].id;
  const isHaiku = model.startsWith('claude-haiku');
  const supportsFallback = model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';
  let full = '';
  const run = async (withFallback: boolean) => {
    full = '';
    const stream = c.beta.messages.stream(
      {
        model,
        max_tokens: 32000,
        system,
        messages,
        ...(isHaiku ? {} : { output_config: { effort } }),
        ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        full += ev.delta.text;
        onText?.(full);
      }
    }
    return stream.finalMessage();
  };
  try {
    let final;
    try {
      final = await run(supportsFallback);
    } catch (e) {
      // если бета-параметры отклонены — повторяем обычным запросом
      if (supportsFallback && e instanceof Anthropic.BadRequestError && !full) final = await run(false);
      else throw e;
    }
    if (final.stop_reason === 'refusal') throw new AIError('Claude отказался выполнять этот запрос. Попробуйте переформулировать.');
    return full;
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (e instanceof Anthropic.APIUserAbortError) throw new AIError('Остановлено');
    if (e instanceof Anthropic.AuthenticationError) throw new AIError('Неверный API-ключ. Проверьте его в Настройках.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new AIError('Нет доступа к выбранной модели. Выберите другую в Настройках.');
    if (e instanceof Anthropic.NotFoundError) throw new AIError('Модель не найдена. Выберите другую в Настройках.');
    if (e instanceof Anthropic.RateLimitError) throw new AIError('Слишком много запросов или закончился баланс. Подождите немного.');
    if (e instanceof Anthropic.BadRequestError) throw new AIError('Ошибка запроса: ' + e.message);
    if (e instanceof Anthropic.InternalServerError) throw new AIError('Сервер Claude временно недоступен. Повторите позже.');
    if (e instanceof Anthropic.APIConnectionError) throw new AIError('Нет соединения с сервером Claude. Проверьте интернет.');
    throw new AIError(e instanceof Error ? e.message : String(e));
  }
}

// ---------- Промпты ----------

const OUTLINE_RULES = `Формат ответа — ТОЛЬКО Markdown-структура без пояснений до или после:
- центральная тема — строка «# Название»;
- ветви — маркированный список «- », вложенность — 2 пробела на уровень;
- формулировки краткие (2–7 слов), без точки в конце;
- для задач можно использовать «- [ ] задача».
Пиши на языке запроса пользователя (по умолчанию — русский).`;

export function mapContext(sheet: Sheet): string {
  const md = sheetToMarkdown(sheet);
  return md.length > 60000 ? md.slice(0, 60000) + '\n…' : md;
}

export const PROMPTS = {
  generate: (idea: string, depth: 'brief' | 'normal' | 'deep') => ({
    system: `Ты — эксперт по интеллект-картам (mind maps), как в Xmind. Строишь логичные, хорошо структурированные карты.\n${OUTLINE_RULES}`,
    user: `Построй интеллект-карту по теме/описанию:\n"""${idea}"""\n\n${
      depth === 'brief' ? '4–5 основных ветвей, по 2–3 подтемы, 2 уровня.' : depth === 'deep' ? '6–8 основных ветвей, по 3–5 подтем, до 4 уровней вложенности, с конкретикой.' : '5–7 основных ветвей, по 3–4 подтемы, до 3 уровней.'
    }`,
  }),
  expand: (sheet: Sheet, path: string[], existing: string[], extra: string) => ({
    system: `Ты помогаешь развивать интеллект-карту. Вот вся карта для контекста:\n${mapContext(sheet)}\n\nФормат ответа — ТОЛЬКО маркированный список «- » новых подтем (можно с одним вложенным уровнем через 2 пробела). Без заголовков и пояснений. Язык — как в карте.`,
    user: `Тема: ${path.join(' → ')}\nУже есть подтемы: ${existing.length ? existing.join('; ') : 'нет'}\nПредложи 4–7 новых, не повторяющих существующие подтем.${extra ? '\nПожелание: ' + extra : ''}`,
  }),
  tasks: (sheet: Sheet, path: string[]) => ({
    system: `Ты — менеджер проектов. Контекст — интеллект-карта:\n${mapContext(sheet)}\n\nФормат ответа — ТОЛЬКО список задач «- [ ] задача», можно с подзадачами (2 пробела). Задачи конкретные, начинаются с глагола. Без пояснений.`,
    user: `Разбей на конкретные выполнимые шаги: ${path.join(' → ')}`,
  }),
  textToMap: (text: string) => ({
    system: `Ты превращаешь тексты (статьи, конспекты, заметки, транскрипты) в интеллект-карты, сохраняя ключевые идеи и факты.\n${OUTLINE_RULES}`,
    user: `Преврати этот текст в интеллект-карту:\n"""${text}"""`,
  }),
  summarize: (sheet: Sheet) => ({
    system: 'Ты кратко и ясно резюмируешь интеллект-карты. Пиши связным текстом, 1–3 абзаца, затем 3–5 ключевых выводов списком. Язык — как в карте.',
    user: `Сделай резюме этой карты:\n${mapContext(sheet)}`,
  }),
  explain: (sheet: Sheet, path: string[]) => ({
    system: `Контекст — интеллект-карта:\n${mapContext(sheet)}\n\nОтвечай кратко (до 150 слов), по делу, простым языком. Язык — как в карте.`,
    user: `Объясни подробнее тему «${path[path.length - 1]}» (путь: ${path.join(' → ')}). Это будет заметка к теме.`,
  }),
  chat: (sheet: Sheet) =>
    `Ты — ИИ-помощник в приложении интеллект-карт SuperMind. Пользователь работает с картой ниже. Помогай думать, отвечай на вопросы, предлагай идеи. Если просят идеи для карты — давай их маркированным списком «- », чтобы их можно было вставить в карту. Отвечай на языке пользователя.\n\nТекущая карта:\n${mapContext(sheet)}`,
};

/** Переписать тексты тем (улучшить, перевести, сократить…) с сохранением структуры */
export async function transformTopics(topics: Topic[], instruction: string, onText?: (s: string) => void, signal?: AbortSignal): Promise<Map<string, string>> {
  const lines = topics.map((t, i) => `${i + 1}|${t.text.replace(/\n/g, ' ')}`).join('\n');
  const out = await streamText({
    system: 'Ты редактируешь тексты тем интеллект-карты. На вход — строки «номер|текст». Верни ТОЛЬКО строки в том же формате «номер|новый текст» для каждой входной строки, в том же порядке, без пояснений. Сохраняй краткость тем.',
    messages: [{ role: 'user', content: `Задача: ${instruction}\n\n${lines}` }],
    onText,
    signal,
    effort: 'low',
  });
  const res = new Map<string, string>();
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s*\|\s*(.*)$/);
    if (!m) continue;
    const t = topics[Number(m[1]) - 1];
    if (t && m[2].trim()) res.set(t.id, m[2].trim());
  }
  return res;
}
