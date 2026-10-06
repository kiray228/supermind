import { streamText } from '../ai/claude';
import { type Block, markdownToBlocks, newBlock, type NoteBody, noteToMarkdown } from './model';

export type NoteAIKind = 'summary' | 'improve' | 'plan';

export const NOTE_AI_LABELS: Record<NoteAIKind, string> = {
  summary: 'ИИ: кратко',
  improve: 'ИИ: улучшить текст',
  plan: 'ИИ: план из заметки',
};

const LIMIT = 60000;

const PROMPTS: Record<NoteAIKind, string> = {
  summary:
    'Ты кратко резюмируешь заметки. Ответ — ТОЛЬКО Markdown без вступлений: 1–2 предложения сути, затем 3–6 ключевых пунктов списком «- ». Язык — как в заметке (по умолчанию русский).',
  improve:
    'Ты редактор. Улучши текст заметки: исправь ошибки, сделай формулировки ясными, убери повторы, сохрани смысл, факты, тон и структуру (заголовки «#», списки «- », «1. », чек-листы «- [ ]» / «- [x]», цитаты «>»). Не добавляй ничего от себя. Ответ — ТОЛЬКО итоговый Markdown без пояснений. Строки «*[Изображение…]*» и «*[Голосовая запись…]*» не выводи.',
  plan:
    'Ты помогаешь превращать заметки в план действий. Ответ — ТОЛЬКО список конкретных шагов в формате «- [ ] шаг», каждый начинается с глагола, 3–12 шагов, по порядку выполнения. Без заголовков и пояснений. Язык — как в заметке.',
};

/** Запрос к ИИ по заметке. Возвращает готовые блоки для вставки */
export async function runNoteAI(kind: NoteAIKind, body: NoteBody, onText?: (s: string) => void, signal?: AbortSignal): Promise<string> {
  const src = kind === 'improve' ? { ...body, blocks: body.blocks.filter((b) => b.type !== 'image' && b.type !== 'audio') } : body;
  let md = noteToMarkdown(src, { noTitle: true });
  if (md.length > LIMIT) md = md.slice(0, LIMIT) + '\n…';
  return streamText({
    system: PROMPTS[kind],
    messages: [{ role: 'user', content: `Заметка «${body.title.trim() || 'Без названия'}»:\n"""\n${md}\n"""` }],
    onText,
    signal,
    effort: kind === 'improve' ? 'medium' : 'low',
  });
}

/** Применить ответ ИИ к блокам заметки */
export function applyNoteAI(kind: NoteAIKind, blocks: Block[], answer: string): Block[] {
  const parsed = markdownToBlocks(answer);
  if (!parsed.length) return blocks;
  if (kind === 'summary') return [newBlock('h3', { text: 'Кратко' }), ...parsed, newBlock('divider'), ...blocks];
  if (kind === 'plan') return [...blocks, newBlock('h2', { text: 'План' }), ...parsed.map((b) => (b.type === 'todo' ? b : newBlock('todo', { text: b.text ?? '' })))];
  // улучшение: текст заменяется, фото и записи остаются в конце в прежнем порядке
  const media = blocks.filter((b) => b.type === 'image' || b.type === 'audio');
  return [...parsed, ...media];
}
