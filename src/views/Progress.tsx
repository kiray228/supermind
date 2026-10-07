import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, Flame, Lock, NotebookPen, ListChecks, Sparkles, Timer, Trophy } from 'lucide-react';
import { toast, useApp } from '../store/appStore';
import { addDaysYmd, fromYmd } from '../utils/mapTasks';
import { plural } from '../tasks/model';
import { useProgress, refreshProgressSources } from '../progress/hooks';
import { LevelRing } from '../progress/LevelBadge';
import { AREA_IDS, LEVEL_TITLES, XP, xpForLevel, type AreaId, type ProgressStats } from '../progress/model';
import { achievementColor, achievementStates, AREAS, type AchievementState } from '../progress/achievements';
import './progress.css';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const dateLabel = (ymd: string) => {
  const d = fromYmd(ymd);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${WD[d.getDay()]}`;
};

// ---------- «Что уже видели» (только на этом устройстве, для поздравлений) ----------

const SEEN_KEY = 'sm-progress-seen';
interface Seen {
  level: number;
  ach: string[];
}
function readSeen(): Seen | null {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as Seen | null;
    return v && typeof v.level === 'number' && Array.isArray(v.ach) ? v : null;
  } catch {
    return null;
  }
}
function writeSeen(s: Seen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(s));
  } catch {
    /* без сохранения */
  }
}

export default function Progress() {
  const p = useProgress();
  const states = useMemo(() => (p ? achievementStates(p.counters) : []), [p]);
  // что было получено к моменту открытия раздела — всё остальное помечается «Новое»
  const [baseline] = useState(readSeen);
  const fresh = useMemo(
    () => new Set(baseline ? states.filter((s) => s.done && !baseline.ach.includes(s.a.id)).map((s) => s.a.id) : []),
    [baseline, states],
  );

  useEffect(() => {
    void refreshProgressSources();
  }, []);

  // поздравления: новый уровень и достижения с прошлого визита
  useEffect(() => {
    if (!p) return;
    const unlocked = states.filter((s) => s.done).map((s) => s.a.id);
    const seen = readSeen();
    writeSeen({ level: p.level.level, ach: [...new Set([...(seen?.ach ?? []), ...unlocked])] });
    if (!seen) return;
    const newAch = states.filter((s) => s.done && !seen.ach.includes(s.a.id));
    const up = p.level.level > seen.level;
    if (up && newAch.length)
      toast(`🎉 Уровень ${p.level.level} — «${p.level.title}»! И ${newAch.length} ${plural(newAch.length, 'новое достижение', 'новых достижения', 'новых достижений')}`);
    else if (up) toast(`🎉 Новый уровень ${p.level.level} — «${p.level.title}»!`);
    else if (newAch.length === 1) toast(`🏆 Достижение получено: «${newAch[0].a.title}»`);
    else if (newAch.length > 1) toast(`🏆 ${newAch.length} ${plural(newAch.length, 'новое достижение', 'новых достижения', 'новых достижений')}!`);
  }, [p, states]);

  return (
    <div className="page pg-page">
      <div className="page-header">
        <h1 className="grow">Прогресс</h1>
        {p && (
          <span className="pg-total-chip" title="Весь опыт">
            <Sparkles size={14} /> {fmt(p.total)} XP
          </span>
        )}
      </div>
      <div className="page-body">
        {!p ? (
          <div className="empty">
            <Sparkles className="spin" size={22} />
            Считаем опыт…
          </div>
        ) : (
          <div className="pg-wrap">
            <Hero p={p} states={states} />
            {p.total === 0 && <StartCard />}
            <AreasCard p={p} />
            <XpChart p={p} />
            <Heatmap p={p} />
            <AchievementsCard states={states} fresh={fresh} />
            <HowTo level={p.level.level} />
          </div>
        )}
      </div>
    </div>
  );
}

// ================= Герой: уровень =================

function Hero({ p, states }: { p: ProgressStats; states: AchievementState[] }) {
  const lv = p.level;
  const next = useMemo(
    () =>
      states
        .filter((s) => !s.done)
        .sort((a, b) => b.pct - a.pct || a.a.target - b.a.target)[0],
    [states],
  );
  const got = states.filter((s) => s.done).length;
  const nextTitle = LEVEL_TITLES.find(([from]) => from > lv.level);
  return (
    <section className="card pg-hero">
      <div className="pg-hero-glow" aria-hidden />
      <div className="pg-hero-top">
        <LevelRing pct={lv.pct} size={108} stroke={9}>
          <span className="pg-hero-lvl">{lv.level}</span>
          <span className="pg-hero-lvl-cap">уровень</span>
        </LevelRing>
        <div className="pg-hero-main">
          <div className="pg-hero-kicker">Ваше звание</div>
          <div className="pg-hero-title">{lv.title}</div>
          <div className="pg-xpbar" title={`${fmt(lv.cur)} из ${fmt(lv.need)} XP`}>
            <span style={{ width: `${Math.max(2, lv.pct * 100)}%` }} />
          </div>
          <div className="pg-hero-sub">
            <b>{fmt(lv.cur)}</b> / {fmt(lv.need)} XP · ещё {fmt(lv.nextAt - lv.xp)} до {lv.level + 1} ур.
          </div>
          {nextTitle && (
            <div className="pg-hero-hint">
              «{nextTitle[1]}» — с {nextTitle[0]} уровня
            </div>
          )}
        </div>
      </div>
      <div className="pg-hero-stats">
        <div className="pg-stat">
          <span className="pg-stat-v">+{fmt(p.todayXp)}</span>
          <span className="pg-stat-l">сегодня</span>
        </div>
        <div className="pg-stat">
          <span className="pg-stat-v">+{fmt(p.weekXp)}</span>
          <span className="pg-stat-l">за неделю</span>
        </div>
        <div className={`pg-stat${p.counters.streak ? ' hot' : ''}`}>
          <span className="pg-stat-v">
            <Flame size={16} /> {p.counters.streak}
          </span>
          <span className="pg-stat-l">{plural(p.counters.streak, 'день', 'дня', 'дней')} подряд</span>
        </div>
        <div className="pg-stat">
          <span className="pg-stat-v">
            <Trophy size={15} /> {got}
          </span>
          <span className="pg-stat-l">из {states.length} наград</span>
        </div>
      </div>
      {next && (
        <div className="pg-hero-next">
          <span className="pg-hero-next-ic" style={{ '--c': achievementColor(next.a) } as CSSProperties}>
            <next.a.icon size={15} />
          </span>
          <span className="grow ellipsis">
            Следующая награда: <b>{next.a.title}</b>
          </span>
          <span className="pg-hero-next-n">
            {fmt(Math.min(next.value, next.a.target))}/{fmt(next.a.target)}
            {next.a.unit ?? ''}
          </span>
        </div>
      )}
    </section>
  );
}

function StartCard() {
  const go = useApp((s) => s.go);
  return (
    <section className="card pg-start">
      <div className="pg-start-title">Начните копить опыт ✨</div>
      <div className="small muted">
        Опыт начисляется за всё полезное: выполненные задачи, привычки, записи в дневнике, фокус, цели и учёт финансов. Ничего настраивать не нужно.
      </div>
      <div className="pg-start-btns">
        <button className="btn btn-primary btn-sm" onClick={() => go('tasks')}>
          <ListChecks size={15} /> Задачи
        </button>
        <button className="btn btn-sm" onClick={() => go('planner')}>
          <NotebookPen size={15} /> Ежедневник
        </button>
        <button className="btn btn-sm" onClick={() => go('focus')}>
          <Timer size={15} /> Фокус
        </button>
      </div>
    </section>
  );
}

// ================= Сферы жизни =================

function AreasCard({ p }: { p: ProgressStats }) {
  const [range, setRange] = useState<'all' | 30>('all');
  const rows = useMemo(() => {
    const sums: Record<AreaId, number> = { ...p.byArea };
    if (range === 30) {
      const from = addDaysYmd(p.today, -29);
      for (const a of AREA_IDS) sums[a] = 0;
      for (const [day, row] of p.byDay) if (day >= from && day <= p.today) AREA_IDS.forEach((a, i) => (sums[a] += row[i]));
    }
    return AREA_IDS.map((id) => ({ id, xp: sums[id] })).sort((a, b) => b.xp - a.xp);
  }, [p, range]);
  const max = Math.max(1, ...rows.map((r) => r.xp));
  const sum = rows.reduce((a, r) => a + r.xp, 0);
  return (
    <section className="card pg-card">
      <div className="pg-card-head">
        <h3 className="grow">Сферы жизни</h3>
        <div className="segmented">
          <button className={range === 'all' ? 'active' : ''} onClick={() => setRange('all')}>
            Всё время
          </button>
          <button className={range === 30 ? 'active' : ''} onClick={() => setRange(30)}>
            30 дней
          </button>
        </div>
      </div>
      <div className="pg-areas">
        {rows.map((r) => {
          const m = AREAS[r.id];
          return (
            <div key={r.id} className={`pg-area${r.xp ? '' : ' zero'}`} style={{ '--c': m.color } as CSSProperties}>
              <span className="pg-area-ic">
                <m.icon size={16} />
              </span>
              <div className="pg-area-body">
                <div className="pg-area-row">
                  <span className="pg-area-name">{m.label}</span>
                  <span className="pg-area-xp">
                    {r.xp ? `${fmt(r.xp)} XP` : 'пока нет'}
                    {r.xp > 0 && sum > 0 && <span className="faint"> · {Math.round((r.xp / sum) * 100)}%</span>}
                  </span>
                </div>
                <div className="pg-area-track">
                  <span style={{ width: `${(r.xp / max) * 100}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ================= График опыта =================

function XpChart({ p }: { p: ProgressStats }) {
  const [range, setRange] = useState<7 | 30>(7);
  const days = useMemo(() => Array.from({ length: range }, (_, i) => addDaysYmd(p.today, i - (range - 1))), [p.today, range]);
  const totals = days.map((d) => p.dayTotal.get(d) ?? 0);
  const max = Math.max(1, ...totals);
  const sum = totals.reduce((a, b) => a + b, 0);
  const best = Math.max(...totals);
  const used = AREA_IDS.filter((_, i) => days.some((d) => (p.byDay.get(d)?.[i] ?? 0) > 0));
  return (
    <section className="card pg-card">
      <div className="pg-card-head">
        <h3 className="grow">Опыт по дням</h3>
        <div className="segmented">
          <button className={range === 7 ? 'active' : ''} onClick={() => setRange(7)}>
            7 дней
          </button>
          <button className={range === 30 ? 'active' : ''} onClick={() => setRange(30)}>
            30 дней
          </button>
        </div>
      </div>
      <div className={`pg-chart${range === 30 ? ' dense' : ''}`}>
        {days.map((d, i) => {
          const row = p.byDay.get(d);
          const t = totals[i];
          const label = range === 7 ? WD[fromYmd(d).getDay()] : (range - 1 - i) % 5 === 0 ? String(fromYmd(d).getDate()) : '';
          return (
            <div key={d} className={`pg-col${d === p.today ? ' today' : ''}`} title={`${dateLabel(d)}: ${fmt(t)} XP`}>
              {range === 7 && <span className="pg-col-v">{t ? fmt(t) : ''}</span>}
              <div className="pg-col-bar" style={{ height: `${(t / max) * 100}%` }}>
                {row &&
                  AREA_IDS.map((a, k) =>
                    row[k] > 0 ? <span key={a} style={{ flexGrow: row[k], background: AREAS[a].color }} /> : null,
                  )}
              </div>
              <span className="pg-col-l">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="pg-legend">
        {used.map((a) => (
          <span key={a} className="pg-legend-item">
            <i style={{ background: AREAS[a].color }} />
            {AREAS[a].label}
          </span>
        ))}
      </div>
      <div className="tiny faint">
        {sum ? (
          <>
            {fmt(sum)} XP за {range} {plural(range, 'день', 'дня', 'дней')} · в среднем {fmt(sum / range)} в день · лучший день {fmt(best)}
          </>
        ) : (
          'За этот период опыта пока нет'
        )}
      </div>
    </section>
  );
}

// ================= Карта активности =================

const WEEKS = 17;

function heatLevel(xp: number): number {
  if (xp <= 0) return 0;
  if (xp < 30) return 1;
  if (xp < 80) return 2;
  if (xp < 160) return 3;
  return 4;
}

function Heatmap({ p }: { p: ProgressStats }) {
  const { weeks, months } = useMemo(() => {
    const monday = addDaysYmd(p.today, -((fromYmd(p.today).getDay() + 6) % 7));
    const start = addDaysYmd(monday, -(WEEKS - 1) * 7);
    const weeks: string[][] = [];
    const months: string[] = [];
    for (let w = 0; w < WEEKS; w++) {
      const col = Array.from({ length: 7 }, (_, d) => addDaysYmd(start, w * 7 + d));
      weeks.push(col);
      const first = col.find((d) => fromYmd(d).getDate() === 1);
      months.push(first ? MONTHS_SHORT[fromYmd(first).getMonth()] : w === 0 ? MONTHS_SHORT[fromYmd(col[0]).getMonth()] : '');
    }
    return { weeks, months };
  }, [p.today]);
  const inRange = weeks.flat().filter((d) => d <= p.today);
  const active = inRange.filter((d) => (p.dayTotal.get(d) ?? 0) > 0).length;
  return (
    <section className="card pg-card">
      <div className="pg-card-head">
        <h3 className="grow">Активность</h3>
        <span className="small muted">
          {active} из {inRange.length} {plural(inRange.length, 'дня', 'дней', 'дней')}
        </span>
      </div>
      <div className="pg-heat" style={{ '--weeks': WEEKS } as CSSProperties}>
        <div className="pg-heat-wd">
          {['пн', '', 'ср', '', 'пт', '', 'вс'].map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
        <div className="pg-heat-main">
          <div className="pg-heat-months">
            {months.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
          <div className="pg-heat-grid">
            {weeks.flat().map((d) => {
              const xp = p.dayTotal.get(d) ?? 0;
              const future = d > p.today;
              return (
                <span
                  key={d}
                  className={`pg-cell l${heatLevel(xp)}${future ? ' future' : ''}${d === p.today ? ' today' : ''}`}
                  title={future ? undefined : `${dateLabel(d)}: ${xp ? fmt(xp) + ' XP' : 'нет активности'}`}
                />
              );
            })}
          </div>
        </div>
      </div>
      <div className="pg-heat-foot">
        <span className="tiny faint grow">
          Серия: {p.counters.streak} · рекорд: {p.counters.bestStreak} · всего активных дней: {p.counters.activeDays}
        </span>
        <span className="pg-heat-legend tiny faint">
          меньше
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={`pg-cell l${l}`} />
          ))}
          больше
        </span>
      </div>
    </section>
  );
}

// ================= Достижения =================

type AchFilter = 'all' | 'done' | 'todo';
const TIER_LABEL = ['', 'Обычное', 'Редкое', 'Легендарное'];

function AchievementsCard({ states, fresh }: { states: AchievementState[]; fresh: Set<string> }) {
  const [filter, setFilter] = useState<AchFilter>('all');
  const got = states.filter((s) => s.done).length;
  const list = useMemo(() => {
    const l = states.filter((s) => (filter === 'all' ? true : filter === 'done' ? s.done : !s.done));
    return l.sort((a, b) => {
      const fa = fresh.has(a.a.id) ? 1 : 0;
      const fb = fresh.has(b.a.id) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      if (a.done !== b.done) return a.done ? -1 : 1;
      if (!a.done) return b.pct - a.pct;
      return b.a.tier - a.a.tier;
    });
  }, [states, filter, fresh]);
  return (
    <section className="card pg-card">
      <div className="pg-card-head">
        <h3 className="grow">
          Достижения <span className="pg-count">{got}/{states.length}</span>
        </h3>
        <div className="segmented">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            Все
          </button>
          <button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>
            Есть
          </button>
          <button className={filter === 'todo' ? 'active' : ''} onClick={() => setFilter('todo')}>
            Впереди
          </button>
        </div>
      </div>
      <div className="pg-xpbar thin">
        <span style={{ width: `${(got / Math.max(1, states.length)) * 100}%` }} />
      </div>
      {list.length === 0 ? (
        <div className="faint small pg-ach-empty">{filter === 'done' ? 'Пока ни одного — первое совсем близко!' : 'Все достижения получены. Вы легенда!'}</div>
      ) : (
        <div className="pg-achs">
          {list.map((s) => (
            <AchTile key={s.a.id} s={s} isNew={fresh.has(s.a.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function AchTile({ s, isNew }: { s: AchievementState; isNew: boolean }) {
  const { a } = s;
  const Icon = a.icon;
  return (
    <div className={`pg-ach${s.done ? ' done' : ''} tier-${a.tier}${isNew ? ' new' : ''}`} style={{ '--c': achievementColor(a) } as CSSProperties} title={TIER_LABEL[a.tier]}>
      {isNew && <span className="pg-ach-new">Новое</span>}
      <span className="pg-ach-ic">
        <Icon size={20} />
        {!s.done && (
          <span className="pg-ach-lock">
            <Lock size={10} />
          </span>
        )}
      </span>
      <span className="pg-ach-title">{a.title}</span>
      <span className="pg-ach-desc">{a.desc}</span>
      {s.done ? (
        <span className="pg-ach-got">{'★'.repeat(a.tier)} {TIER_LABEL[a.tier]}</span>
      ) : (
        <span className="pg-ach-prog">
          <span className="pg-ach-track">
            <span style={{ width: `${s.pct * 100}%` }} />
          </span>
          <span className="pg-ach-n">
            {fmt(Math.min(s.value, a.target))}/{fmt(a.target)}
            {a.unit ?? ''}
          </span>
        </span>
      )}
    </div>
  );
}

// ================= Как получать опыт =================

const RULES: { area: AreaId; items: [string, string][] }[] = [
  {
    area: 'tasks',
    items: [
      ['Выполненная задача', `+${XP.task}`],
      ['Высокий / средний приоритет', `+${XP.taskHigh} / +${XP.taskMedium}`],
      ['Пункт чек-листа', `+${XP.checkItem}`],
    ],
  },
  { area: 'habits', items: [['Отметка привычки', `+${XP.habit}`]] },
  {
    area: 'journal',
    items: [
      ['Запись в дневнике', `+${XP.journal}`],
      [`Длинная запись (от ${XP.journalLongChars} знаков)`, `+${XP.journalLong}`],
      ['Отмеченное настроение', `+${XP.mood}`],
    ],
  },
  { area: 'focus', items: [['Минута фокуса', `+${XP.focusPerMin}`], ['Максимум за день', `${XP.focusDayCap}`]] },
  {
    area: 'goals',
    items: [
      ['Новая цель', `+${XP.goalCreated}`],
      ['Выполненный шаг', `+${XP.step}`],
      ['Завершённый этап', `+${XP.stage}`],
      ['Цель достигнута', `+${XP.goalDone}`],
      ['Обновление прогресса (раз в день)', `+${XP.goalUpdate}`],
      ['Оценка колеса баланса', `+${XP.wheel}`],
    ],
  },
  {
    area: 'finance',
    items: [
      ['День с учётом операций', `+${XP.financeDay}`],
      [`За каждую операцию (до ${XP.financeTxCap} в день)`, `+${XP.financeTx}`],
      ['Месяц в рамках бюджета', `+${XP.budgetMonth}`],
      ['Закрытый долг', `+${XP.debtClosed}`],
    ],
  },
  {
    area: 'knowledge',
    items: [
      [`Новая заметка (до ${XP.notesDayCap} в день)`, `+${XP.note}`],
      [`Новая интеллект-карта (до ${XP.mapsDayCap} в день)`, `+${XP.map}`],
    ],
  },
];

function HowTo({ level }: { level: number }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`card pg-card pg-howto${open ? ' open' : ''}`}>
      <button className="pg-howto-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h3 className="grow">Как получать опыт</h3>
        <ChevronDown size={18} className="pg-howto-chev" />
      </button>
      {open && (
        <div className="pg-howto-body">
          <p className="small muted">
            Опыт считается сам — из ваших задач, привычек, дневника, фокуса, целей, финансов и заметок. Он одинаков на всех устройствах: если отменить
            выполнение, опыт тоже вернётся назад.
          </p>
          <div className="pg-rules">
            {RULES.map((g) => {
              const m = AREAS[g.area];
              return (
                <div key={g.area} className="pg-rule-group" style={{ '--c': m.color } as CSSProperties}>
                  <div className="pg-rule-title">
                    <span className="pg-area-ic sm">
                      <m.icon size={13} />
                    </span>
                    {m.label}
                  </div>
                  {g.items.map(([what, xp]) => (
                    <div key={what} className="pg-rule">
                      <span className="grow">{what}</span>
                      <b>{xp}</b>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <h4 className="pg-ladder-title">Звания</h4>
          <div className="pg-ladder">
            {LEVEL_TITLES.map(([from, name], i) => {
              const to = LEVEL_TITLES[i + 1]?.[0];
              const cur = level >= from && (to === undefined || level < to);
              return (
                <div key={name} className={`pg-rung${cur ? ' cur' : ''}${level >= from ? ' reached' : ''}`}>
                  <span className="pg-rung-lvl">{from}</span>
                  <span className="grow">{name}</span>
                  <span className="tiny faint">{fmt(xpForLevel(from))} XP</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
