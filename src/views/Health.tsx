/**
 * «Здоровье и спорт»: привычки про здоровье и спорт на сегодня, неделя, траты на здоровье
 * и быстрые шаблоны (вода, сон, шаги, тренировки). Данные — те же, что в «Привычках».
 */
import { LOCALE, t } from '../i18n/index';
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
import { linkHealth, openHealthSettings, unlinkHealth, useHealth, type HealthSource } from '../health/connect';
import { fmtSleep } from '../health/healthCore';
import { confirmDialog } from '../ui/dialogs';
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
  toast(t('Добавлено: {name}', { name: p.name }));
}

const SOURCE_NAME: Record<HealthSource, string> = { apple: t('Apple «Здоровье»'), connect: 'Health Connect' };
const fmtSteps = (n: number) => n.toLocaleString(LOCALE);

/** Шаги и сон из «Здоровья» телефона: подключение, сегодня, неделя шагов */
function HealthLink() {
  const { source, linked, data } = useHealth();
  const [busy, setBusy] = useState(false);
  if (!source) return null;
  const name = SOURCE_NAME[source];
  const today = todayYmd();
  const connect = async () => {
    if (busy) return;
    setBusy(true);
    const r = await linkHealth().finally(() => setBusy(false));
    if (r === 'install') toast(t('Установите Health Connect из Google Play и попробуйте снова'));
    else if (r === 'denied') toast(source === 'connect' ? t('Доступ не дан — его можно включить в Health Connect') : t('Доступ не дан — включите его в «Здоровье» → Доступ'));
    else if (r === 'unavailable') toast(t('{name} недоступно на этом устройстве', { name }));
  };
  if (!linked) {
    return (
      <ListSection
        header={t('Шаги и сон')}
        footer={t('Шаги и сон читаются из {name} только на этом телефоне и никуда не отправляются. Привычки вроде «10 000 шагов», «Сон 8 часов» и «Лечь спать до 23:00» будут отмечаться сами.', { name })}
      >
        <ListRow icon={<span className="hl-ico">👣</span>} title={t('Подключить {name}', { name })} subtitle={t('Шаги за день и сон за ночь')} chevron onClick={() => void connect()} />
      </ListSection>
    );
  }
  const week = Array.from({ length: 7 }, (_, i) => addDaysYmd(today, i - 6));
  const stepsOf = (d: string) => data?.steps[d] ?? 0;
  const max = Math.max(10_000, ...week.map(stepsOf));
  const sleep = data?.sleep[today];
  const disconnect = async () => {
    const ok = await confirmDialog(
      t('Отключить «Здоровье»?'),
      source === 'connect' ? t('SuperMind перестанет читать шаги и сон. Доступ можно отозвать и в Health Connect.') : t('SuperMind перестанет показывать шаги и сон. Доступ можно отозвать в «Здоровье» → Доступ.'),
      { okText: t('Отключить') },
    );
    if (ok) unlinkHealth();
  };
  return (
    <ListSection header={t('Шаги и сон')} footer={t('Из {name}, только на этом телефоне.', { name })}>
      <div className="hl-link">
        <div className="hl-link-stat">
          <span className="hl-link-label">{t('👣 Шаги сегодня')}</span>
          <b>{fmtSteps(stepsOf(today))}</b>
          <div className="hl-steps-week" aria-label={t('Шаги за неделю')}>
            {week.map((d) => (
              <span key={d} className={`hl-steps-bar${d === today ? ' cur' : ''}`} title={`${d}: ${fmtSteps(stepsOf(d))}`}>
                <i style={{ height: `${Math.max(6, Math.round((stepsOf(d) / max) * 100))}%` }} />
              </span>
            ))}
          </div>
        </div>
        <div className="hl-link-stat">
          <span className="hl-link-label">{t('😴 Сон за ночь')}</span>
          <b>{sleep ? fmtSleep(sleep) : '—'}</b>
          <span className="hl-link-sub">{sleep ? t('по данным {name}', { name }) : t('нет данных за эту ночь')}</span>
        </div>
      </div>
      {source === 'connect' && <ListRow title={t('Доступ в Health Connect')} chevron onClick={() => void openHealthSettings()} />}
      <ListRow title={t('Отключить')} onClick={() => void disconnect()} />
    </ListSection>
  );
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
        <h1 className="grow">{t('Здоровье и спорт')}</h1>
      </div>
      <div className="page-body">
        <div className="hl-wrap">
          <div className="hl-hero">
            <div className="hl-hero-num">
              <b>{done}</b>
              <span>{t('из {total}', { total: due.length })}</span>
            </div>
            <div className="grow">
              <div className="hl-hero-title">{due.length === 0 ? t('На сегодня ничего не запланировано') : done === due.length ? t('Всё на сегодня сделано 💪') : t('Сегодня по здоровью и спорту')}</div>
              <div className="hl-week" aria-label={t('За неделю: {done} из {total}', { done: weekDone, total: weekDue })}>
                {week.map((w) => (
                  <span key={w.d} className={`hl-week-bar${w.d === today ? ' cur' : ''}`} title={t('{date}: {done} из {total}', { date: w.d, done: w.n, total: w.of })}>
                    <i style={{ height: `${w.of ? Math.max(8, Math.round((w.n / w.of) * 100)) : 8}%` }} className={w.of && w.n === w.of ? 'full' : ''} />
                  </span>
                ))}
              </div>
              <div className="hl-hero-sub">{t('За 7 дней: {done} из {total}', { done: weekDone, total: weekDue })}</div>
            </div>
          </div>

          <HealthLink />

          {data && due.length > 0 && (
            <ListSection header={t('Сегодня')}>
              <div className="hl-habits">
                {due.map((h) => (
                  <HabitRow key={h.id} h={h} days={days} date={today} onTap={() => tap(h)} onMinus={() => tap(h, -1)} onOpen={() => go('habits')} />
                ))}
              </div>
            </ListSection>
          )}

          {data && habits.length === 0 && (
            <p className="hl-empty">{t('Добавьте то, за чем хотите следить: воду, сон, шаги, тренировки. Отметки, серии и напоминания — как у привычек.')}</p>
          )}

          {presets.length > 0 && (
            <ListSection header={t('Добавить')} footer={t('Свои привычки про сон, воду, спорт и здоровье тоже попадают сюда.')}>
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
            <ListRow icon={<IconTile section="habits" size="list" />} title={t('Все привычки')} subtitle={t('Настроить, статистика, дневник и настроение')} chevron onClick={() => go('habits')} />
            {fin && (
              <ListRow
                icon={<IconTile section="finance" size="list" />}
                title={t('Траты на здоровье')}
                subtitle={t('Категория «Здоровье» за этот месяц')}
                value={fmtMoney(healthSpent, fin.prefs.mainCurrency)}
                chevron
                onClick={() => go('finance')}
              />
            )}
            <ListRow icon={<IconTile section="goals" size="list" />} title={t('Цели')} subtitle={t('Например: пробежать 10 км, сбросить вес')} chevron onClick={() => go('goals')} />
          </ListSection>
        </div>
      </div>
    </div>
  );
}
