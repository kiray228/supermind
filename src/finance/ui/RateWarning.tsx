import { useMemo } from 'react';
import { curSymbol, type FinanceData, missingRates } from '../model';
import { openMore } from './state';

/** Есть операции в валюте без курса — их суммы в итогах идут «как есть»: предупредить и дать задать курс */
export function RateWarning({ data, range }: { data: FinanceData; range: { from: string; to: string } }) {
  const miss = useMemo(() => missingRates(data, range), [data, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!miss.length) return null;
  return (
    <button className="fn-link tiny fn-rate-warn" onClick={() => openMore('settings')}>
      Нет курса для {miss.join(', ')} — эти суммы посчитаны как {curSymbol(data.prefs.mainCurrency)}. Указать курс
    </button>
  );
}
