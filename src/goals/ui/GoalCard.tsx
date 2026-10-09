import { useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { ArrowRight, CaretRight } from '@phosphor-icons/react';
import { deadlineInfo, goalProgress, nextStep, periodLabel, type Goal, type LifeArea, type TaskLookup } from '../model';
import { deleteGoal, openGoal, setGoalStatus } from '../store';
import { savingsInfo } from '../savings';
import { areaColor, ProgressBar, ProgressRing } from './parts';
import { DepositPortal, SavingsCardRow } from './Savings';
import { useFinance } from '../../finance/store';
import { ActionSheet } from '../../finance/ui/common';
import { mergeHandlers, useLongPress, useSwipeActions } from '../../ui/gestures';
import { SwipeBg } from '../../ui/SwipeBg';

/** Строка цели в сгруппированном списке: кольцо прогресса с эмодзи, название, сфера и срок, полоса прогресса.
 *  Свайп влево — удалить (с «Отменить»), долгое нажатие — меню: пополнить, отложить, в архив, удалить */
export function GoalCard({ goal, area, look, today, hidePeriod }: { goal: Goal; area?: LifeArea; look: TaskLookup; today: string; hidePeriod?: boolean }) {
  const savings = goal.mode === 'savings';
  // копилка считается по остатку счёта — перерисовываемся при изменении финансов
  const fin = useFinance((s) => (savings ? s.data : null));
  const [menu, setMenu] = useState(false);
  const [deposit, setDeposit] = useState(false);
  const press = useLongPress(() => setMenu(true));
  const swipe = useSwipeActions({ onDelete: () => deleteGoal(goal.id) });
  const pct = goalProgress(goal, look);
  const dl = deadlineInfo(goal, today);
  const next = savings ? null : nextStep(goal, look);
  const color = areaColor(area);
  // у копилки внутри строки есть своя кнопка «Пополнить» — кнопку в кнопку вкладывать нельзя
  const Root = savings ? 'div' : 'button';
  const sv = savings ? savingsInfo(goal, fin) : null;
  const canDeposit = !!sv && !sv.loading && !sv.missing && !sv.reached && goal.status === 'active';
  const st = goal.status;
  const items = [
    ...(canDeposit ? [{ label: 'Пополнить', run: () => setDeposit(true) }] : []),
    ...(st === 'active' ? [{ label: 'Отложить', run: () => setGoalStatus(goal.id, 'paused') }] : []),
    ...(st === 'paused' || st === 'archived' ? [{ label: st === 'paused' ? 'Возобновить' : 'Вернуть из архива', run: () => setGoalStatus(goal.id, 'active') }] : []),
    ...(st !== 'archived' ? [{ label: 'В архив', run: () => setGoalStatus(goal.id, 'archived') }] : []),
    { label: 'Удалить', danger: true, run: () => deleteGoal(goal.id) },
  ];
  return (
    <>
      <div ref={swipe.wrap} className={'gl-card-sw ' + swipe.wrapClass}>
        <SwipeBg dx={swipe.dx} armed={swipe.armed} onDelete={swipe.confirmDelete} />
        <Root
          className={'gl-card sw-row' + (savings ? ' is-sv' : '') + (goal.status !== 'active' ? ' is-' + goal.status : '')}
          style={{ '--c': color, ...swipe.style } as CSSProperties}
          onClick={() => openGoal(goal.id)}
          {...mergeHandlers(press, swipe.bind)}
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
      </div>
      {menu && <ActionSheet title={`${goal.emoji || '🎯'} ${goal.title || 'Без названия'}`} items={items} onClose={() => setMenu(false)} />}
      {deposit && <DepositPortal goal={goal} onClose={() => setDeposit(false)} />}
    </>
  );
}
