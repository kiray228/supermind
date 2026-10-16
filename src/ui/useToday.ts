import { useEffect, useState } from 'react';
import { todayYmd } from '../utils/mapTasks';

/** «Сегодня» (YYYY-MM-DD), которое само сменяется в полночь и при возврате в приложение */
export function useToday(): string {
  const [t, setT] = useState(todayYmd);
  useEffect(() => {
    const tick = () => setT(todayYmd());
    const id = setInterval(tick, 60_000);
    const vis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  return t;
}
