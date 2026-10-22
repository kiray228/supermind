/**
 * Верх «Второго мозга» на телефоне: спросить, быстрые действия, превью графа связей, цели и привычки со связями.
 * Ниже — обычный список заметок (Notes.tsx).
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, Compass, GraduationCap, Sparkles, Waypoints } from 'lucide-react';
import { useApp } from '../../store/appStore';
import { useLinkGraph } from '../related';
import { itemId, parseItemId, type BrainKind } from '../brainDocs';
import { openAsk } from '../brainAsk';
import { openCardsReview, todaysCards } from '../cards';
import { useNotes } from '../store';
import { ensureGoals, openGoal, useGoals } from '../../goals/store';
import { goalProgress, makeTaskLookup, type Goal } from '../../goals/model';
import { useTasks } from '../../tasks/store';
import { loadPlanner } from '../../store/db';
import type { Habit, PlannerData } from '../../types';
import { activeHabits, currentStreak } from '../../habits/model';
import { todayYmd } from '../../utils/mapTasks';
import { plural } from '../../tasks/model';

const KIND_COLOR: Record<BrainKind, string> = { note: '#ff9f0a', goal: '#ff375f', map: '#5e5ce6', task: '#0a84ff' };
/** сколько узлов в превью графа */
const MINI_NODES = 14;

export function BrainHome({ onGraph, onReview, onDaily }: { onGraph: () => void; onReview: () => void; onDaily: () => void }) {
  const graph = useLinkGraph();
  const goalsData = useGoals((s) => s.data);
  const tasks = useTasks((s) => s.data?.tasks);
  const cards = useNotes((s) => s.data?.cards);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const due = useMemo(() => todaysCards().length, [cards]);
  const [planner, setPlanner] = useState<PlannerData | null>(null);
  useEffect(() => {
    void ensureGoals().catch(() => undefined);
    const load = () => void loadPlanner().then(setPlanner).catch(() => undefined);
    load();
    window.addEventListener('sm-planner-changed', load);
    return () => window.removeEventListener('sm-planner-changed', load);
  }, []);

  const titles = useMemo(() => new Map(graph.items.map((i) => [i.id, i])), [graph.items]);
  /** соседи узла по связям (сильнейшие сначала) */
  const neighbours = useMemo(() => {
    const m = new Map<string, { id: string; score: number }[]>();
    for (const e of graph.edges ?? []) {
      (m.get(e.a) ?? m.set(e.a, []).get(e.a)!).push({ id: e.b, score: e.score });
      (m.get(e.b) ?? m.set(e.b, []).get(e.b)!).push({ id: e.a, score: e.score });
    }
    for (const l of m.values()) l.sort((x, y) => y.score - x.score);
    return m;
  }, [graph.edges]);

  const goals = useMemo(() => (goalsData?.goals ?? []).filter((g) => g.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3), [goalsData]);
  const look = useMemo(() => makeTaskLookup(tasks), [tasks]);
  const habits = useMemo(() => {
    if (!planner) return [];
    const today = todayYmd();
    const days = planner.days ?? {};
    return activeHabits(planner.habits as Habit[] | undefined)
      .map((h) => ({ h, s: currentStreak(days, h, today) }))
      .sort((a, b) => b.s.n - a.s.n)
      .slice(0, 3);
  }, [planner]);

  const linkChips = (id: string) =>
    (neighbours.get(id) ?? [])
      .map((x) => titles.get(x.id))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .slice(0, 2);

  return (
    <div className="bh">
      <button className="bh-ask" onClick={() => openAsk()}>
        <Sparkles size={17} />
        <span>Спросить мозг: что я писал про…</span>
      </button>
      <div className="bh-chips">
        <button onClick={onDaily}>
          <CalendarDays size={15} /> Заметка дня
        </button>
        <button onClick={openCardsReview}>
          <GraduationCap size={15} /> Карточки{due ? ` · ${due}` : ''}
        </button>
        <button onClick={onReview}>
          <Compass size={15} /> Обзор
        </button>
        <button onClick={onGraph}>
          <Waypoints size={15} /> Граф
        </button>
      </div>

      <MiniGraph graph={graph} onOpen={onGraph} />

      {goals.length > 0 && (
        <section className="bh-card">
          <div className="bh-card-h">
            <span>Цели</span>
            <button onClick={() => useApp.getState().go('goals')}>Все</button>
          </div>
          {goals.map((g) => (
            <GoalRow key={g.id} g={g} pct={goalProgress(g, look)} links={linkChips(itemId('goal', g.id))} />
          ))}
        </section>
      )}

      {habits.length > 0 && (
        <section className="bh-card">
          <div className="bh-card-h">
            <span>Привычки</span>
            <button onClick={() => useApp.getState().go('habits')}>Все</button>
          </div>
          {habits.map(({ h, s }) => (
            <button key={h.id} className="bh-row" onClick={() => useApp.getState().go('habits')}>
              <span className="bh-emoji">{h.icon || '🔁'}</span>
              <span className="bh-row-x">
                <b>{h.name}</b>
                <small>{s.n ? `серия ${s.n} ${s.unit === 'week' ? plural(s.n, 'неделя', 'недели', 'недель') : plural(s.n, 'день', 'дня', 'дней')}` : 'серия ещё не началась'}</small>
              </span>
              <ChevronRight size={16} className="bh-chev" />
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function GoalRow({ g, pct, links }: { g: Goal; pct: number; links: { id: string; kind: BrainKind; title: string }[] }) {
  return (
    <button
      className="bh-row bh-goal"
      onClick={() => {
        openGoal(g.id);
        useApp.getState().go('goals');
      }}
    >
      <span className="bh-emoji">{g.emoji || '🎯'}</span>
      <span className="bh-row-x">
        <span className="bh-goal-top">
          <b>{g.title}</b>
          <small>{Math.round(pct)}%</small>
        </span>
        <span className="bh-bar">
          <i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
        </span>
        {links.length > 0 && (
          <span className="bh-links">
            {links.map((l) => (
              <span key={l.id} className="bh-link">
                <i style={{ background: KIND_COLOR[l.kind] }} />
                {l.title || 'Без названия'}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

/** Превью графа: самые связанные узлы по кругу; нажатие — граф целиком */
function MiniGraph({ graph, onOpen }: { graph: ReturnType<typeof useLinkGraph>; onOpen: () => void }) {
  const model = useMemo(() => {
    const edges = graph.edges ?? [];
    const deg = new Map<string, number>();
    for (const e of edges) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    }
    const top = [...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, MINI_NODES).map(([id]) => id);
    const pos = new Map<string, { x: number; y: number }>();
    const W = 320, H = 130;
    top.forEach((id, i) => {
      // два кольца: самые связанные — ближе к центру
      const inner = i < 5;
      const n = inner ? Math.min(5, top.length) : top.length - 5;
      const k = inner ? i : i - 5;
      const a = (k / Math.max(1, n)) * Math.PI * 2 + (inner ? 0.3 : 0);
      const rx = inner ? 62 : 138, ry = inner ? 30 : 52;
      pos.set(id, { x: W / 2 + Math.cos(a) * rx, y: H / 2 + Math.sin(a) * ry });
    });
    const shown = edges.filter((e) => pos.has(e.a) && pos.has(e.b));
    return { top, pos, shown, total: edges.length };
  }, [graph.edges]);

  const counting = graph.progress !== null && !graph.edges;
  return (
    <button className="bh-graph" onClick={onOpen} aria-label="Открыть граф связей">
      <svg viewBox="0 0 320 130" aria-hidden="true">
        {model.shown.map((e) => {
          const a = model.pos.get(e.a)!;
          const b = model.pos.get(e.b)!;
          return <line key={e.a + e.b} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="bh-edge" />;
        })}
        {model.top.map((id) => {
          const p = model.pos.get(id)!;
          const kind = parseItemId(id).kind;
          return <circle key={id} cx={p.x} cy={p.y} r={kind === 'goal' ? 7 : 5.5} fill={KIND_COLOR[kind]} />;
        })}
      </svg>
      <span className="bh-graph-cap">
        {counting ? 'Считаю связи…' : model.total ? `Связи · ${model.total}` : 'Связей пока нет — пишите заметки, и они появятся'}
        <ChevronRight size={14} />
      </span>
    </button>
  );
}
