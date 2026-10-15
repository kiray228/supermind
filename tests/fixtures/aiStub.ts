/**
 * Заглушка src/ai/claude для тестов: ответы ИИ задаёт тест (aiAnswers), запросы запоминаются (aiRequests).
 */
export class AIError extends Error {}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const aiRequests: { system: string; messages: ChatTurn[] }[] = [];
/** очередь ответов: строка — ответ, Error — ошибка */
export const aiAnswers: (string | Error)[] = [];

export const hasOwnKey = () => false;

export async function streamText(opts: { system: string; messages: ChatTurn[]; onText?: (s: string) => void; signal?: AbortSignal }): Promise<string> {
  aiRequests.push({ system: opts.system, messages: opts.messages });
  if (opts.signal?.aborted) throw new AIError('Остановлено');
  const a = aiAnswers.shift();
  if (a === undefined) throw new AIError('Нет ответа в тесте');
  if (a instanceof Error) throw a;
  opts.onText?.(a);
  return a;
}
