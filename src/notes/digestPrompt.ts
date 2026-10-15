/**
 * Конспект темы: запрос к ИИ по записям одной темы графа и перевод ответа в заметку
 * (ссылки [1] → [[Название]], в конце — список источников). Модуль чистый — тесты гоняют его в Node.
 */
import { type AskSource, splitCitations } from './askPrompt';

export const DIGEST_SYSTEM = `Ты составляешь конспект темы из личных записей человека: заметок, карт, задач и целей.
Пиши по-русски, кратко и по делу, в markdown, без вступления и без общего заголовка. Разделы:
## Главное — 3–7 пунктов: суть темы, ключевые факты и цифры.
## Решения и выводы — что человек решил, выбрал, понял.
## Открытые вопросы — что не решено, где записи противоречат друг другу, чего не хватает.
## Что дальше — 1–4 следующих шага, которые прямо вытекают из записей.
Раздел, для которого в записях нет материала, пропусти.
Каждый факт — со ссылкой на источник в квадратных скобках: [1] или [2, 3]. Пиши ТОЛЬКО то, что есть в источниках, ничего не придумывай.`;

export function buildDigestPrompt(topic: string, sources: AskSource[]): string {
  const parts = sources.map((s) => `[${s.n}] ${s.kind} «${s.title || 'Без названия'}»${s.date ? ` (${s.date})` : ''}\n${s.text}`);
  return `Тема: ${topic}\n\nЗаписи по теме:\n\n${parts.join('\n\n')}\n\nСоставь конспект темы «${topic}».`;
}

/** Название можно сделать [[ссылкой]]: нет скобок и черты, которые сломают ссылку */
const linkable = (t: string) => !!t.trim() && !/[[\]|\n]/.test(t);
const asLink = (t: string) => (linkable(t) ? `[[${t.trim()}]]` : `«${t.trim() || 'Без названия'}»`);

/**
 * Ответ ИИ → текст заметки: [1] → [[Название источника]], повторы одной ссылки подряд не дублируются;
 * в конце — «Источники» со всеми записями темы.
 */
export function digestToMarkdown(text: string, sources: AskSource[]): string {
  const byN = new Map(sources.map((s) => [s.n, s]));
  const body = text
    .split('\n')
    .map((line) =>
      splitCitations(line, sources.length)
        .map((p) => {
          if (p.t === 'text') return p.s;
          const titles = [...new Set(p.n.map((n) => byN.get(n)?.title ?? '').filter((t) => t.trim()))];
          return titles.length ? `(${titles.map(asLink).join(', ')})` : '';
        })
        .join('')
        // «текст (ссылка).» — без пробела перед скобкой не бывает: «текст(ссылка)» → «текст (ссылка)»
        .replace(/(\S)\(\[\[/g, '$1 ([[')
        .replace(/[ \t]+$/, ''),
    )
    .join('\n')
    .trim();
  const list = sources.map((s) => `- ${asLink(s.title)} — ${s.kind.toLowerCase()}`);
  return `${body}\n\n## Источники\n\n${list.join('\n')}\n`;
}
