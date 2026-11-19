/**
 * Язык интерфейса: русский (исходные строки в коде), английский (словарь src/i18n/en) или казахский (src/i18n/kk).
 * Строки пишутся по-русски и оборачиваются в t('…'); словарь ищет перевод по русскому тексту.
 * Язык выбирается при запуске и не меняется до перезагрузки — поэтому t() можно звать и при загрузке модуля.
 */
export type Lang = 'ru' | 'en' | 'kk';
export type LangPref = Lang | 'auto';

const KEY = 'sm-lang';
/** Языки, носители которых чаще читают по-русски, чем по-английски (у казахского — свой перевод) */
const RU_LIKE = /^(ru|uk|be|uz|ky|tg|hy|az|ka|tk|mn)\b/i;
const KK = /^kk\b/i;

export function langPref(): LangPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ru' || v === 'en' || v === 'kk') return v;
  } catch {
    /* хранилище недоступно */
  }
  return 'auto';
}

/** Язык по списку языков системы: первый казахский или русский/соседний — он, иначе английский */
export function langFromSystem(list: readonly string[]): Lang {
  if (!list.length) return 'ru';
  for (const l of list) {
    if (KK.test(l)) return 'kk';
    if (RU_LIKE.test(l)) return 'ru';
  }
  return 'en';
}

function detect(): Lang {
  // вне браузера (тесты node) — всегда русский: строки в коде русские
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'ru';
  const p = langPref();
  if (p !== 'auto') return p;
  const list = navigator.languages?.length ? navigator.languages : [navigator.language ?? ''];
  return langFromSystem(list.filter(Boolean));
}

export const lang: Lang = detect();
export const isEn = lang === 'en';
export const isKk = lang === 'kk';
/** Русский интерфейс: русские названия месяцев и дней из массивов в коде; иначе — Intl с LOCALE */
export const isRu = lang === 'ru';
/** Локаль для дат, чисел и сортировки (toLocaleDateString, Intl.*) */
export const LOCALE = isEn ? 'en-US' : isKk ? 'kk-KZ' : 'ru-RU';

/** Сменить язык: запоминается на устройстве, приложение перезапускается */
export function setLangPref(p: LangPref) {
  try {
    if (p === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* без хранилища язык останется системным */
  }
  location.reload();
}

let dict: Record<string, string> = {};
export function registerDict(d: Record<string, string>) {
  dict = { ...dict, ...d };
}

const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/**
 * Перевод строки. Подстановки — в фигурных скобках: t('Добавлено: {name}', { name }).
 * Нет перевода — показывается русский текст (тест tests/i18n.test.ts ловит такие строки).
 */
export function t(ru: string, vars?: Record<string, string | number>): string {
  return fill((!isRu && dict[ru]) || ru, vars);
}

/**
 * Форма слова для числа: ru — 1 задача / 2 задачи / 5 задач; en — по ключу «одна|две|пять» → «task|tasks»;
 * kk — после числа одна форма («5 тапсырма»): значение без «|»
 */
export function tn(n: number, one: string, few: string, many: string): string {
  if (!isRu) {
    const tr = dict[`${one}|${few}|${many}`];
    if (tr) {
      const [s, p = s] = tr.split('|');
      return Math.abs(n) === 1 ? s : p;
    }
  }
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
