/**
 * CSV: разбор банковских выписок (импорт) и выгрузка операций (экспорт).
 */
import { accountMap, categoryMap, r2, sortTx, type FinanceData, type Transaction } from './model';
import type { TxDraft } from './store';

/**
 * Разделитель — по первым 20 строкам: тот, что делит больше всего строк на одинаковое число столбцов.
 * (Первая строка выписки часто — заголовок вроде «Выписка по карте Kaspi Gold» без разделителей.)
 */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  const count = (line: string, ch: string) => {
    let n = 0;
    let q = false;
    for (const c of line) {
      if (c === '"') q = !q;
      else if (!q && c === ch) n++;
    }
    return n;
  };
  let best: { ch: string; rows: number; cols: number } = { ch: ',', rows: 0, cols: 0 };
  for (const ch of [';', '\t', ',']) {
    // самое частое ненулевое число разделителей в строке и сколько строк с ним
    const freq = new Map<number, number>();
    for (const l of lines) {
      const n = count(l, ch);
      if (n > 0) freq.set(n, (freq.get(n) ?? 0) + 1);
    }
    for (const [cols, rows] of freq) if (rows > best.rows || (rows === best.rows && cols > best.cols)) best = { ch, rows, cols };
  }
  return best.rows > 0 ? best.ch : ',';
}

/** Убрать строки-шапку выписки над таблицей: в них меньше двух заполненных ячеек */
export function dropPreamble(rows: string[][]): string[][] {
  const filled = (r: string[]) => r.filter((c) => c.trim()).length;
  const width = Math.max(0, ...rows.slice(0, 30).map(filled));
  if (width < 2) return rows;
  let i = 0;
  while (i < rows.length - 1 && filled(rows[i]) < Math.min(2, width)) i++;
  return rows.slice(i);
}

/** Разбор CSV с кавычками («"a;b"», «""»). Пустые строки пропускаются */
export function parseCsv(text: string, delim = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
  return rows;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Дата из строки: DD.MM.YYYY, DD.MM.YY, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY (время после даты допускается) */
export function parseDate(s: string): { date: string; time?: string } | null {
  const t = s.trim();
  // время с часовым поясом (2024-10-31T22:00:00Z, …+03:00): переводим в местные сутки
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(t)) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  let y = 0, m = 0, d = 0;
  let mm = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (mm) [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else {
    mm = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!mm) return null;
    [d, m, y] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
    if (y < 100) y += 2000;
  }
  // 30.02 и 31.04 не бывает
  if (m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate() || y < 1970 || y > 2100) return null;
  const tm = t.slice(mm[0].length).match(/(\d{1,2}):(\d{2})/);
  const time = tm && Number(tm[1]) < 24 ? `${pad(Number(tm[1]))}:${tm[2]}` : undefined;
  return { date: `${y}-${pad(m)}-${pad(d)}`, ...(time ? { time } : {}) };
}

/** Сумма из строки: «-1 234,56 ₸», «1,234.56», «(500)», «−300» */
export function parseAmount(s: string): number | null {
  let t = s.trim().replace(/[−–]/g, '-');
  if (!t) return null;
  // дата или время — не сумма («01.10.24» иначе превращалось в 11024)
  if (/\d{1,4}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}:\d{2}/.test(t)) return null;
  // буквы, кроме валюты, — тоже не сумма
  if (/[a-zа-яё]/i.test(t.replace(/тенге|тг|kzt|руб\.?|rub|usd|eur|сом|сум/gi, ''))) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/[\s  ']/g, '').replace(/[^\d.,+-]/g, '');
  // минус в начале или в конце («500,00-» — так пишут некоторые банки)
  if (t.startsWith('-') || (t.endsWith('-') && /\d/.test(t))) neg = !neg;
  t = t.replace(/[+-]/g, '');
  const lastC = t.lastIndexOf(','), lastD = t.lastIndexOf('.');
  if (lastC >= 0 && lastD >= 0) {
    // десятичный разделитель — тот, что правее
    t = lastC > lastD ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastC >= 0) {
    t = /,\d{1,2}$/.test(t) && t.indexOf(',') === lastC ? t.replace(',', '.') : t.replace(/,/g, '');
  } else if (lastD >= 0 && t.indexOf('.') !== lastD) {
    t = t.replace(/\./g, '');
  }
  const n = Number(t);
  if (!t || !Number.isFinite(n)) return null;
  return r2(neg ? -n : n);
}

export interface ColumnMap {
  date: number;
  amount: number;
  description: number;
  /** -1 — нет */
  category: number;
}

/** Угадать столбцы по заголовкам */
export function guessColumns(header: string[]): ColumnMap {
  const find = (re: RegExp) => header.findIndex((h) => re.test(h.toLowerCase()));
  const date = find(/дата|date|время/);
  // «Сумма в валюте счёта» точнее, чем «Сумма операции» (та бывает в валюте покупки)
  let amount = find(/сумм.*(счет|счёт|карт)|amount.*account/);
  if (amount < 0) amount = find(/сумм|amount|sum|приход|расход|value/);
  // сначала точные слова (продавец, назначение), потом общие («Операция» у Kaspi — лишь «Покупки»/«Пополнения»)
  let description = find(/описан|назначен|детал|description|details|memo|payee|получател|merchant|наимен|контрагент/);
  if (description < 0 || description === amount || description === date) description = find(/коммент|операц/);
  const category = find(/категор|category/);
  if (description === amount || description === date) description = -1;
  const d = date >= 0 ? date : 0;
  // сумма по умолчанию — не столбец даты
  const a = amount >= 0 ? amount : d === 1 ? Math.min(2, header.length - 1) : Math.min(1, header.length - 1);
  return {
    date: d,
    amount: a,
    description: description >= 0 ? description : [2, 1, 0].find((i) => i < header.length && i !== d && i !== a) ?? -1,
    category,
  };
}

/** Есть ли в первой строке заголовок (а не данные) */
export function looksLikeHeader(row: string[]): boolean {
  return !row.some((c) => parseDate(c)) && !row.some((c) => /\d/.test(c) && parseAmount(c) !== null && /^[\s\d.,+\-−()₸$€₽]+$/.test(c));
}

// ---------- Автокатегории ----------

const RULES: [RegExp, string][] = [
  [/zara|h&m|lc\s*waikiki|bershka|adidas|nike|reebok|одежд|обув|wildberries|ozon|lamoda|kaspi\s*магазин/i, 'c-clothes'],
  [/magnum|small|галмарт|galmart|anvar|анвар|арзан|продукт|супермаркет|grocery|пятёрочк|пятерочк|перекр[её]сток|магнит|ашан|auchan|лента|вкусвилл|metro|market|маркет|магазин/i, 'c-food'],
  [/yandex\s*go|яндекс\s*go|такси|taxi|uber|indriver|indrive|bolt|onay|онай|автобус|метро|бензин|азс|helios|гелиос|sinooil|qazaq\s*oil|лукойл|parking|парков|авиабилет|ктж|ktz/i, 'c-transport'],
  [/кафе|cafe|coffee|кофе|starbucks|ресторан|restaurant|pub\b|burger|kfc|mcdonald|макдон|dodo|додо|пицц|pizza|суши|sushi|wolt|glovo|chocofood|delivery|доставк|столов/i, 'c-cafe'],
  [/коммунал|жкх|kegoc|алсеко|alseco|электроэнерг|водоканал|газоснаб|qazaqgaz|аренд|квартплат|ипотек|ikea|леруа|leroy/i, 'c-home'],
  [/kcell|beeline|билайн|tele2|теле2|activ|altel|kazakhtelecom|казахтелеком|мтс|mts|мегафон|megafon|интернет|internet|мобильн|связь/i, 'c-mobile'],
  [/аптек|apteka|pharm|клиник|clinic|больниц|стомат|dental|medic|медиц|анализ|invitro|инвитро|olymp|олимп/i, 'c-health'],
  [/кино|cinema|kinopark|кинопарк|театр|концерт|steam|playstation|xbox|games?\b|ticketon|боулинг/i, 'c-fun'],
  [/netflix|spotify|youtube|apple\.com|icloud|google\s*(one|storage|play)|яндекс\s*плюс|yandex\s*plus|кинопоиск|ivi|okko|подписк|subscription|chatgpt|openai|anthropic|claude/i, 'c-subs'],
  [/курсы|школ|универ|обучен|udemy|coursera|skillbox|книг|books?\b|education|учеб/i, 'c-edu'],
  [/подар|gift|цвет|flowers/i, 'c-gifts'],
  [/отел|hotel|booking|airbnb|aviasales|авиа|air\s*astana|scat|flyarystan|туризм|travel/i, 'c-travel'],
  [/салон|барбер|barber|парикмах|маникюр|косметик|beauty|красот|летуал|gold\s*apple|золотое\s*яблоко/i, 'c-beauty'],
  [/детск|игрушк|toys|садик|kids|памперс|подгуз/i, 'c-kids'],
  [/зоо|pet\s*shop|ветерин|корм для/i, 'c-pets'],
  [/зарплат|salary|заработн|аванс|payroll/i, 'i-salary'],
  [/кэшбэк|кешбэк|кэшбек|cashback|бонус/i, 'i-cashback'],
  [/процент|interest|депозит|вклад|дивиден/i, 'i-interest'],
];

export const normDesc = (s: string) => s.toLowerCase().replace(/\d+/g, '').replace(/\s+/g, ' ').trim();

/** Словарь «описание → категория» по прежним операциям */
export function historyIndex(d: FinanceData): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of [...d.transactions].sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (t.note && t.categoryId) m.set(`${t.type}|${normDesc(t.note)}`, t.categoryId);
  }
  return m;
}

export function autoCategory(d: FinanceData, desc: string, type: 'expense' | 'income', hist: Map<string, string>, catName?: string): string | undefined {
  const cats = d.categories.filter((c) => c.kind === type);
  if (catName?.trim()) {
    const n = catName.trim().toLowerCase();
    const c = cats.find((x) => x.name.toLowerCase() === n) ?? cats.find((x) => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
    if (c) return c.id;
  }
  const h = hist.get(`${type}|${normDesc(desc)}`);
  if (h && cats.some((c) => c.id === h)) return h;
  for (const [re, id] of RULES) if (re.test(desc) && cats.some((c) => c.id === id)) return id;
  return undefined;
}

// ---------- Импорт ----------

export const dupKey = (date: string, type: string, amount: number, note?: string, accountId = '') => `${accountId}|${date}|${type}|${r2(amount).toFixed(2)}|${(note ?? '').trim().toLowerCase()}`;

export interface ImportPreview {
  items: TxDraft[];
  duplicates: number;
  errors: number;
}

export function buildImport(d: FinanceData, rows: string[][], map: ColumnMap, accountId: string, opts: { invert?: boolean } = {}): ImportPreview {
  const hist = historyIndex(d);
  // сколько таких операций уже есть: две одинаковые покупки за день в выписке — не дубликаты,
  // а при повторном импорте того же файла пропускаются обе
  const seen = new Map<string, number>();
  const groups = new Map<string, Transaction[]>();
  for (const t of d.transactions) {
    // другой счёт — не дубликат (та же покупка в выписке карты и наличными — разные операции)
    if (t.type === 'transfer' || t.accountId !== accountId) continue;
    if (t.splitId) {
      groups.set(t.splitId, [...(groups.get(t.splitId) ?? []), t]);
      continue;
    }
    const k = dupKey(t.date, t.type, t.amount, t.note, accountId);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  // разделённая покупка — в выписке одной строкой на всю сумму
  for (const parts of groups.values()) {
    const t = parts[0];
    const k = dupKey(t.date, t.type, parts.reduce((a, x) => a + x.amount, 0), t.note, accountId);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const items: TxDraft[] = [];
  let duplicates = 0;
  let errors = 0;
  for (const r of rows) {
    const dt = parseDate(r[map.date] ?? '');
    let amt = parseAmount(r[map.amount] ?? '');
    if (!dt || amt === null || amt === 0) {
      errors++;
      continue;
    }
    if (opts.invert) amt = -amt;
    const type = amt < 0 ? 'expense' : 'income';
    const note = (map.description >= 0 ? r[map.description] ?? '' : '').replace(/\s+/g, ' ').trim();
    const key = dupKey(dt.date, type, Math.abs(amt), note, accountId);
    const left = seen.get(key) ?? 0;
    if (left > 0) {
      seen.set(key, left - 1);
      duplicates++;
      continue;
    }
    items.push({
      type,
      amount: Math.abs(amt),
      accountId,
      categoryId: autoCategory(d, note, type, hist, map.category >= 0 ? r[map.category] : undefined),
      date: dt.date,
      ...(dt.time ? { time: dt.time } : {}),
      ...(note ? { note } : {}),
    });
  }
  return { items, duplicates, errors };
}

// ---------- Экспорт ----------

const csvCell = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const num = (x: number) => String(r2(x)).replace('.', ',');
/** Текст, который Excel принял бы за формулу («=HYPERLINK(…)» из выписки банка), — с апострофом: покажется как текст */
export const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

/** CSV для Excel (разделитель «;», запятая в дробях, BOM) */
export function exportCsv(d: FinanceData, list: Transaction[] = d.transactions): string {
  const accs = accountMap(d);
  const cats = categoryMap(d);
  const TYPE = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };
  const head = ['Дата', 'Время', 'Тип', 'Сумма', 'Валюта', 'Счёт', 'Категория', 'Счёт зачисления', 'Сумма зачисления', 'Комментарий', 'Теги'];
  const lines = [head.join(';')];
  for (const t of [...list].sort(sortTx)) {
    const a = accs.get(t.accountId);
    const to = t.toAccountId ? accs.get(t.toAccountId) : undefined;
    const signed = t.type === 'income' ? t.amount : -t.amount;
    lines.push(
      [
        t.date,
        t.time ?? '',
        TYPE[t.type],
        num(signed),
        a?.currency ?? '',
        safeText(a?.name ?? ''),
        safeText(t.categoryId ? (cats.get(t.categoryId)?.name ?? '') : ''),
        safeText(to?.name ?? ''),
        t.type === 'transfer' ? num(t.toAmount ?? t.amount) : '',
        safeText(t.note ?? ''),
        safeText(t.tags.join(', ')),
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  return '﻿' + lines.join('\r\n');
}
