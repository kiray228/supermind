/**
 * Бесплатный ИИ на сервере: Google Gemini (бесплатный тариф AI Studio) или Groq (бесплатный тариф, модели Llama).
 * Разбор голосовых команд (ответ — JSON) и все ИИ-функции приложения для тех, у кого нет своего ключа Claude (текст).
 * Ключ — в переменных окружения сервера, у клиента его нет.
 *   GEMINI_API_KEY [+ GEMINI_MODEL]  или  GROQ_API_KEY [+ GROQ_MODEL]
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Вызов модели: системная инструкция + текст (или диалог) → ответ; json — ответ строго JSON */
export type Ai = (system: string, user: string | ChatTurn[], opts?: { json?: boolean; maxTokens?: number }) => Promise<string>;

const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];

const turns = (user: string | ChatTurn[]): ChatTurn[] => (typeof user === 'string' ? [{ role: 'user', content: user }] : user);

export function envAi(env: Record<string, string | undefined> = process.env): Ai | null {
  if (env.GEMINI_API_KEY) {
    const key = env.GEMINI_API_KEY;
    const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...GEMINI_MODELS] : GEMINI_MODELS;
    return async (system, user, opts = {}) => {
      let last = '';
      // модель могут переименовать или убрать — тогда пробуем следующую
      for (const model of models) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: turns(user).map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
            generationConfig: opts.json
              ? { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: opts.maxTokens ?? 1024 }
              : { temperature: 0.7, maxOutputTokens: opts.maxTokens ?? 4096 },
          }),
        });
        // модели нет (404), перегружена (503/500) или исчерпана её квота (429) — у других моделей свои лимиты
        if (r.status === 404 || r.status === 429 || r.status >= 500) {
          last = `Gemini ${r.status} (${model}): ${(await r.text()).slice(0, 160)}`;
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
    return async (system, user, opts = {}) => {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: opts.json ? 0 : 0.7,
          max_tokens: opts.maxTokens ?? (opts.json ? 1024 : 4096),
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: system }, ...turns(user)],
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
    'Ты разбираешь голосовые команды для приложения-органайзера (задачи, привычки, финансы, заметки). Команда на русском, казахском или английском, распознана из речи — возможны ошибки распознавания. Названия задач, привычек и заметок пиши на языке команды.',
    `Сегодня ${ctx.today} (${wd})${time ? `, сейчас ${time}` : ''}.`,
    'Верни ТОЛЬКО JSON вида {"actions":[...]} — обычно одно действие, несколько — только если пользователь явно просит несколько вещей. Если команда непонятна — {"actions":[]}.',
    'Виды действий:',
    '- {"type":"add_task","title":"Короткое название с заглавной буквы, без слов «задача/поставь/напомни»","date":"YYYY-MM-DD","time":"HH:MM","repeat":{"freq":"daily|weekly|monthly|yearly","interval":1,"weekdays":[0-6, 0=вс]},"remind":true} — date/time/repeat/remind необязательны; remind=true, если просят напомнить; для повтора без даты date = сегодня.',
    '- {"type":"add_transaction","kind":"expense|income","amount":число,"category":"название из списка","account":"название счёта","note":"короткое пояснение, если есть","date":"YYYY-MM-DD"} — расходы/доходы; сумма числом без валюты; «вчера» → вчерашняя дата.',
    '- {"type":"add_habit","name":"Название","time":"HH:MM","times":["HH:MM","HH:MM"] (если несколько раз в день: «утром и вечером» → ["08:00","20:00"], «3 раза в день» → ["08:00","14:00","20:00"]),"perWeek":число 1-6 (если «N раз в неделю»),"days":[0-6]} — если явно говорят «привычка» или повторяют что-то несколько раз каждый день (таблетки утром и вечером).',
    '- {"type":"add_note","title":"Заголовок","text":"Текст заметки"} — если просят записать заметку/мысль/идею.',
    '- {"type":"mark_done","query":"ключевые слова задачи или привычки","n":число} — если говорят, что уже сделали что-то («выполнил…», «сделал…», «выпил 2 стакана воды»); n — сколько раз/штук, если названо.',
    '- {"type":"ask","what":"agenda","date":"YYYY-MM-DD"} — вопрос «что у меня на день / какие планы»;',
    '  {"type":"ask","what":"spent|income","from":"YYYY-MM-DD","to":"YYYY-MM-DD","category":"категория, если названа"} — «сколько потратил/заработал за период»; {"type":"ask","what":"balance"} — «сколько денег / какой баланс».',
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

// ---------- «Текст с фото»: распознавание текста на снимке ----------

export interface OcrImage {
  /** image/jpeg, image/png или image/webp */
  mime: string;
  /** base64 без префикса data: */
  data: string;
}

/** Модель с картинками: инструкция + снимок → текст */
export type Vision = (prompt: string, image: OcrImage) => Promise<string>;

/** Ответ модели, когда на снимке нет текста */
export const OCR_NONE = '[[NO_TEXT]]';

/** Инструкция для распознавания: текст как есть, без пересказа и перевода */
export function ocrPrompt(lang?: string): string {
  const ui = lang === 'en' ? 'английский' : lang === 'kk' ? 'казахский' : 'русский';
  return [
    'Распознай весь текст на изображении (страница, доска, чек, скриншот, вывеска, рукописная записка) и верни ТОЛЬКО этот текст — без вступления, пояснений и markdown-ограждений ```.',
    'Текст может быть на русском, казахском (буквы ә ғ қ ң ө ұ ү һ і), английском или смешанный. Сохраняй язык и написание оригинала: не переводи, не пересказывай, не исправляй слова и цифры.',
    'Строки одного абзаца, разорванные переносом, соединяй в одну строку (перенос слова с дефисом — убери дефис). Абзацы разделяй пустой строкой.',
    'Списки, пункты и строки таблиц или чека оставляй отдельными строками; пункты списка начинай с «- », нумерованные — как в оригинале. Колонки строки чека или таблицы разделяй пробелами, например «Хлеб 2 × 150 300».',
    'Неразборчивое слово замени на «…». Порядок — как читает человек: сверху вниз, слева направо, колонки по очереди.',
    `Если текста на изображении нет — ответь ровно ${OCR_NONE}. Язык интерфейса пользователя — ${ui} (это не повод переводить текст).`,
  ].join('\n');
}

/** Ответ модели → текст: убрать ограждения ``` и пустые края; «нет текста» → '' */
export function parseOcrText(s: string): string {
  let t = (s ?? '').replace(/\r\n?/g, '\n').trim();
  const fenced = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  if (fenced) t = fenced[1].trim();
  if (!t || (t.includes(OCR_NONE) && t.replace(OCR_NONE, '').trim().length < 3)) return '';
  return t.replace(/\n{3,}/g, '\n\n');
}

/** Тело запроса к Gemini: картинка частью сообщения (inline_data) */
export function geminiVisionBody(prompt: string, image: OcrImage) {
  return {
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: image.mime, data: image.data } }, { text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192 },
  };
}

/** Тело запроса к Groq (формат OpenAI): картинка — data URL */
export function groqVisionBody(model: string, prompt: string, image: OcrImage) {
  return {
    model,
    temperature: 0,
    max_tokens: 8192,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } }] }],
  };
}

export function envVision(env: Record<string, string | undefined> = process.env): Vision | null {
  if (env.GEMINI_API_KEY) {
    const key = env.GEMINI_API_KEY;
    const first = env.GEMINI_VISION_MODEL || env.GEMINI_MODEL;
    const models = first ? [first, ...GEMINI_MODELS] : GEMINI_MODELS;
    return async (prompt, image) => {
      let last = '';
      for (const model of models) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiVisionBody(prompt, image)),
        });
        // как в envAi: нет модели, перегружена или кончилась её квота — пробуем следующую
        if (r.status === 404 || r.status === 429 || r.status >= 500) {
          last = `Gemini ${r.status} (${model}): ${(await r.text()).slice(0, 160)}`;
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
    const model = env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
    return async (prompt, image) => {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(groqVisionBody(model, prompt, image)),
      });
      if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      return d.choices?.[0]?.message?.content ?? '';
    };
  }
  return null;
}

/** Самое большое фото после сжатия на устройстве (байт) */
export const OCR_MAX_BYTES = 4 * 1024 * 1024;
const OCR_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Проверить снимок из запроса: формат, base64, размер. Принимает и data URL.
 * Ошибка — строка для ответа 400/413, иначе картинка.
 */
export function readOcrImage(image: unknown, mime: unknown): OcrImage | { error: string; status: 400 | 413 } {
  let data = typeof image === 'string' ? image.trim() : '';
  let type = typeof mime === 'string' ? mime.trim().toLowerCase() : '';
  const m = data.match(/^data:([\w/+.-]+);base64,/);
  if (m) {
    type ||= m[1].toLowerCase();
    data = data.slice(m[0].length);
  }
  type ||= 'image/jpeg';
  if (type === 'image/jpg') type = 'image/jpeg';
  if (!data) return { error: 'Нет фото', status: 400 };
  if (!OCR_MIMES.has(type)) return { error: 'Формат фото не поддерживается — нужен JPEG, PNG или WebP', status: 400 };
  // размер до проверки содержимого: большая строка не гоняется через регулярку
  const bytes = Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (bytes > OCR_MAX_BYTES) return { error: 'Фото слишком большое', status: 413 };
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { error: 'Фото повреждено', status: 400 };
  return { mime: type, data };
}
