import type { CSSProperties } from 'react';
import { ArrowRight, CalendarClock, Pause } from 'lucide-react';
import { deadlineInfo, goalProgress, nextStep, periodLabel, type Goal, type LifeArea, type TaskLookup } from '../model';
import { openGoal } from '../store';
import { areaColor, ProgressBar, ProgressRing } from './parts';

export function GoalCard({ goal, area, look, today }: { goal: Goal; area?: LifeArea; look: TaskLookup; today: string }) {
  const pct = goalProgress(goal, look);
  const dl = deadlineInfo(goal, today);
  const next = nextStep(goal, look);
  const color = areaColor(area);
  return (
    <button
      className={'card gl-card' + (goal.status !== 'active' ? ' is-' + goal.status : '')}
      style={{ '--c': color } as CSSProperties}
      onClick={() => openGoal(goal.id)}
    >
      <ProgressRing pct={pct} size={52} stroke={4} color={color}>
        <span className="gl-card-emoji">{goal.emoji || '🎯'}</span>
      </ProgressRing>
      <span className="gl-card-main">
        <span className="gl-card-title">
          {goal.priority > 0 && <span className={'gl-prio p' + goal.priority} aria-hidden />}
          <span className="ellipsis">{goal.title || 'Без названия'}</span>
        </span>
        <span className="gl-card-meta tiny">
          {area && (
            <span className="gl-card-area">
              {area.emoji} {area.name}
            </span>
          )}
          <span className="faint ellipsis gl-card-period">{periodLabel(goal)}</span>
          <span className={'gl-due is-' + (goal.status === 'paused' ? 'paused' : dl.state)}>
            {goal.status === 'paused' ? <Pause size={12} /> : <CalendarClock size={12} />}
            {goal.status === 'paused' ? 'отложена' : dl.text}
          </span>
        </span>
        {next && (
          <span className="gl-card-next small muted">
            <ArrowRight size={13} />
            <span className="ellipsis">{next}</span>
          </span>
        )}
        <span className="gl-card-foot">
          <ProgressBar pct={pct} color={color} />
          <span className="gl-card-pct">{pct}%</span>
        </span>
      </span>
    </button>
  );
}
