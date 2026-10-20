/**
 * Жалоба на ответ ИИ (правило Google Play о генеративном ИИ): пользователь отмечает
 * оскорбительный или вредный ответ, не выходя из приложения. Жалоба уходит обычным
 * обращением в поддержку (вид «Проблема») с текстом ответа и пометкой.
 */

export const AI_REPORT_MARK = 'Жалоба на ответ ИИ';

/** Сколько текста ответа класть в обращение: поле поддержки ограничено 5000 символами */
const MAX_ANSWER = 3000;

/** Заготовка обращения: пометка, где был ответ, сам ответ и место для пояснения */
export function aiReportText(answer: string, where: string): string {
  let a = answer.trim();
  if (a.length > MAX_ANSWER) a = a.slice(0, MAX_ANSWER).trimEnd() + '…';
  const head = `${AI_REPORT_MARK}${where ? ` · ${where}` : ''}`;
  return a ? `${head}\n\nОтвет ИИ:\n«${a}»\n\nЧто не так: ` : `${head}\n\nЧто не так: `;
}
