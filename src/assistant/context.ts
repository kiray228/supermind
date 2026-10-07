/**
 * Компактный «снимок» данных пользователя для системного промпта ассистента
 * (задачи, привычки, цели, финансы месяца, настроение). Размеры ограничены.
 */
import { goalProgress, makeTaskLookup, nextStep, type GoalsData } from '../goals/model';
import { categoryMap, fmtMoney, monthEnd, monthStart, sortedAccounts, sortedCategories, summarize, type FinanceData } from '../finance/model';
import { ensureNotes } from '../notes/store';
import { isActive, WEEKDAYS, type TaskItem, type TasksData } from '../tasks/model';
import { addDaysYmd } from '../utils/mapTasks';
import { byPriorityThenTime, computeBriefing, loadBriefingInputs, type BriefingInputs } from './briefing';

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const PR = ['', '!высокий', '!средний', '!низкий'];

function taskLine(t: TaskItem, d: TasksData, withDate: boolean): string {
  const list = d.lists.find((l) => l.id === t.listId);
  const bits = [
    `[${t.id}]`,
    cut(t.title.replace(/\s+/g, ' '), 90),
    withDate && t.date ? t.date : '',
    t.time ? t.time + (t.duration ? `+${t.duration}м` : '') : '',
    PR[t.priority] ?? '',
    t.repeat ? '(повтор)' : '',
    list && list.id !== 'inbox' ? `~${list.name}` : '',
    t.tags.length ? t.tags.slice(0, 3).map((g) => '#' + g).join(' ') : '',
  ];
  return '- ' + bits.filter(Boolean).join(' ');
}

function section(title: string, lines: string[], total: number): string {
  if (!lines.length) return `${title}: нет`;
  const more = total > lines.length ? `\n- …и ещё ${total - lines.length}` : '';
  return `${title} (${total}):\n${lines.join('\n')}${more}`;
}

function tasksBlock(d: TasksData | null, today: string): string {
  if (!d) return 'Задачи: не загружены';
  const active = d.tasks.filter(isActive);
  const overdue = active.filter((t) => t.date && t.date < today).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const todays = active.filter((t) => t.date === today).sort(byPriorityThenTime);
  const weekEnd = addDaysYmd(today, 7);
  const upcoming = active.filter((t) => t.date && t.date > today && t.date <= weekEnd).sort((a, b) => (a.date! + (a.time ?? '')).localeCompare(b.date! + (b.time ?? '')));
  const nodate = active.filter((t) => !t.date).sort(byPriorityThenTime);
  const dayStart = new Date(today + 'T00:00:00').getTime();
  const doneToday = d.log.filter((l) => l.at >= dayStart).length;
  const lists = d.lists.map((l) => l.name).join(', ');
  return [
    `Списки задач: ${lists}`,
    section('Просроченные задачи', overdue.slice(0, 15).map((t) => taskLine(t, d, true)), overdue.length),
    section('Задачи на сегодня', todays.slice(0, 25).map((t) => taskLine(t, d, false)), todays.length),
    section('Ближайшие 7 дней', upcoming.slice(0, 25).map((t) => taskLine(t, d, true)), upcoming.length),
    section('Без срока', nodate.slice(0, 12).map((t) => taskLine(t, d, false)), nodate.length),
    `Выполнено сегодня: ${doneToday}. Активных задач всего: ${active.length}.`,
  ].join('\n\n');
}

function goalsBlock(g: GoalsData | null, tasks: TasksData | null): string {
  if (!g) return 'Цели: не загружены';
  const look = makeTaskLookup(tasks?.tasks);
  const active = g.goals.filter((x) => x.status === 'active').slice(0, 12);
  if (!active.length) return 'Активные цели: нет';
  const area = (id?: string) => g.areas.find((a) => a.id === id)?.name;
  const lines = active.map((x) => {
    let pct = 0;
    try {
      pct = Math.round(goalProgress(x, look));
    } catch {
      pct = 0;
    }
    let next: string | null = null;
    try {
      next = nextStep(x, look);
    } catch {
      next = null;
    }
    const stages = x.stages.length ? `, этапов ${x.stages.length}` : '';
    return `- [${x.id}] ${x.emoji} ${cut(x.title, 80)}${area(x.areaId) ? ` (${area(x.areaId)})` : ''}${x.deadline ? ` до ${x.deadline}` : ''} — ${pct}%${stages}${next ? `; следующий шаг: ${cut(next, 60)}` : ''}`;
  });
  return `Активные цели (${g.goals.filter((x) => x.status === 'active').length}):\n${lines.join('\n')}`;
}

function financeBlock(f: FinanceData | null, today: string): string {
  if (!f) return 'Финансы: не загружены';
  const cur = f.prefs.mainCurrency;
  const s = summarize(f, { from: monthStart(today), to: monthEnd(today) });
  const cats = categoryMap(f);
  const name = (id: string) => (id ? cats.get(id)?.name ?? 'Другое' : 'Без категории');
  const top = [...s.byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => `${name(id)} ${fmtMoney(v, cur)}`);
  const inc = [...s.incByCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => `${name(id)} ${fmtMoney(v, cur)}`);
  const budget = f.budgets.find((b) => !b.categoryId);
  const accs = sortedAccounts(f).map((a) => `${a.name} (${a.currency})`).slice(0, 8).join(', ');
  const exp = sortedCategories(f, 'expense').map((c) => c.name).slice(0, 25).join(', ');
  const incCats = sortedCategories(f, 'income').map((c) => c.name).slice(0, 10).join(', ');
  const recent = [...f.transactions]
    .filter((t) => t.type !== 'transfer')
    .sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')) || b.createdAt - a.createdAt)
    .slice(0, 8)
    .map((t) => `- ${t.date} ${t.type === 'income' ? '+' : '−'}${t.amount} ${t.categoryId ? name(t.categoryId) : ''}${t.note ? ' «' + cut(t.note, 40) + '»' : ''}`);
  return [
    `Финансы (основная валюта ${cur}). Этот месяц: расходы ${fmtMoney(s.expense, cur)}, доходы ${fmtMoney(s.income, cur)}${budget ? `, общий бюджет ${fmtMoney(budget.limit, cur)}` : ''}.`,
    top.length ? `Расходы по категориям: ${top.join('; ')}` : 'Расходов в этом месяце нет',
    inc.length ? `Доходы по категориям: ${inc.join('; ')}` : '',
    recent.length ? `Последние операции:\n${recent.join('\n')}` : '',
    `Счета: ${accs || 'нет'}`,
    `Категории расходов: ${exp}`,
    `Категории доходов: ${incCats}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Снимок данных пользователя (≈ до 8–10 тыс. символов) */
export async function buildContext(inputs?: BriefingInputs): Promise<string> {
  const inp = inputs ?? (await loadBriefingInputs());
  const now = new Date();
  const b = computeBriefing({ ...inp, now });
  const today = b.today;
  const parts: string[] = [];
  parts.push(`Сегодня ${today} (${WEEKDAYS[now.getDay()]}), время ${now.toTimeString().slice(0, 5)}. Завтра ${addDaysYmd(today, 1)}.${b.name ? ` Имя пользователя: ${b.name}.` : ''}`);
  parts.push(tasksBlock(inp.tasks, today));
  if (b.yesterday.count) parts.push(`Вчера выполнено: ${b.yesterday.count} (${b.yesterday.titles.map((t) => cut(t, 40)).join(', ')})`);
  parts.push(
    b.habits.length
      ? `Привычки на сегодня: ${b.habits.map((h) => `${h.name}${h.target ? ` ${h.count ?? 0}/${h.target}` : ''} ${h.done ? '✓' : '—'}`).join('; ')}`
      : 'Привычки на сегодня: нет',
  );
  parts.push(goalsBlock(inp.goals, inp.tasks));
  if (b.goals.length) parts.push(`Сроки целей и этапов на неделе: ${b.goals.map((g) => `${g.title} — ${g.date}`).join('; ')}`);
  parts.push(financeBlock(inp.finance, today));
  if (b.payments.length) parts.push(`Платежи по подпискам на неделе: ${b.payments.slice(0, 8).map((p) => `${p.title} ${fmtMoney(p.amount, p.currency)} — ${p.date}`).join('; ')}`);
  if (b.moods.length) parts.push(`Настроение (дневник, последние дни): ${b.moods.map((m) => `${m.date.slice(5)} ${m.mood}`).join(', ')}`);
  try {
    const n = await ensureNotes();
    const notes = n.notes
      .filter((x) => !x.trashed)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6)
      .map((x) => cut(x.title || 'Без названия', 50));
    if (notes.length) parts.push(`Последние заметки: ${notes.join('; ')}`);
  } catch {
    /* заметки не обязательны */
  }
  const out = parts.join('\n\n');
  return out.length > 14000 ? out.slice(0, 14000) + '\n…' : out;
}

export const ACTIONS_GUIDE = `## Действия
Ты можешь ПРЕДЛАГАТЬ изменения в данных — пользователь подтвердит их одной кнопкой. Для этого В САМОМ КОНЦЕ ответа добавь блок:
\`\`\`actions
[{"type":"add_task","title":"Позвонить маме","date":"YYYY-MM-DD","time":"HH:MM","priority":1}]
\`\`\`
Доступные типы (поля в скобках — необязательные):
- add_task: title, (date YYYY-MM-DD, time HH:MM, duration в минутах, priority: 1 высокий / 2 средний / 3 низкий / 0 нет, notes, list — название списка)
- complete_task: id (только id из данных ниже), (title)
- reschedule_task: id, date, (time HH:MM или null — убрать время), (title)
- add_note: title, text (Markdown: списки «- », чек-листы «- [ ] »)
- add_transaction: kind "expense" | "income", amount (число), (category — название из списка категорий, account — название счёта, note, date)
- add_goal: title, (deadline YYYY-MM-DD, emoji, why)
- add_goal_stage: goalId (id цели из данных ниже), title, steps (массив строк), (deadline)
Правила: блок только когда пользователь просит что-то сделать/записать/перенести/спланировать или это явно полезно; не больше 12 действий; не выдумывай id; в тексте ответа кратко опиши, что предлагаешь (сам JSON пользователь не увидит — он увидит карточки с кнопкой «Выполнить»). Не пиши, что действие уже выполнено.`;

export function systemPrompt(context: string): string {
  return `Ты — личный ИИ-ассистент в приложении SuperMind (задачи, привычки, цели, финансы, заметки, дневник). Ты видишь актуальные данные пользователя ниже и помогаешь планировать день, расставлять приоритеты, разбивать цели на шаги, разбираться с расходами, записывать задачи и заметки.
Стиль: по-русски (или на языке пользователя), дружелюбно, кратко и конкретно. Используй Markdown: **жирный**, списки «- » и «1. ». Без таблиц и без длинных вступлений. Опирайся только на данные ниже; если чего-то нет — скажи об этом. Даты в действиях — абсолютные (YYYY-MM-DD).

${ACTIONS_GUIDE}

## Данные пользователя
${context}`;
}
