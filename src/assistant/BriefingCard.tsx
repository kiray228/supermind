import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, ChevronDown, CircleAlert, Flame, Plus, RefreshCw, Sparkles, Target, Wallet } from 'lucide-react';
import { useApp, toast } from '../store/appStore';
import { useCloud } from '../store/cloud';
import { get } from '../store/kv';
import { ensureTasks, openQuickAdd, openTask, toggleDone, updateTask, useTasks } from '../tasks/store';
import { ensureGoals, openGoal, useGoals } from '../goals/store';
import { ensureFinance, useFinance } from '../finance/store';
import { fmtMoney } from '../finance/model';
import { PRIORITY_META, fromYmd, todayYmd } from '../utils/mapTasks';
import type { PlannerData } from '../types';
import { AIError } from '../ai/claude';
import { aiBrief, cachedAiBrief, computeBriefing, plural } from './briefing';
import { Markdown } from './Markdown';

const COLLAPSE_KEY = 'sm-assistant-brief-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === todayYmd();
  } catch {
    return false;
  }
}

function relDay(ymd: string, today: string): string {
  const diff = Math.round((fromYmd(ymd).getTime() - fromYmd(today).getTime()) / 86400000);
  if (diff <= 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  return `через ${diff} ${plural(diff, 'день', 'дня', 'дней')}`;
}

/** Ежедневник (привычки, настроение) читается напрямую из базы и перечитывается при изменениях */
function usePlanner(): PlannerData | null {
  const [p, setP] = useState<PlannerData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void get<PlannerData>('planner')
        .then((v) => alive && setP(v ?? { days: {}, habits: [] }))
        .catch(() => undefined);
    load();
    window.addEventListener('sm-planner-changed', load);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      window.removeEventListener('sm-planner-changed', load);
      window.removeEventListener('focus', load);
    };
  }, []);
  return p;
}

export function BriefingCard({ hasKey, onCollapse }: { hasKey: boolean; onCollapse?: (v: boolean) => void }) {
  const tasks = useTasks((s) => s.data);
  const goals = useGoals((s) => s.data);
  const finance = useFinance((s) => s.data);
  const name = useCloud((s) => s.account?.user.name);
  const planner = usePlanner();
  const go = useApp((s) => s.go);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [ai, setAi] = useState<string | null>(() => cachedAiBrief());
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // текущий час — для приветствия; обновляется раз в 5 минут
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    void ensureTasks().catch(() => undefined);
    void ensureGoals().catch(() => undefined);
    void ensureFinance().catch(() => undefined);
    const t = setInterval(() => setTick(Date.now()), 5 * 60000);
    return () => {
      clearInterval(t);
      abort.current?.abort();
    };
  }, []);

  const b = useMemo(() => computeBriefing({ tasks, goals, finance, planner, name, now: new Date(tick) }), [tasks, goals, finance, planner, name, tick]);
  const habitsDone = b.habits.filter((h) => h.done).length;

  const toggleCollapsed = () => {
    const v = !collapsed;
    setCollapsed(v);
    onCollapse?.(v);
    try {
      if (v) localStorage.setItem(COLLAPSE_KEY, b.today);
      else localStorage.removeItem(COLLAPSE_KEY);
    } catch {
      /* не страшно */
    }
  };

  const moveOverdue = () => {
    const prev = b.overdue.map((t) => ({ id: t.id, date: t.date }));
    for (const t of prev) updateTask(t.id, { date: b.today });
    toast(`Перенесено на сегодня: ${prev.length}`, {
      label: 'Отменить',
      run: () => {
        for (const t of prev) updateTask(t.id, { date: t.date });
      },
    });
  };

  const runAi = async () => {
    if (aiBusy) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setAiBusy(true);
    setAiError(null);
    setAi('');
    try {
      const text = await aiBrief(b, { signal: ctrl.signal, onText: (s) => setAi(s) });
      setAi(text);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setAi(cachedAiBrief());
      setAiError(e instanceof AIError ? e.message : 'Не удалось получить сводку');
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setAiBusy(false);
      }
    }
  };

  const icon = b.greeting === 'Доброе утро' ? '☀️' : b.greeting === 'Добрый день' ? '🌤️' : b.greeting === 'Добрый вечер' ? '🌇' : '🌙';

  return (
    <section className={`card as-brief${collapsed ? ' collapsed' : ''}`} aria-label="Брифинг на сегодня">
      <button className="as-brief-head" onClick={toggleCollapsed} aria-expanded={!collapsed}>
        <span className="as-brief-sun" aria-hidden>
          {icon}
        </span>
        <span className="grow">
          <span className="as-brief-hello">
            {b.greeting}
            {b.name ? `, ${b.name}` : ''}!
          </span>
          <span className="as-brief-date">
            {b.dateLabel} · Брифинг на сегодня
          </span>
        </span>
        <ChevronDown size={20} className="as-brief-chev" />
      </button>

      <div className="as-stats">
        <div className="as-stat">
          <b>{b.todayTasks.length}</b>
          <span>{plural(b.todayTasks.length, 'задача', 'задачи', 'задач')} сегодня</span>
        </div>
        <div className={`as-stat${b.overdue.length ? ' warn' : ''}`}>
          <b>{b.overdue.length}</b>
          <span>просрочено</span>
        </div>
        {b.habits.length > 0 ? (
          <div className={`as-stat${habitsDone === b.habits.length ? ' ok' : ''}`}>
            <b>
              {habitsDone}
              <small>/{b.habits.length}</small>
            </b>
            <span>привычки</span>
          </div>
        ) : (
          <div className="as-stat">
            <b>{b.doneToday}</b>
            <span>сделано сегодня</span>
          </div>
        )}
        <div className="as-stat ok" title={b.yesterday.titles.join(', ')}>
          <b>{b.yesterday.count}</b>
          <span>сделано вчера</span>
        </div>
      </div>

      {!collapsed && (
        <div className="as-brief-body">
          {b.overdue.length > 0 && (
            <div className="as-alert">
              <CircleAlert size={18} />
              <span className="grow">
                {b.overdue.length} {plural(b.overdue.length, 'задача просрочена', 'задачи просрочены', 'задач просрочено')}
                {b.overdue[0] && <span className="as-alert-sub ellipsis">«{b.overdue[0].title}»{b.overdue.length > 1 ? ' и др.' : ''}</span>}
              </span>
              <button className="btn btn-sm" onClick={moveOverdue}>
                На сегодня
              </button>
            </div>
          )}

          <div className="as-sec">
            <div className="as-sec-title">
              <Target size={15} /> Главное на сегодня
              {b.todayTasks.length > 5 && (
                <button className="as-link" onClick={() => go('tasks')}>
                  все {b.todayTasks.length}
                </button>
              )}
            </div>
            {b.top.length === 0 ? (
              <div className="as-empty-row">
                <span className="faint small">На сегодня задач нет — самое время выбрать главное.</span>
                <button className="btn btn-sm" onClick={() => openQuickAdd({ date: b.today })}>
                  <Plus size={15} /> Задача
                </button>
              </div>
            ) : (
              <ul className="as-tasks">
                {b.top.map((t) => (
                  <li key={t.id} className="as-task">
                    <button
                      className="as-check"
                      style={{ borderColor: t.priority ? PRIORITY_META[t.priority]?.color : undefined }}
                      onClick={() => toggleDone(t.id)}
                      aria-label="Выполнить"
                    >
                      <Check size={13} />
                    </button>
                    <button className="as-task-title" onClick={() => openTask(t.id)}>
                      {t.title}
                    </button>
                    {t.time && <span className="as-time">{t.time}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {b.scheduled.length > 1 && (
            <div className="as-sec">
              <div className="as-sec-title">
                <CalendarClock size={15} /> Расписание
              </div>
              <div className="as-timeline">
                {b.scheduled.slice(0, 8).map((t) => (
                  <button key={t.id} className="as-slot" onClick={() => openTask(t.id)}>
                    <b>{t.time}</b>
                    <span className="ellipsis">{t.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {b.habits.length > 0 && (
            <div className="as-sec">
              <div className="as-sec-title">
                <Flame size={15} /> Привычки
                <button className="as-link" onClick={() => go('planner')}>
                  отметить
                </button>
              </div>
              <div className="as-habits">
                {b.habits.map((h) => (
                  <span key={h.id} className={`as-habit${h.done ? ' done' : ''}`} style={{ ['--hc' as string]: h.color }}>
                    <i>{h.done ? <Check size={11} /> : h.icon ?? ''}</i>
                    {h.name}
                    {h.target ? <small>{`${h.count ?? 0}/${h.target}`}</small> : null}
                  </span>
                ))}
              </div>
            </div>
          )}

          {b.goals.length > 0 && (
            <div className="as-sec">
              <div className="as-sec-title">
                <Target size={15} /> Сроки целей на неделе
              </div>
              <ul className="as-rows">
                {b.goals.slice(0, 4).map((g) => (
                  <li key={g.id}>
                    <button
                      onClick={() => {
                        go('goals');
                        openGoal(g.goalId);
                      }}
                    >
                      <span>{g.emoji}</span>
                      <span className="grow ellipsis">{g.title}</span>
                      <span className="as-when">{relDay(g.date, b.today)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {b.payments.length > 0 && (
            <div className="as-sec">
              <div className="as-sec-title">
                <Wallet size={15} /> Платежи на неделе
              </div>
              <ul className="as-rows">
                {b.payments.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <button onClick={() => go('finance')}>
                      <span className="grow ellipsis">{p.title}</span>
                      <b className="as-amount">{fmtMoney(p.amount, p.currency)}</b>
                      <span className="as-when">{relDay(p.date, b.today)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasKey && (
            <div className={`as-ai${ai ? ' has-text' : ''}`}>
              {ai ? (
                <>
                  <div className="as-ai-head">
                    <Sparkles size={15} /> ИИ-план на день
                    <button className="as-link" onClick={() => void runAi()} disabled={aiBusy} aria-label="Обновить сводку">
                      <RefreshCw size={13} className={aiBusy ? 'spin' : undefined} /> {aiBusy ? 'пишу…' : 'обновить'}
                    </button>
                  </div>
                  <Markdown text={ai} />
                </>
              ) : (
                <button className="as-ai-btn" onClick={() => void runAi()} disabled={aiBusy}>
                  <Sparkles size={16} /> {aiBusy ? 'Составляю план…' : 'ИИ-сводка на день'}
                </button>
              )}
              {aiError && <div className="as-ai-err small">{aiError}</div>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
