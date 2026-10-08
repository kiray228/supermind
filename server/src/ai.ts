/**
 * Бесплатная модель для разбора голосовых команд: Google Gemini (бесплатный тариф AI Studio)
 * или Groq (бесплатный тариф, модели Llama). Ключ — в переменных окружения сервера, у клиента его нет.
 *   GEMINI_API_KEY [+ GEMINI_MODEL]  или  GROQ_API_KEY [+ GROQ_MODEL]
 */

/** Вызов модели: системная инструкция + текст → ответ (строка JSON) */
export type Ai = (system: string, user: string) => Promise<string>;

const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];

export function envAi(env: Record<string, string | undefined> = process.env): Ai | null {
  if (env.GEMINI_API_KEY) {
    const key = env.GEMINI_API_KEY;
    const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...GEMINI_MODELS] : GEMINI_MODELS;
    return async (system, user) => {
      let last = '';
      // модель могут переименовать или убрать — тогда пробуем следующую
      for (const model of models) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 1024 },
          }),
        });
        if (r.status === 404) {
          last = `Gemini: модели ${model} нет`;
          continue;
        }
        if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const d = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        return d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      }
      throw new Error(last);
    };
  }
  if (env.GROQ_API_KEY) {
    const key = env.GROQ_API_KEY;
    const model = env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    return async (system, user) => {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 1024,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      return d.choices?.[0]?.message?.content ?? '';
    };
  }
  return null;
}

const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export interface CommandCtx {
  today: string;
  /** минуты от полуночи по времени пользователя */
  nowMin?: number;
  categories?: { name: string; kind: string }[];
  accounts?: string[];
  lists?: string[];
}

/** Инструкция: фраза пользователя → JSON с действиями в формате приложения */
export function commandPrompt(ctx: CommandCtx): string {
  const [y, m, d] = ctx.today.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const time = ctx.nowMin != null ? `${String(Math.floor(ctx.nowMin / 60)).padStart(2, '0')}:${String(ctx.nowMin % 60).padStart(2, '0')}` : '';
  const cats = (ctx.categories ?? []).slice(0, 60);
  return [
    'Ты разбираешь голосовые команды для приложения-органайзера (задачи, привычки, финансы, заметки). Команда на русском, распознана из речи — возможны ошибки распознавания.',
    `Сегодня ${ctx.today} (${wd})${time ? `, сейчас ${time}` : ''}.`,
    'Верни ТОЛЬКО JSON вида {"actions":[...]} — обычно одно действие, несколько — только если пользователь явно просит несколько вещей. Если команда непонятна — {"actions":[]}.',
    'Виды действий:',
    '- {"type":"add_task","title":"Короткое название с заглавной буквы, без слов «задача/поставь/напомни»","date":"YYYY-MM-DD","time":"HH:MM","repeat":{"freq":"daily|weekly|monthly|yearly","interval":1,"weekdays":[0-6, 0=вс]},"remind":true} — date/time/repeat/remind необязательны; remind=true, если просят напомнить; для повтора без даты date = сегодня.',
    '- {"type":"add_transaction","kind":"expense|income","amount":число,"category":"название из списка","account":"название счёта","note":"короткое пояснение, если есть","date":"YYYY-MM-DD"} — расходы/доходы; сумма числом без валюты; «вчера» → вчерашняя дата.',
    '- {"type":"add_habit","name":"Название","time":"HH:MM","perWeek":число 1-6 (если «N раз в неделю»),"days":[0-6]} — только если явно говорят «привычка».',
    '- {"type":"add_note","title":"Заголовок","text":"Текст заметки"} — если просят записать заметку/мысль/идею.',
    cats.length ? `Категории расходов: ${cats.filter((c) => c.kind === 'expense').map((c) => c.name).join(', ')}. Категории доходов: ${cats.filter((c) => c.kind === 'income').map((c) => c.name).join(', ')}.` : '',
    ctx.accounts?.length ? `Счета: ${ctx.accounts.slice(0, 20).join(', ')}.` : '',
    ctx.lists?.length ? `Списки задач: ${ctx.lists.slice(0, 30).join(', ')} (поле "list" у задачи — если пользователь назвал список).` : '',
    'Глагол в прошедшем времени с суммой («купил за 500», «потратил 2000») — это расход, а «купить молоко» — задача. «В 3» без «утра/ночи» — это 15:00.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Достать JSON из ответа модели (иногда оборачивает в ```json) */
export function parseAiJson(s: string): unknown {
  const t = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        /* ниже */
      }
    }
    return null;
  }
}
