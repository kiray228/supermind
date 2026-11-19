/**
 * Язык интерфейса: русский (исходные строки в коде) или английский (словарь src/i18n/en).
 * Строки пишутся по-русски и оборачиваются в t('…'); английский словарь ищет перевод по русскому тексту.
 * Язык выбирается при запуске и не меняется до перезагрузки — поэтому t() можно звать и при загрузке модуля.
 */
export type Lang = 'ru' | 'en';
export type LangPref = Lang | 'auto';

const KEY = 'sm-lang';
/** Языки, носители которых чаще читают по-русски, чем по-английски */
const RU_LIKE = /^(ru|kk|uk|be|uz|ky|tg|hy|az|ka|tk|mn)\b/i;

export function langPref(): LangPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ru' || v === 'en') return v;
  } catch {
    /* хранилище недоступно */
  }
  return 'auto';
}

/** Язык по списку языков системы: русский, если среди них есть русский или соседний */
export function langFromSystem(list: readonly string[]): Lang {
  if (!list.length) return 'ru';
  return list.some((l) => RU_LIKE.test(l)) ? 'ru' : 'en';
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
/** Локаль для дат, чисел и сортировки (toLocaleDateString, Intl.*) */
export const LOCALE = isEn ? 'en-US' : 'ru-RU';

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
  return fill((isEn && dict[ru]) || ru, vars);
}

/** Форма слова для числа: ru — 1 задача / 2 задачи / 5 задач, en — по ключу «одна|две|пять» → «task|tasks» */
export function tn(n: number, one: string, few: string, many: string): string {
  if (isEn) {
    const en = dict[`${one}|${few}|${many}`];
    if (en) {
      const [s, p = s] = en.split('|');
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
