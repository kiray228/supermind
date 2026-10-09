import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, ChevronRight, X } from 'lucide-react';
import { WeeklyReview } from './WeeklyReview';
import { defaultReviewMonday, weekLabel } from './weekly';
import { dismiss, isDismissed, reviewDueMonday, savedWeek } from './state';
import './weekly.css';

/**
 * Карточка «Итоги недели готовы» для Ассистента: в воскресенье после 17:00 и в понедельник,
 * пока итоги не сохранены и карточку не скрыли (на эту неделю).
 */
export function WeeklyReviewCard() {
  const [tick, setTick] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const [, setHidden] = useState(0);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 5 * 60000);
    return () => clearInterval(t);
  }, []);

  const monday = reviewDueMonday(new Date(tick));
  const show = !!monday && !isDismissed(monday) && !savedWeek(monday)?.text;

  return (
    <>
      {show && monday && (
        <section className="card wr-entry-card" aria-label="Итоги недели">
          <button className="wr-entry-main" onClick={() => setOpen(monday)}>
            <span className="wr-entry-ic" aria-hidden>
              🗓️
            </span>
            <span className="grow">
              <span className="wr-entry-t">Итоги недели готовы</span>
              <span className="wr-entry-s">{weekLabel(monday)} · 2 минуты, чтобы подвести итоги</span>
            </span>
            <ChevronRight size={18} className="wr-entry-chev" />
          </button>
          <button
            className="wr-entry-x"
            aria-label="Скрыть до следующей недели"
            onClick={() => {
              dismiss(monday);
              setHidden((n) => n + 1);
            }}
          >
            <X size={16} />
          </button>
        </section>
      )}
      {open && <WeeklyReview monday={open} onClose={close} />}
    </>
  );
}

/** Строка «Итоги недели» для раздела «Прогресс» */
export function WeeklyReviewEntry() {
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const monday = defaultReviewMonday();
  return (
    <>
      <button className="wr-entry-row" onClick={() => setOpen(defaultReviewMonday())}>
        <span className="wr-entry-row-ic" aria-hidden>
          <CalendarCheck size={18} />
        </span>
        <span className="grow">
          <span className="wr-entry-t">Итоги недели</span>
          <span className="wr-entry-s">{weekLabel(monday)} · цифры, настроение и планы</span>
        </span>
        <ChevronRight size={18} className="wr-entry-chev" />
      </button>
      {open && <WeeklyReview monday={open} onClose={close} />}
    </>
  );
}
