/**
 * Разбор голосовой команды на русском без ИИ (бесплатно, мгновенно, без интернета).
 * «Поставь задачу на ежедневной основе выпивать 2 л воды» → задача с повтором каждый день;
 * «Отметь расходы 4500 тенге на сегодня на одежду» → расход 4500 в категории «Одежда».
 * Если фраза непонятна (confident = false) — можно уточнить у ИИ на сервере.
 */
import { addDaysYmd, toYmd } from '../utils/mapTasks';
import { parseTask } from '../tasks/parse';
import type { Priority, RepeatRule } from '../tasks/model';

export type VoiceAction =
  | { type: 'add_task'; title: string; date?: string; time?: string; repeat?: RepeatRule; remindAtTime?: boolean; priority?: Priority; list?: string }
  | { type: 'add_transaction'; kind: 'expense' | 'income'; amount: number; categoryId?: string; category?: string; account?: string; note?: string; date?: string }
  | { type: 'add_habit'; name: string; time?: string; perWeek?: number; days?: number[]; target?: number; unit?: string }
  | { type: 'add_note'; title: string; text: string };

export interface VoiceCtx {
  now?: Date;
  /** категории пользователя: id, название, тип */
  categories?: { id: string; name: string; kind: 'expense' | 'income' }[];
  accounts?: { id: string; name: string }[];
}

export interface VoiceParse {
  actions: VoiceAction[];
  /** фраза однозначна — ИИ не нужен */
  confident: boolean;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const tidy = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '')
    .trim();

// ---------- Суммы ----------

const SMALL: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
  полторы: 1.5, полтора: 1.5,
};
const CURRENCY = '(?:тенге|тг|₸|kzt|руб(?:лей|ля|ль)?|р\\.?|₽|доллар(?:ов|а)?|бакс(?:ов|а)?|\\$|usd|евро|€|сом(?:ов|а)?|сум(?:ов|а)?)';
const THOUSAND = '(?:тысяч[иа]?|тыс\\.?|к)';
const MILLION = '(?:миллион(?:ов|а)?|млн)';

/** Словесные числа («две тысячи пятьсот») → цифры, чтобы дальше работать с одним видом */
export function wordsToDigits(text: string): string {
  const words = Object.keys(SMALL).sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`(?<![\\p{L}\\d])((?:${words})(?:\\s+(?:${words}))*)(?:\\s+(${THOUSAND}|${MILLION}))?(?:\\s+((?:${words})(?:\\s+(?:${words}))*))?(?![\\p{L}])`, 'giu');
  return (
    text
      .replace(re, (m, a: string, mult: string | undefined, b: string | undefined) => {
        const sum = (s: string) => s.toLowerCase().split(/\s+/).reduce((acc, w) => acc + (SMALL[w] ?? 0), 0);
        // одиночное «один/одну/две» без множителя — часть речи («одну задачу»), не трогаем
        if (!mult && !b && /^(один|одна|одну|два|две)$/i.test(a)) return m;
        let n = sum(a);
        if (mult) n *= /^м/i.test(mult) ? 1e6 : 1e3;
        if (b) n += sum(b);
        return String(n);
      })
      // «три с половиной тысячи» → «3.5 тысячи»
      .replace(/(\d+)\s+с\s+половиной/giu, (_m, n: string) => String(+n + 0.5))
  );
}

/** Найти сумму: «4500», «4 500», «4.5 тыс», «2к», «1,5 млн» */
function findAmount(s: string): { amount: number; start: number; end: number } | null {
  const re = new RegExp(`(?<![\\p{L}\\d])(\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d+(?:[.,]\\d+)?)\\s*(${THOUSAND}|${MILLION})?(?:\\s*${CURRENCY})?(?![\\p{L}\\d])`, 'giu');
  let best: { amount: number; start: number; end: number; cur: boolean } | null = null;
  for (const m of s.matchAll(re)) {
    let n = Number(m[1].replace(/[  ]/g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) continue;
    if (m[2]) n *= /^м/i.test(m[2]) ? 1e6 : 1e3;
    const cur = new RegExp(CURRENCY + '$', 'iu').test(m[0].trim());
    const after = s.slice(m.index! + m[0].length).trimStart();
    // «в 18:00», «2 л», «5 минут» — не деньги
    if (!cur && /^(:\d|час|мин|л(?![а-яёa-z0-9])|литр|мл|кг|раз|шт|км|дн|недел|месяц|числ)/i.test(after)) continue;
    if (!cur && /(?:^|\s)(в|к|до|с)\s*$/i.test(s.slice(0, m.index))) continue;
    // предпочитаем сумму с валютой, затем самую первую
    if (!best || (cur && !best.cur)) best = { amount: Math.round(n * 100) / 100, start: m.index!, end: m.index! + m[0].length, cur };
  }
  return best;
}

// ---------- Категории ----------

/** Ключевые слова → категория по умолчанию (id как в finance/model) */
const CAT_WORDS: [RegExp, string][] = [
  [/продукт|еда(?![а-яёa-z0-9])|еду(?![а-яёa-z0-9])|магазин|супермаркет|бакале|овощ|фрукт|мясо|хлеб|молок/, 'c-food'],
  [/кафе|ресторан|кофе|обед|ужин|завтрак|фастфуд|бургер|пицц|доставк[аиу] еды|столов/, 'c-cafe'],
  [/такси|бензин|топлив|заправк|автобус|метро|транспорт|проезд|парковк|каршеринг|машин|авто(?![а-яёa-z0-9])/, 'c-transport'],
  [/квартир|коммунал|жкх|аренд|свет(?![а-яёa-z0-9])|электричеств|газ(?![а-яёa-z0-9])|вод[ау] за|ремонт/, 'c-home'],
  [/связ|интернет|телефон|мобильн|сотов/, 'c-mobile'],
  [/аптек|лекарств|врач|здоров|клиник|больниц|анализ|стоматолог|зуб/, 'c-health'],
  [/одежд|обув|кроссовк|куртк|джинс|футболк|плать|кофт|брюк|шмот/, 'c-clothes'],
  [/кино|развлеч|игр[аыу]?(?![а-яёa-z0-9])|концерт|театр|боулинг|клуб/, 'c-fun'],
  [/подписк|нетфликс|спотифай|ютуб/, 'c-subs'],
  [/курс|учеб|книг|образован|репетитор|школ|универ/, 'c-edu'],
  [/подар/, 'c-gifts'],
  [/путешеств|отпуск|билет|отел|гостиниц|перелёт|перелет|тур(?![а-яёa-z0-9])/, 'c-travel'],
  [/красот|салон|маникюр|стрижк|парикмахер|косметик|барбер/, 'c-beauty'],
  [/дет(ям|ей|и|ский)|игрушк|садик/, 'c-kids'],
  [/животн|корм|ветеринар|кошк|собак|кот(?![а-яёa-z0-9])/, 'c-pets'],
];
const INC_WORDS: [RegExp, string][] = [
  [/зарплат|зп(?![а-яёa-z0-9])|оклад|аванс/, 'i-salary'],
  [/подработк|фриланс|заказ|халтур/, 'i-side'],
  [/подар/, 'i-gifts'],
  [/кэшбэк|кешбэк|кэшбек|кешбек|cashback/, 'i-cashback'],
  [/процент|депозит|вклад/, 'i-interest'],
  [/продал|продаж/, 'i-sale'],
];

const norm = (w: string) => w.toLowerCase().replace(/ё/g, 'е').replace(/э/g, 'е');
const stem = (w: string) => norm(w).slice(0, Math.max(4, Math.min(6, w.length - 2)));

function pickCategory(text: string, kind: 'expense' | 'income', ctx: VoiceCtx): { id?: string; name?: string } {
  const t = text.toLowerCase().replace(/ё/g, 'е');
  const cats = (ctx.categories ?? []).filter((c) => c.kind === kind);
  // сначала — названия категорий пользователя («на одежду» → «Одежда»)
  const words = t.split(/[^\p{L}\d]+/u).filter((w) => w.length >= 3);
  for (const c of cats) {
    const cw = c.name.toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\d]+/u).filter((w) => w.length >= 3);
    if (cw.some((x) => words.some((w) => w.startsWith(stem(x)) || x.startsWith(stem(w))))) return { id: c.id, name: c.name };
  }
  for (const [re, id] of kind === 'income' ? INC_WORDS : CAT_WORDS) {
    if (re.test(t)) {
      const c = cats.find((x) => x.id === id);
      if (c || !ctx.categories) return { id, name: c?.name };
    }
  }
  return {};
}

// ---------- Разбор ----------

const EXPENSE_RE = /(?:^|\s)(расход\p{L}*|потрат\p{L}*|трат[аы]|траты|купил\p{L}*|заплат\p{L}*|оплатил\p{L}*|отдал\p{L}*|скинул\p{L}*|перев[её]л\p{L}*|перевела|отправил\p{L}*|минус|списал\p{L}*|ушло|ушла|ушел|ушёл|стоил\p{L}*)(?=$|[\s,.])/iu;
const INCOME_RE = /(?:^|\s)(доход\p{L}*|получил\p{L}*|заработал\p{L}*|пришл[аои]|пришел|пришёл|поступ\p{L}*|зарплат\p{L}*|зп|плюс|перевели мне|начислил\p{L}*|кэшбэк|кешбэк)(?=$|[\s,.])/iu;
const NOTE_RE = /^(?:запиши|записать|создай|создать|сделай|добавь|добавить|новая|новую)?\s*(?:заметк[аиу]|мысль|идею)(?![а-яёa-z0-9])[\s,:-]*/iu;
const HABIT_RE = /(?:^|\s)(?:нов(?:ая|ую)\s+)?привычк[аиу](?![а-яёa-z0-9])/iu;
const TASK_LEAD =
  /^(?:(?:пожалуйста|слушай|так|ну|окей|ok)[\s,]+)*(?:(?:по)?ставь(?:те)?|поставить|добавь(?:те)?|добавить|создай(?:те)?|создать|запиши|записать|запланируй|запланировать|сделай|внеси|напомни(?:ть)?(?:\s+мне)?|мне\s+(?:надо|нужно)|надо|нужно|не\s+забыть)?\s*(?:(?:нов(?:ую|ая)\s+)?(?:задач[аиу]|напоминание|дело|туду|todo)(?![а-яёa-z0-9]))?[\s,:-]*/iu;

const MONEY_LEAD = /^(?:(?:пожалуйста|слушай|так|ну)[\s,]+)*(?:отметь(?:те)?|отметить|запиши|записать|добавь(?:те)?|добавить|внеси|внести|занеси|поставь)?\s*/iu;
const STOP_MONEY =
  /(?:^|\s)(?:расход\p{L}*|доход\p{L}*|потрат\p{L}*|трат[аы]|купил\p{L}*|заплат\p{L}*|оплатил\p{L}*|скинул\p{L}*|перев[её]л\p{L}*|перевела|отправил\p{L}*|отдал\p{L}*|получил\p{L}*|заработал\p{L}*|пришл[аои]|пришел|пришёл|поступ\p{L}*|я|мне|на|за|сегодня|вчера|позавчера|наличными|наличкой|налом|картой|с карты|по карте|в|во|от|минус|плюс)(?=$|[\s,.])/giu;

function moneyDate(t: string, today: string): { date?: string; rest: string } {
  let date: string | undefined;
  const rest = t.replace(/(?:^|\s)(?:на\s+|за\s+)?(сегодня|вчера|позавчера|завтра)(?=$|[\s,.])/iu, (_m, w: string) => {
    const k = w.toLowerCase();
    date = k === 'вчера' ? addDaysYmd(today, -1) : k === 'позавчера' ? addDaysYmd(today, -2) : k === 'завтра' ? addDaysYmd(today, 1) : today;
    return ' ';
  });
  return { date, rest };
}

function pickAccount(t: string, ctx: VoiceCtx): string | undefined {
  const accs = ctx.accounts ?? [];
  const low = t.toLowerCase();
  for (const a of accs) {
    const s = stem(a.name);
    if (s.length >= 4 && low.includes(s)) return a.name;
  }
  if (/наличн|наличк|налом|кэш/i.test(low)) return accs.find((a) => /налич/i.test(a.name))?.name ?? 'Наличные';
  if (/карт(ой|ы|е)(?![а-яёa-z0-9])|по карте|с карты|kaspi|каспи/i.test(low)) return accs.find((a) => /карт|kaspi|каспи/i.test(a.name))?.name ?? 'Карта';
  return undefined;
}

function parseMoney(raw: string, ctx: VoiceCtx, today: string): VoiceAction | null {
  const t = wordsToDigits(raw);
  const exp = EXPENSE_RE.test(t);
  const inc = INCOME_RE.test(t);
  if (!exp && !inc) return null;
  const amt = findAmount(t);
  if (!amt) return null;
  // «купить молоко» — задача; «купил молоко за 500» — расход
  const kind: 'expense' | 'income' = inc && !exp ? 'income' : 'expense';
  const { date, rest } = moneyDate(t.slice(0, amt.start) + ' ' + t.slice(amt.end), today);
  const cat = pickCategory(rest, kind, ctx);
  const account = pickAccount(rest, ctx);
  // заметка: что осталось без служебных слов («такси до работы»)
  let note = tidy(
    rest
      .replace(MONEY_LEAD, ' ')
      .replace(STOP_MONEY, ' ')
      .replace(new RegExp(`(?<![\\p{L}])${CURRENCY}(?![\\p{L}])`, 'giu'), ' ')
      .replace(/(?:^|\s)(?:наличн\p{L}*|карт\p{L}*)(?=$|\s)/giu, ' '),
  );
  // если осталось только название категории — заметка не нужна
  if (cat.name && note && note.split(/\s+/).length <= 2 && note.split(/\s+/).every((w) => norm(cat.name!).includes(stem(w)))) note = '';
  if (note.length < 2) note = '';
  return {
    type: 'add_transaction',
    kind,
    amount: amt.amount,
    ...(cat.id ? { categoryId: cat.id } : {}),
    ...(cat.name ? { category: cat.name } : {}),
    ...(account ? { account } : {}),
    ...(note ? { note: cap(note) } : {}),
    ...(date ? { date } : {}),
  };
}

/** Устные формы повторов → вид, который понимает разбор задач */
function normalizeRepeat(s: string): { text: string; time?: string } {
  let time: string | undefined;
  let t = s
    .replace(/(?:^|\s)(?:на\s+)?(?:ежедневной|каждодневной)\s+основе(?=$|[\s,.])/giu, ' ежедневно ')
    .replace(/(?:^|\s)(?:на\s+)?еженедельной\s+основе(?=$|[\s,.])/giu, ' еженедельно ')
    .replace(/(?:^|\s)(?:на\s+)?ежемесячной\s+основе(?=$|[\s,.])/giu, ' ежемесячно ')
    .replace(/(?:^|\s)(?:всегда\s+)?(?:каждый\s+божий\s+день|изо\s+дня\s+в\s+день|день\s+в\s+день|каждодневно|постоянно\s+каждый\s+день)(?=$|[\s,.])/giu, ' ежедневно ')
    .replace(/(?:^|\s)по\s+утрам(?=$|[\s,.])/giu, ' каждое утро ')
    .replace(/(?:^|\s)по\s+вечерам(?=$|[\s,.])/giu, ' каждый вечер ');
  t = t.replace(/(?:^|\s)кажд(?:ое|ый)\s+(утро|вечер)(?=$|[\s,.])/giu, (_m, w: string) => {
    time = /утр/i.test(w) ? '09:00' : '20:00';
    return ' ежедневно ';
  });
  return { text: t, time };
}

/**
 * В речи час часто без минут и посреди фразы («завтра в 9 позвонить маме»): «в 9» → «в 9:00».
 * 1–5 без «утра/ночи» — это день (13–17). «В 3 раза», «в 2 подъезде» не трогаем: дальше должен быть глагол или день.
 */
function spokenHour(s: string): string {
  return s.replace(/(^|\s)(в|к)\s+(\d{1,2})(?=\s+(\p{L}+)|$)/giu, (m, pre: string, prep: string, hs: string, next: string | undefined, at: number) => {
    let h = +hs;
    if (h > 23) return m;
    const nx = (next ?? '').toLowerCase();
    if (/^(утра|ночи|дня|вечера|час)/u.test(nx)) return m;
    // «завтра в 7 пробежка», «в пятницу в 3 встреча» — перед часом стоит день
    const afterDay = /(сегодня|завтра|послезавтра|понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)\s*$/iu.test(s.slice(0, at));
    if (next && !afterDay && !/^(сегодня|завтра|послезавтра|встреч\p{L}*|созвон\p{L}*|\p{L}+(ть|ться|ти|тись))$/u.test(nx)) return m;
    if (h >= 1 && h <= 5) h += 12;
    return `${pre}${prep} ${h}:00`;
  });
}

/** «15 числа» → ближайшее 15-е (в этом месяце или следующем) в виде «15.10» */
function dayOfMonth(s: string, now: Date): string {
  return s.replace(/(^|\s)(?:до\s+|к\s+)?(\d{1,2})(?:-?го)?\s+числа(?=$|[\s,.])/iu, (m, pre: string, ds: string) => {
    const d = +ds;
    if (d < 1 || d > 31) return m;
    let y = now.getFullYear();
    let mo = now.getMonth();
    if (d < now.getDate()) mo++;
    if (mo > 11) {
      mo = 0;
      y++;
    }
    if (new Date(y, mo, d).getMonth() !== mo) return m;
    return `${pre}${d}.${String(mo + 1).padStart(2, '0')}.${y}`;
  });
}

function parseHabit(raw: string): VoiceAction | null {
  if (!HABIT_RE.test(raw)) return null;
  const { text, time: partTime } = normalizeRepeat(wordsToDigits(raw));
  let s = text
    .replace(/^(?:(?:по)?ставь|добавь|добавить|создай|создать|заведи|завести|начни|начать|хочу)\s*/iu, '')
    .replace(/(?:^|\s)(?:нов(?:ая|ую)\s+)?привычк[аиу](?![а-яёa-z0-9])/iu, ' ')
    .replace(/(?:^|\s)(?:ежедневно|каждый день)(?=$|[\s,.])/giu, ' ');
  let perWeek: number | undefined;
  s = s.replace(/(?:^|\s)(\d)\s+раз(?:а)?\s+в\s+неделю(?=$|[\s,.])/iu, (_m, n: string) => {
    perWeek = Math.min(7, Math.max(1, +n));
    return ' ';
  });
  const p = parseTask(s);
  const name = cap(tidy(p.title.replace(/^(?:что\s+бы|чтобы)\s+/iu, '')));
  if (!name) return null;
  const time = p.time ?? partTime;
  const days = p.repeat?.freq === 'weekly' && p.repeat.weekdays?.length ? p.repeat.weekdays : undefined;
  return { type: 'add_habit', name, ...(time ? { time } : {}), ...(perWeek && perWeek < 7 ? { perWeek } : {}), ...(days ? { days } : {}) };
}

function parseNote(raw: string): VoiceAction | null {
  const m = NOTE_RE.exec(raw.trim());
  if (!m) return null;
  const text = cap(tidy(raw.trim().slice(m[0].length)));
  if (!text) return null;
  return { type: 'add_note', title: text.split(/[.!?\n]/)[0].slice(0, 80), text };
}

function parseTaskCmd(raw: string, now: Date): { action: VoiceAction; explicit: boolean } | null {
  const src = wordsToDigits(raw.trim());
  const lead = TASK_LEAD.exec(src);
  const explicit = !!lead && lead[0].trim().length > 0;
  const remind = /^(?:\s*(?:пожалуйста|слушай|так|ну)[\s,]+)*\s*напомни/iu.test(src);
  const { text, time: partTime } = normalizeRepeat(spokenHour(dayOfMonth(src.slice(lead?.[0].length ?? 0), now)));
  const p = parseTask(text, now);
  let title = tidy(p.title.replace(/^(?:что\s+(?:бы|нужно|надо)|чтобы|о\s+том,?\s+что(?:\s+нужно|\s+надо)?|про)\s+/iu, ''));
  title = cap(title);
  if (!title) return null;
  const time = p.time ?? (partTime && p.repeat ? partTime : undefined);
  return {
    explicit: explicit || !!p.repeat || !!p.date,
    action: {
      type: 'add_task',
      title,
      ...(p.date ? { date: p.date } : {}),
      ...(time ? { time } : {}),
      ...(p.repeat ? { repeat: p.repeat } : {}),
      ...(p.priority ? { priority: p.priority } : {}),
      ...(p.list ? { list: p.list } : {}),
      ...(remind && time ? { remindAtTime: true } : {}),
    },
  };
}

/** Главный разбор: деньги → привычка → заметка → задача */
export function parseVoice(input: string, ctx: VoiceCtx = {}): VoiceParse {
  const raw = input.replace(/\s+/g, ' ').trim();
  if (!raw) return { actions: [], confident: true };
  const now = ctx.now ?? new Date();
  const today = toYmd(now);
  const money = parseMoney(raw, ctx, today);
  if (money) return { actions: [money], confident: true };
  const habit = parseHabit(raw);
  if (habit) return { actions: [habit], confident: true };
  const note = parseNote(raw);
  if (note) return { actions: [note], confident: true };
  const task = parseTaskCmd(raw, now);
  if (task) return { actions: [task.action], confident: task.explicit };
  return { actions: [], confident: false };
}
