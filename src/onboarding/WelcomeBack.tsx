/** Окно «С возвращением!» — после перерыва от 3 дней: без упрёков, с одним простым шагом */
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Flame, Sprout, X } from 'lucide-react';
import { toast, useApp } from '../store/appStore';
import { ensureTasks, updateTask, useTasks } from '../tasks/store';
import { isActive } from '../tasks/model';
import { t, tn } from '../i18n/index';
import { todayYmd } from '../utils/mapTasks';
import { useProgress } from '../progress/hooks';

export default function WelcomeBack({ onClose }: { onClose: () => void }) {
  const p = useProgress();
  const tasks = useTasks((s) => s.data);
  const go = useApp((s) => s.go);
  const [moved, setMoved] = useState<number | null>(null);
  const today = todayYmd();

  useEffect(() => {
    void ensureTasks().catch(() => undefined);
  }, []);

  const overdue = useMemo(() => (tasks?.tasks ?? []).filter((x) => isActive(x) && !!x.date && x.date < today), [tasks, today]);

  const moveOverdue = () => {
    const prev = overdue.map((x) => ({ id: x.id, date: x.date }));
    for (const x of prev) updateTask(x.id, { date: today });
    setMoved(prev.length);
    toast(t('Перенесено на сегодня: {n}', { n: prev.length }), {
      label: t('Отменить'),
      run: () => {
        for (const x of prev) updateTask(x.id, { date: x.date });
        setMoved(null);
      },
    });
  };

  const startHabit = () => {
    onClose();
    go('habits');
  };

  const lv = p?.level;
  const best = p?.counters.bestStreak ?? 0;

  return (
    <div className="modal-backdrop wn-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wn-sheet wb-sheet" role="dialog" aria-modal="true" aria-labelledby="wb-title">
        <button className="icon-btn wn-close" onClick={onClose} aria-label={t('Закрыть')}>
          <X size={18} />
        </button>
        <div className="wn-head">
          <span className="wn-badge">
            <span className="wb-wave" aria-hidden>
              👋
            </span>
          </span>
          <div>
            <h2 id="wb-title">{t('С возвращением!')}</h2>
            <p className="wn-sub">{t('Рады видеть вас снова')}</p>
          </div>
        </div>
        <ul className="wn-items wb-items">
          <li>
            <span className="wn-ico">
              <Flame size={18} />
            </span>
            <span>
              <b>{lv ? t('Уровень {level} «{title}» на месте', { level: lv.level, title: lv.title }) : t('Уровень и награды на месте')}</b>
              <small>
                {best >= 2
                  ? t('Рекорд серии — {n} {days}. Опыт и достижения никуда не делись.', { n: best, days: tn(best, 'день', 'дня', 'дней') })
                  : t('Опыт, достижения и рекорды сохранены — продолжим с того же места.')}
              </small>
            </span>
          </li>
        </ul>
        <div className="wb-actions">
          {overdue.length > 0 || moved !== null ? (
            <button className="btn btn-block wb-btn" onClick={moveOverdue} disabled={moved !== null}>
              <CalendarCheck size={18} />
              {moved !== null
                ? t('Перенесено на сегодня: {n}', { n: moved })
                : t('Перенести просроченные на сегодня ({n})', { n: overdue.length })}
            </button>
          ) : null}
          <button className="btn btn-primary btn-block wb-btn" onClick={startHabit}>
            <Sprout size={18} /> {t('Начать с одной привычки')}
          </button>
          <button className="btn btn-block btn-ghost wb-later" onClick={onClose}>
            {t('Позже')}
          </button>
        </div>
      </div>
    </div>
  );
}
