import { useEffect } from 'react';
import { ensureGoals, useGoals } from '../goals/store';
import { GoalEditor } from '../goals/ui/GoalEditor';
import { useSearchUi } from './state';

/** Окно новой цели, открытое из поиска (команда «Новая цель») */
export default function NewGoal() {
  const data = useGoals((s) => s.data);
  useEffect(() => void ensureGoals(), []);
  if (!data) return null;
  return <GoalEditor data={data} onClose={() => useSearchUi.setState({ newGoal: false })} />;
}
