import type { CSSProperties, KeyboardEvent } from 'react';
import { ArrowRight, CaretRight } from '@phosphor-icons/react';
import { deadlineInfo, goalProgress, nextStep, periodLabel, type Goal, type LifeArea, type TaskLookup } from '../model';
import { openGoal } from '../store';
import { areaColor, ProgressBar, ProgressRing } from './parts';
import { SavingsCardRow } from './Savings';
import { useFinance } from '../../finance/store';

/** Строка цели в сгруппированном списке: кольцо прогресса с эмодзи, название, сфера и срок, полоса прогресса */
export function GoalCard({ goal, area, look, today, hidePeriod }: { goal: Goal; area?: LifeArea; look: TaskLookup; today: string; hidePeriod?: boolean }) {
  const savings = goal.mode === 'savings';
  // копилка считается по остатку счёта — перерисовываемся при изменении финансов
  useFinance((s) => (savings ? s.data : null));
  const pct = goalProgress(goal, look);
  const dl = deadlineInfo(goal, today);
  const next = savings ? null : nextStep(goal, look);
  const color = areaColor(area);
  // у копилки внутри строки есть своя кнопка «Пополнить» — кнопку в кнопку вкладывать нельзя
  const Root = savings ? 'div' : 'button';
  return (
    <Root
      className={'gl-card' + (savings ? ' is-sv' : '') + (goal.status !== 'active' ? ' is-' + goal.status : '')}
      style={{ '--c': color } as CSSProperties}
      onClick={() => openGoal(goal.id)}
      {...(savings
        ? {
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              openGoal(goal.id);
            },
          }
        : {})}
    >
      <ProgressRing pct={pct} size={46} stroke={4} color={color}>
        <span className="gl-card-emoji">{goal.emoji || '🎯'}</span>
      </ProgressRing>
      <span className="gl-card-main">
        <span className="gl-card-title">
          {goal.priority > 0 && <span className={'gl-prio p' + goal.priority} aria-hidden />}
          <span className="ellipsis">{goal.title || 'Без названия'}</span>
        </span>
        <span className="gl-card-meta">
          {area && <span className="gl-card-area ellipsis">{area.name}</span>}
          {!hidePeriod && (
            <>
              {area && <span className="gl-card-sep">·</span>}
              <span className="ellipsis gl-card-period">{periodLabel(goal)}</span>
            </>
          )}
          {(area || !hidePeriod) && <span className="gl-card-sep">·</span>}
          {/* у отложенной и архивной цели срок не «горит» */}
          <span className={'gl-due is-' + (goal.status === 'paused' ? 'paused' : goal.status === 'archived' ? 'none' : dl.state)}>
            {goal.status === 'paused' ? 'отложена' : goal.status === 'archived' ? 'в архиве' : dl.text}
          </span>
        </span>
        {savings && <SavingsCardRow goal={goal} />}
        {next && (
          <span className="gl-card-next">
            <ArrowRight size={13} weight="bold" />
            <span className="ellipsis">{next}</span>
          </span>
        )}
        <span className="gl-card-foot">
          <ProgressBar pct={pct} color={color} />
          <span className="gl-card-pct">{pct}%</span>
        </span>
      </span>
      <CaretRight className="gl-card-chev" size={15} weight="bold" />
    </Root>
  );
}
