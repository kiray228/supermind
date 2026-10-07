import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronRight, Plus, Settings2 } from 'lucide-react';
import { ensureTasks } from '../tasks/store';
import { todayYmd } from '../utils/mapTasks';
import {
  compareGoals,
  deadlineInfo,
  goalProgress,
  PERIODS,
  sortedAreas,
  wheelDue,
  type Goal,
  type GoalsData,
  type GoalsView,
  type TaskLookup,
} from '../goals/model';
import { ensureGoals, openGoal, setGoalsPrefs, useGoals } from '../goals/store';
import { GoalCard } from '../goals/ui/GoalCard';
import { GoalDetail } from '../goals/ui/GoalDetail';
import { GoalEditor } from '../goals/ui/GoalEditor';
import { AreasModal } from '../goals/ui/AreasModal';
import { Celebration } from '../goals/ui/Celebration';
import { WheelTab } from '../goals/ui/Wheel';
import { areaOf, useTaskLookup } from '../goals/ui/parts';
import './goals.css';
import { IconTile } from '../ui/icons';

type Tab = 'goals' | 'wheel';
const TAB_KEY = 'sm-goals-tab';

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'wheel' ? 'wheel' : 'goals';
  } catch {
    return 'goals';
  }
}

type EditorState = { goal?: Goal; preset?: Partial<Goal> } | null;

export default function Goals() {
  const data = useGoals((s) => s.data);
  const openId = useGoals((s) => s.openGoalId);
  const [tab, setTabState] = useState<Tab>(readTab);
  const [editor, setEditor] = useState<EditorState>(null);
  const [areasOpen, setAreasOpen] = useState(false);

  useEffect(() => {
    void ensureGoals();
    void ensureTasks();
    return () => openGoal(null);
  }, []);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* без сохранения */
    }
  };

  const opened = data && openId ? data.goals.find((g) => g.id === openId) : undefined;
  const newGoal = (preset?: Partial<Goal>) => setEditor({ preset });

  return (
    <div className="page gl-page">
      <div className="page-header">
        <IconTile section="goals" size="sm" className="ph-tile" />
        <h1>Цели</h1>
        <div className="grow" />
        <div className="segmented gl-tabs">
          <button className={tab === 'goals' ? 'active' : ''} onClick={() => setTab('goals')}>
            Цели
          </button>
          <button className={tab === 'wheel' ? 'active' : ''} onClick={() => setTab('wheel')}>
            <span className="gl-long">Колесо баланса</span>
            <span className="gl-short">Колесо</span>
          </button>
        </div>
        <button className="icon-btn" onClick={() => setAreasOpen(true)} aria-label="Сферы жизни" title="Сферы жизни">
          <Settings2 />
        </button>
      </div>
      <div className="page-body">
        {!data ? (
          <div className="empty">Загрузка…</div>
        ) : tab === 'goals' ? (
          <GoalsList data={data} onNew={newGoal} onWheel={() => setTab('wheel')} />
        ) : (
          <WheelTab
            data={data}
            onNewGoal={(areaId) => {
              newGoal({ areaId });
            }}
          />
        )}
      </div>
      {tab === 'goals' && data && (
        <button className="gl-fab" onClick={() => newGoal()} aria-label="Новая цель">
          <Plus size={26} />
        </button>
      )}
      {data && opened && <GoalDetail data={data} goal={opened} onClose={() => openGoal(null)} onEdit={() => setEditor({ goal: opened })} />}
      {data && editor && <GoalEditor data={data} goal={editor.goal} preset={editor.preset} onClose={() => setEditor(null)} />}
      {data && areasOpen && <AreasModal data={data} onClose={() => setAreasOpen(false)} />}
      <Celebration />
    </div>
  );
}

// ================= Список целей =================

interface Group {
  key: string;
  title: string;
  emoji?: string;
  color?: string;
  goals: Goal[];
  areaId?: string;
}

function GoalsList({ data, onNew, onWheel }: { data: GoalsData; onNew: (p?: Partial<Goal>) => void; onWheel: () => void }) {
  const look = useTaskLookup();
  const today = todayYmd();
  const view: GoalsView = data.prefs.view ?? 'active';
  const areas = useMemo(() => sortedAreas(data), [data.areas]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo<Group[]>(() => {
    const sorted = [...data.goals].sort(compareGoals);
    if (view === 'done') {
      const done = data.goals.filter((g) => g.status === 'done').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
      const arch = sorted.filter((g) => g.status === 'archived');
      return [
        { key: 'done', title: 'Выполненные', goals: done },
        { key: 'arch', title: 'Архив', goals: arch },
      ].filter((g) => g.goals.length);
    }
    if (view === 'areas') {
      const live = sorted.filter((g) => g.status === 'active' || g.status === 'paused');
      const out: Group[] = areas.map((a) => ({ key: a.id, title: a.name, emoji: a.emoji, color: a.color, areaId: a.id, goals: live.filter((g) => g.areaId === a.id) }));
      const none = live.filter((g) => !g.areaId || !areas.some((a) => a.id === g.areaId));
      if (none.length) out.push({ key: 'none', title: 'Без сферы', goals: none });
      return out;
    }
    const active = sorted.filter((g) => g.status === 'active');
    const out: Group[] = PERIODS.map((p) => ({ key: p.v, title: p.group, goals: active.filter((g) => g.period === p.v) })).filter((g) => g.goals.length);
    const paused = sorted.filter((g) => g.status === 'paused');
    if (paused.length) out.push({ key: 'paused', title: 'Отложенные', goals: paused });
    return out;
  }, [data.goals, view, areas]);

  return (
    <div className="gl-list-page">
      <div className="segmented gl-view-seg">
        {(
          [
            ['active', 'Активные'],
            ['areas', 'По сферам'],
            ['done', 'Выполненные'],
          ] as [GoalsView, string][]
        ).map(([v, l]) => (
          <button key={v} className={view === v ? 'active' : ''} onClick={() => setGoalsPrefs({ view: v })}>
            {l}
          </button>
        ))}
      </div>

      {view === 'active' && <Summary data={data} look={look} today={today} />}

      {view === 'active' && wheelDue(data, today) && (
        <button className="card gl-banner gl-banner-btn" onClick={onWheel}>
          <span className="gl-banner-ic">🎡</span>
          <span className="grow">
            <span className="bold small">Колесо баланса</span>
            <span className="tiny muted gl-block">{data.wheel.length ? 'Прошёл месяц — оцените сферы жизни снова' : 'Оцените сферы жизни, чтобы понять, куда направить силы'}</span>
          </span>
          <ChevronRight size={18} className="faint" />
        </button>
      )}

      {groups.length === 0 && (
        <div className="empty">
          {view === 'done' ? <IconTile section="progress" size="lg" /> : <IconTile section="goals" size="lg" />}
          <div>{view === 'done' ? 'Здесь появятся достигнутые цели' : 'Поставьте первую цель — разбейте её на этапы и двигайтесь шаг за шагом'}</div>
          {view !== 'done' && (
            <button className="btn btn-primary" onClick={() => onNew()}>
              <Plus size={16} /> Новая цель
            </button>
          )}
        </div>
      )}

      {groups.map((gr) => (
        <section key={gr.key} className="gl-group" style={gr.color ? ({ '--c': gr.color } as CSSProperties) : undefined}>
          <div className="gl-group-head">
            {gr.emoji && <span className="gl-group-emoji">{gr.emoji}</span>}
            <h2 className="grow ellipsis">{gr.title}</h2>
            {gr.goals.length > 0 && view === 'areas' && <span className="tiny faint">средний прогресс {Math.round(gr.goals.reduce((s, g) => s + goalProgress(g, look), 0) / gr.goals.length)}%</span>}
            <span className="badge">{gr.goals.length}</span>
            {view === 'areas' && gr.areaId && (
              <button className="icon-btn gl-mini-btn" onClick={() => onNew({ areaId: gr.areaId })} aria-label={`Новая цель: ${gr.title}`}>
                <Plus size={17} />
              </button>
            )}
          </div>
          {gr.goals.length === 0 ? (
            <button className="gl-group-empty small faint" onClick={() => onNew({ areaId: gr.areaId })}>
              Нет целей — добавить
            </button>
          ) : (
            <div className="gl-grid">
              {gr.goals.map((g) => (
                <GoalCard key={g.id} goal={g} area={areaOf(data, g.areaId)} look={look} today={today} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function Summary({ data, look, today }: { data: GoalsData; look: TaskLookup; today: string }) {
  const active = data.goals.filter((g) => g.status === 'active');
  if (!active.length) return null;
  const avg = Math.round(active.reduce((s, g) => s + goalProgress(g, look), 0) / active.length);
  const overdue = active.filter((g) => deadlineInfo(g, today).state === 'overdue').length;
  const year = today.slice(0, 4);
  const doneYear = data.goals.filter((g) => g.status === 'done' && g.completedAt && new Date(g.completedAt).getFullYear() === Number(year)).length;
  return (
    <div className="gl-summary">
      <div className="gl-sum">
        <b>{active.length}</b>
        <span className="tiny muted">в работе</span>
      </div>
      <div className="gl-sum">
        <b>{avg}%</b>
        <span className="tiny muted">средний прогресс</span>
      </div>
      <div className={'gl-sum' + (overdue ? ' is-danger' : '')}>
        <b>{overdue}</b>
        <span className="tiny muted">просрочено</span>
      </div>
      <div className="gl-sum">
        <b>{doneYear}</b>
        <span className="tiny muted">достигнуто в {year}</span>
      </div>
    </div>
  );
}
