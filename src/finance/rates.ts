/**
 * Курсы валют автоматически: раз в день с open.er-api.com (ExchangeRate-API, бесплатно, без ключа).
 * Берём курсы к доллару (у них больше значащих цифр) и пересчитываем в основную валюту.
 * Без сети или при ошибке остаются последние курсы; ручной ввод — если автокурсы выключены.
 */
import type { FinanceData, FinancePrefs } from './model';

export const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
export const RATES_SOURCE = 'https://www.exchangerate-api.com';
/** чаще не обновляем: источник обновляется раз в сутки */
const FRESH_MS = 12 * 3600_000;

/** Автокурсы включены. Не задано: включены, пока нет ни одного курса, введённого вручную */
export const autoRatesOn = (p: FinancePrefs) => p.autoRates ?? Object.keys(p.rates).length === 0;

/** Валюты, которым нужен курс: счета, долги и уже заданные курсы, кроме основной */
export function usedCurrencies(d: FinanceData): string[] {
  const s = new Set<string>();
  for (const a of d.accounts) if (!a.archived) s.add(a.currency);
  for (const x of d.debts) if (!x.closed) s.add(x.currency);
  for (const c of Object.keys(d.prefs.rates)) s.add(c);
  s.delete(d.prefs.mainCurrency);
  return [...s].sort();
}

/** 6 значащих цифр: 452.881, 0.00220812 */
const sig = (x: number) => Number(x.toPrecision(6));

/**
 * Курсы «1 единица валюты = N основной» из курсов к доллару (1 USD = usd[код]).
 * Валюта, которой нет у источника, пропускается (её курс остаётся прежним).
 */
export function crossRates(usd: Record<string, number>, main: string, codes: string[]): Record<string, number> {
  const m = usd[main];
  const out: Record<string, number> = {};
  if (!(m > 0)) return out;
  for (const c of codes) {
    const r = c === 'USD' ? 1 : usd[c];
    if (r > 0 && c !== main) out[c] = sig(m / r);
  }
  return out;
}

/** Пора обновить: автокурсы включены, есть валюты без свежего курса */
export function ratesStale(d: FinanceData, now = Date.now()): boolean {
  if (!autoRatesOn(d.prefs)) return false;
  const codes = usedCurrencies(d);
  if (!codes.length) return false;
  if (codes.some((c) => !(d.prefs.rates[c] > 0))) return true;
  return now - (d.prefs.ratesAt ?? 0) > FRESH_MS;
}

export async function fetchUsdRates(fetcher: typeof fetch = fetch): Promise<{ rates: Record<string, number>; at: number }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetcher(RATES_URL, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
    if (j.result !== 'success' || !j.rates || !(j.rates.USD > 0)) throw new Error('bad response');
    return { rates: j.rates, at: (j.time_last_update_unix ?? 0) * 1000 || Date.now() };
  } finally {
    clearTimeout(t);
  }
}
