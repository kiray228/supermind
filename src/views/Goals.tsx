import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { CaretRight, ChartPieSlice, Plus, SlidersHorizontal, X } from '@phosphor-icons/react';
import { ensureTasks } from '../tasks/store';
import { useFinance } from '../finance/store';
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
import { areaOf, ProgressRing, useTaskLookup } from '../goals/ui/parts';
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
        <button className="icon-btn" onClick={() => setAreasOpen(true)} aria-label="Сферы жизни" title="Сферы жизни">
          <SlidersHorizontal weight="bold" />
        </button>
      </div>
      <div className="page-body">
        {!data ? (
          <div className="empty">Загрузка…</div>
        ) : tab === 'goals' ? (
          <GoalsList data={data} onNew={newGoal} onWheel={() => setTab('wheel')} onTab={setTab} />
        ) : (
          <div className="gl-list-page">
            <ViewTabs view={null} saved={data.prefs.view ?? 'active'} onTab={setTab} />
            <WheelTab
              data={data}
              onNewGoal={(areaId) => {
                newGoal({ areaId });
              }}
            />
          </div>
        )}
      </div>
      {tab === 'goals' && data && (
        <button className="gl-fab" onClick={() => newGoal()} aria-label="Новая цель">
          <Plus size={26} weight="bold" />
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

function GoalsList({ data, onNew, onWheel, onTab }: { data: GoalsData; onNew: (p?: Partial<Goal>) => void; onWheel: () => void; onTab: (t: Tab) => void }) {
  const look = useTaskLookup();
  // средний прогресс учитывает копилки — пересчитываем при изменении финансов
  useFinance((s) => (data.goals.some((g) => g.mode === 'savings') ? s.data : null));
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
      <ViewTabs view={view} saved={view} onTab={onTab} />

      {view === 'active' && <Summary data={data} look={look} today={today} />}

      {/* напоминание о колесе — одна строка; крестик скрывает до следующего месяца */}
      {view === 'active' && wheelDue(data, today) && (
        <div className="gl-wheel-tip">
          <button className="gl-wheel-tip-main" onClick={onWheel}>
            <ChartPieSlice size={18} weight="duotone" className="gl-wheel-tip-ic" />
            <span className="ellipsis">{data.wheel.length ? 'Колесо баланса: прошёл месяц — оцените снова' : 'Колесо баланса: оцените сферы жизни'}</span>
            <CaretRight size={13} weight="bold" className="gl-wheel-tip-chev" />
          </button>
          <button className="gl-wheel-tip-x" onClick={() => setGoalsPrefs({ wheelSnooze: today.slice(0, 7) })} aria-label="Не напоминать в этом месяце" title="Не напоминать в этом месяце">
            <X size={15} weight="bold" />
          </button>
        </div>
      )}

      {groups.length === 0 && (
        <div className="empty">
          {view === 'done' ? <IconTile section="progress" size="lg" /> : <IconTile section="goals" size="lg" />}
          <div>{view === 'done' ? 'Здесь появятся достигнутые цели' : 'Поставьте первую цель — разбейте её на этапы и двигайтесь шаг за шагом'}</div>
          {view !== 'done' && (
            <button className="btn btn-primary" onClick={() => onNew()}>
              <Plus size={16} weight="bold" /> Новая цель
            </button>
          )}
        </div>
      )}

      {groups.map((gr) => (
        <section key={gr.key} className="gl-group" style={gr.color ? ({ '--c': gr.color } as CSSProperties) : undefined}>
          <div className="gl-group-head">
            {gr.emoji && <span className="gl-group-emoji">{gr.emoji}</span>}
            <h2 className="grow ellipsis">{gr.title}</h2>
            {gr.goals.length > 0 && view === 'areas' && (
              <span className="gl-group-avg">{Math.round(gr.goals.reduce((s, g) => s + goalProgress(g, look), 0) / gr.goals.length)}%</span>
            )}
            {view !== 'areas' && <span className="gl-group-count">{gr.goals.length}</span>}
            {view === 'areas' && gr.areaId && (
              <button className="icon-btn gl-mini-btn gl-group-add" onClick={() => onNew({ areaId: gr.areaId })} aria-label={`Новая цель: ${gr.title}`}>
                <Plus size={18} weight="bold" />
              </button>
            )}
          </div>
          <div className="gl-grid">
            {gr.goals.length === 0 ? (
              <button className="gl-group-empty" onClick={() => onNew({ areaId: gr.areaId })}>
                <Plus size={17} weight="bold" /> Добавить цель
              </button>
            ) : (
              gr.goals.map((g) => <GoalCard key={g.id} goal={g} area={areaOf(data, g.areaId)} look={look} today={today} hidePeriod={view === 'active'} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Переключатель: списки целей и колесо баланса — один ряд, как в приложениях Apple */
function ViewTabs({ view, saved, onTab }: { view: GoalsView | null; saved: GoalsView; onTab: (t: Tab) => void }) {
  const items: [GoalsView | 'wheel', string, string][] = [
    ['active', 'Активные', 'Активные'],
    ['areas', 'По сферам', 'Сферы'],
    ['done', 'Выполненные', 'Готово'],
    ['wheel', 'Колесо баланса', 'Колесо'],
  ];
  return (
    <div className="segmented gl-view-seg" role="tablist">
      {items.map(([v, long, short]) => {
        const on = v === 'wheel' ? view === null : view === v;
        return (
          <button
            key={v}
            role="tab"
            aria-selected={on}
            className={on ? 'active' : ''}
            onClick={() => {
              if (v === 'wheel') return onTab('wheel');
              onTab('goals');
              // сохраняем выбор, только если он действительно изменился
              if (saved !== v) setGoalsPrefs({ view: v });
            }}
          >
            <span className="gl-long">{long}</span>
            <span className="gl-short">{short}</span>
          </button>
        );
      })}
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
  const mood = avg >= 70 ? 'Отличный темп — финиш близко' : avg >= 35 ? 'Хороший темп — продолжайте' : 'Начало пути — маленькие шаги каждый день';
  // одна компактная строка (как сводка в «Привычках»): кольцо и числа рядом
  return (
    <div className="gl-summary" title={mood}>
      <ProgressRing pct={avg} size={52} stroke={6} className="gl-sum-ring">
        <span className="gl-sum-pct">{avg}%</span>
      </ProgressRing>
      <div className="gl-sum-text">
        <div className="gl-sum-label">Средний прогресс</div>
        <div className="gl-sum-chips">
          <span className="gl-sum-chip">
            <b>{active.length}</b> в работе
          </span>
          {overdue > 0 && (
            <span className="gl-sum-chip is-danger">
              <b>{overdue}</b> просрочено
            </span>
          )}
          <span className="gl-sum-chip">
            <b>{doneYear}</b> за {year}
          </span>
        </div>
      </div>
    </div>
  );
}
