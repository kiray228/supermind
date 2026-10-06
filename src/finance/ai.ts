/**
 * «ИИ-разбор месяца»: краткая сводка месяца → советы Claude на русском.
 */
import { streamText } from '../ai/claude';
import {
  addMonthsYmd,
  categoryMap,
  debtTotals,
  fmtMoney,
  monthEnd,
  monthStart,
  monthTitle,
  subMonthly,
  summarize,
  toMainLoose,
  accountMap,
  type FinanceData,
} from './model';

export function monthSummaryText(d: FinanceData, anyDayOfMonth: string): string {
  const cur = d.prefs.mainCurrency;
  const m = (x: number) => fmtMoney(x, cur);
  const r = { from: monthStart(anyDayOfMonth), to: monthEnd(anyDayOfMonth) };
  const s = summarize(d, r);
  const prevDay = addMonthsYmd(r.from, -1);
  const p = summarize(d, { from: monthStart(prevDay), to: monthEnd(prevDay) });
  const cats = categoryMap(d);
  const name = (id: string) => (id ? (cats.get(id)?.name ?? 'Без категории') : 'Без категории');
  const lines: string[] = [];
  lines.push(`Месяц: ${monthTitle(r.from)} ${r.from.slice(0, 4)} (данные по ${r.to}). Основная валюта: ${cur}.`);
  lines.push(`Доходы: ${m(s.income)}; расходы: ${m(s.expense)}; итог: ${m(s.income - s.expense)}.`);
  lines.push(`Прошлый месяц: доходы ${m(p.income)}, расходы ${m(p.expense)}.`);
  lines.push('Расходы по категориям (этот месяц / прошлый):');
  for (const [id, v] of [...s.byCat].sort((a, b) => b[1] - a[1]))
    lines.push(`- ${name(id)}: ${m(v)} / ${m(p.byCat.get(id) ?? 0)}`);
  if (s.incByCat.size) {
    lines.push('Доходы по категориям:');
    for (const [id, v] of [...s.incByCat].sort((a, b) => b[1] - a[1])) lines.push(`- ${name(id)}: ${m(v)}`);
  }
  if (d.budgets.length) {
    lines.push('Бюджеты (лимит → потрачено):');
    for (const b of d.budgets) {
      const spent = b.categoryId ? (s.byCat.get(b.categoryId) ?? 0) : s.expense;
      lines.push(`- ${b.categoryId ? name(b.categoryId) : 'Общий'}: ${m(b.limit)} → ${m(spent)}`);
    }
  }
  const accs = accountMap(d);
  const subs = d.subscriptions.filter((x) => x.active);
  if (subs.length) {
    const total = subs.reduce((a, x) => a + toMainLoose(subMonthly(x), accs.get(x.accountId)?.currency ?? cur, d.prefs), 0);
    lines.push(`Подписки и регулярные платежи: ${subs.length} шт., ≈ ${m(total)} в месяц (${subs.map((x) => x.name).slice(0, 15).join(', ')}).`);
  }
  const dt = debtTotals(d);
  const fmtT = (t: Record<string, number>) => Object.entries(t).map(([c, v]) => fmtMoney(v, c)).join(', ');
  if (Object.keys(dt.owe).length) lines.push(`Я должен: ${fmtT(dt.owe)}.`);
  if (Object.keys(dt.lent).length) lines.push(`Мне должны: ${fmtT(dt.lent)}.`);
  return lines.join('\n');
}

export function runFinanceAi(d: FinanceData, anyDayOfMonth: string, onText: (s: string) => void, signal?: AbortSignal): Promise<string> {
  return streamText({
    system:
      'Ты — внимательный финансовый помощник в приложении личных финансов. По сводке месяца дай понятный разбор на русском: ' +
      '1) главное за месяц в 2–3 предложениях; 2) на что ушло больше всего и что изменилось к прошлому месяцу; ' +
      '3) как дела с бюджетами; 4) 3–5 конкретных практичных советов, как сэкономить или улучшить привычки (с примерными суммами). ' +
      'Пиши кратко, дружелюбно, без воды, используй заголовки «## » и списки «- ». Не давай инвестиционных рекомендаций по конкретным ценным бумагам.',
    messages: [{ role: 'user', content: monthSummaryText(d, anyDayOfMonth) }],
    onText,
    signal,
    effort: 'low',
  });
}
