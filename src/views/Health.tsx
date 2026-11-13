/**
 * «Здоровье и спорт»: привычки про здоровье и спорт на сегодня, неделя, траты на здоровье
 * и быстрые шаблоны (вода, сон, шаги, тренировки). Данные — те же, что в «Привычках».
 */
import { useEffect, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import type { Habit, PlannerData } from '../types';
import { loadPlanner, savePlanner } from '../store/db';
import { toast, useApp } from '../store/appStore';
import { syncSoon } from '../tasks/sync';
import { addDaysYmd, todayYmd, toYmd } from '../utils/mapTasks';
import { activeHabits, compareByTime, doneOn, dueOn, isCounter } from '../habits/model';
import { bumpHabitOn, toggleHabitOn } from '../habits/store';
import { habitFromPreset, type HabitPreset } from '../habits/library';
import { HEALTH_PRESETS, isHealthHabit } from '../habits/health';
import { HabitRow } from '../habits/ui';
import { IconTile } from '../ui/icons';
import { ListRow, ListSection } from '../ui/list';
import { ensureFinance, useFinance } from '../finance/store';
import { accountMap, fmtMoney, txMain } from '../finance/model';
import './health.css';

const existedOn = (h: Habit, ymd: string) => !h.createdAt || toYmd(new Date(h.createdAt)) <= ymd;
const isDue = (days: PlannerData['days'], h: Habit, ymd: string) => existedOn(h, ymd) && dueOn(days, h, ymd);

function usePlanner(): PlannerData | null {
  const [data, setData] = useState<PlannerData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void loadPlanner()
        .then((p) => alive && setData({ ...p, days: p.days ?? {}, habits: p.habits ?? [] }))
        .catch(() => alive && setData({ days: {}, habits: [] }));
    load();
    window.addEventListener('sm-planner-changed', load);
    return () => {
      alive = false;
      window.removeEventListener('sm-planner-changed', load);
    };
  }, []);
  return data;
}

/** Добавить шаблон (если привычки с таким названием ещё нет) */
async function addPreset(p: HabitPreset) {
  const pl = await loadPlanner();
  const habits = pl.habits ?? [];
  if (habits.some((h) => !h.deleted && h.name.toLowerCase() === p.name.toLowerCase())) return;
  const now = Date.now();
  await savePlanner({ ...pl, days: pl.days ?? {}, habits: [...habits, { ...habitFromPreset(p), createdAt: now, updatedAt: now }] });
  window.dispatchEvent(new Event('sm-planner-changed'));
  syncSoon(300);
  toast(`Добавлено: ${p.name}`);
}

export default function Health() {
  const go = useApp((s) => s.go);
  const data = usePlanner();
  const fin = useFinance((s) => s.data);
  useEffect(() => {
    void ensureFinance().catch(() => undefined);
  }, []);
  const today = todayYmd();
  const days = data?.days ?? {};
  const habits = activeHabits(data?.habits).filter(isHealthHabit);
  const due = habits.filter((h) => isDue(days, h, today)).sort(compareByTime);
  const done = due.filter((h) => doneOn(days, h, today)).length;
  const names = new Set((data?.habits ?? []).filter((h) => !h.deleted).map((h) => h.name.toLowerCase()));
  const presets = HEALTH_PRESETS.filter((p) => !names.has(p.name.toLowerCase()));

  // неделя: доля выполненного по дням
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDaysYmd(today, i - 6);
    const list = habits.filter((h) => isDue(days, h, d));
    const n = list.filter((h) => doneOn(days, h, d)).length;
    return { d, n, of: list.length };
  });
  const weekDone = week.reduce((a, w) => a + w.n, 0);
  const weekDue = week.reduce((a, w) => a + w.of, 0);

  // траты на здоровье за месяц (категория «Здоровье»)
  const monthFrom = today.slice(0, 8) + '01';
  const accs = fin ? accountMap(fin) : null;
  const healthSpent = fin && accs ? fin.transactions.filter((t) => t.type === 'expense' && t.categoryId === 'c-health' && t.date >= monthFrom && t.date <= today).reduce((a, t) => a + txMain(fin, t, accs), 0) : 0;

  const tap = (h: Habit, delta?: -1) => {
    const on = doneOn(days, h, today);
    void (isCounter(h) ? bumpHabitOn(h, today, delta ?? (on ? -1 : 1)) : toggleHabitOn(h, today)).then(() => {
      syncSoon(1500);
    });
  };

  return (
    <div className="page hl-page">
      <div className="page-header">
        <h1 className="grow">Здоровье и спорт</h1>
      </div>
      <div className="page-body">
        <div className="hl-wrap">
          <div className="hl-hero">
            <div className="hl-hero-num">
              <b>{done}</b>
              <span>из {due.length}</span>
            </div>
            <div className="grow">
              <div className="hl-hero-title">{due.length === 0 ? 'На сегодня ничего не запланировано' : done === due.length ? 'Всё на сегодня сделано 💪' : 'Сегодня по здоровью и спорту'}</div>
              <div className="hl-week" aria-label={`За неделю: ${weekDone} из ${weekDue}`}>
                {week.map((w) => (
                  <span key={w.d} className={`hl-week-bar${w.d === today ? ' cur' : ''}`} title={`${w.d}: ${w.n} из ${w.of}`}>
                    <i style={{ height: `${w.of ? Math.max(8, Math.round((w.n / w.of) * 100)) : 8}%` }} className={w.of && w.n === w.of ? 'full' : ''} />
                  </span>
                ))}
              </div>
              <div className="hl-hero-sub">За 7 дней: {weekDone} из {weekDue}</div>
            </div>
          </div>

          {data && due.length > 0 && (
            <ListSection header="Сегодня">
              <div className="hl-habits">
                {due.map((h) => (
                  <HabitRow key={h.id} h={h} days={days} date={today} onTap={() => tap(h)} onMinus={() => tap(h, -1)} onOpen={() => go('habits')} />
                ))}
              </div>
            </ListSection>
          )}

          {data && habits.length === 0 && (
            <p className="hl-empty">Добавьте то, за чем хотите следить: воду, сон, шаги, тренировки. Отметки, серии и напоминания — как у привычек.</p>
          )}

          {presets.length > 0 && (
            <ListSection header="Добавить" footer="Свои привычки про сон, воду, спорт и здоровье тоже попадают сюда.">
              {presets.map((p) => (
                <ListRow
                  key={p.name}
                  icon={<span className="hl-ico">{p.icon}</span>}
                  title={p.name}
                  subtitle={p.why}
                  trailing={
                    <span className="hl-add" aria-hidden="true">
                      <Plus size={18} weight="bold" />
                    </span>
                  }
                  onClick={() => void addPreset(p)}
                />
              ))}
            </ListSection>
          )}

          <ListSection>
            <ListRow icon={<IconTile section="habits" size="list" />} title="Все привычки" subtitle="Настроить, статистика, дневник и настроение" chevron onClick={() => go('habits')} />
            {fin && (
              <ListRow
                icon={<IconTile section="finance" size="list" />}
                title="Траты на здоровье"
                subtitle="Категория «Здоровье» за этот месяц"
                value={fmtMoney(healthSpent, fin.prefs.mainCurrency)}
                chevron
                onClick={() => go('finance')}
              />
            )}
            <ListRow icon={<IconTile section="goals" size="list" />} title="Цели" subtitle="Например: пробежать 10 км, сбросить вес" chevron onClick={() => go('goals')} />
          </ListSection>
        </div>
      </div>
    </div>
  );
}
