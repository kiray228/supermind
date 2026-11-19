/**
 * Данные для виджетов «Финансы» и «Фокус» (iPhone и Android) — без зависимостей от хранилищ, проверяется тестами.
 * Суммы приходят уже отформатированными (валюта, разряды — как в приложении); день и месяц — чтобы виджет
 * после полуночи не показывал вчерашние траты как сегодняшние.
 */
import { budgetLevel, fmtMoney, monthEnd, monthStart, r2, summarize, totalBudget, type FinanceData } from '../finance/model';

export interface FinanceWidget {
  /** день и месяц, за которые посчитано: «2026-11-19», «2026-11» */
  d: string;
  m: string;
  /** основная валюта */
  cur: string;
  /** потрачено сегодня и за месяц (числа и строки «12 500 ₸») */
  td: number;
  mo: number;
  tds: string;
  mos: string;
  /** «0 ₸» — после полуночи (или в новом месяце), пока приложение не прислало новые данные */
  zs: string;
  /** месячный бюджет: лимит, доля 0..1+, остаток (или перерасход — over: 1), уровень */
  lim?: number;
  lims?: string;
  p?: number;
  lfs?: string;
  over?: 1;
  lv?: 'ok' | 'warn' | 'over';
}

/** Траты за сегодня и месяц и общий бюджет месяца; null — финансами ещё не пользовались */
export function financeWidget(d: FinanceData | null | undefined, today: string): FinanceWidget | null {
  if (!d) return null;
  const cur = d.prefs?.mainCurrency || 'KZT';
  const td = r2(summarize(d, { from: today, to: today }).expense);
  const mo = r2(summarize(d, { from: monthStart(today), to: monthEnd(today) }).expense);
  const out: FinanceWidget = { d: today, m: today.slice(0, 7), cur, td, mo, tds: fmtMoney(td, cur), mos: fmtMoney(mo, cur), zs: fmtMoney(0, cur) };
  const b = totalBudget(d);
  if (b && b.limit > 0) {
    const left = r2(b.limit - mo);
    out.lim = b.limit;
    out.lims = fmtMoney(b.limit, cur);
    out.p = Math.round((mo / b.limit) * 1000) / 1000;
    out.lfs = fmtMoney(Math.abs(left), cur);
    if (left < 0) out.over = 1;
    out.lv = budgetLevel(mo, b.limit);
  }
  return out;
}

/** Таймер фокуса не запущен: что показать на виджете («Фокус 25 мин» или «Секундомер») */
export interface FocusIdle {
  /** 1 — секундомер */
  sw?: 1;
  /** длительность помодоро, минуты */
  min: number;
}

export function focusIdle(mode: 'pomo' | 'stopwatch', workMin: number | undefined): FocusIdle {
  const min = Math.max(1, Math.round(workMin || 25));
  return mode === 'stopwatch' ? { sw: 1, min } : { min };
}
