import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Lightbulb, Network, X } from 'lucide-react';
import { toast } from '../store/appStore';
import { ensureTasks, addTask, useTasks } from '../tasks/store';
import { ensureFinance, useFinance } from '../finance/store';
import { fmtMoney } from '../finance/model';
import { useProgress, useProgressExtra, refreshProgressSources } from '../progress/hooks';
import { createAndOpen } from '../actions';
import { docFromMarkdown } from '../templates';
import { addDaysYmd, fromYmd, todayYmd } from '../utils/mapTasks';
import { mondayOf } from '../habits/model';
import { computeWeek, dayShort, journalText, lines, minutesLabel, moodForScore, reviewMarkdown, WD_SHORT, type ReviewAnswers, type WeeklyStats } from './weekly';
import { appendJournal, markSaved, readDraft, savedWeek, writeDraft } from './state';
import './weekly.css';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/** «+3», «−2», '' */
const delta = (cur: number, prev: number) => (cur === prev || prev === 0 ? '' : cur > prev ? `+${fmt(cur - prev)}` : `−${fmt(prev - cur)}`);

/** Итоги недели — лист на весь экран */
export function WeeklyReview({ monday: start, onClose }: { monday: string; onClose: () => void }) {
  const [monday, setMonday] = useState(start);
  const tasks = useTasks((s) => s.data);
  const finance = useFinance((s) => s.data);
  const planner = useProgressExtra((s) => s.planner);
  const progress = useProgress();

  useEffect(() => {
    void ensureTasks().catch(() => undefined);
    void ensureFinance().catch(() => undefined);
    void refreshProgressSources().catch(() => undefined);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dayXp = progress?.dayTotal ?? null;
  const s = useMemo(() => computeWeek({ tasks, planner, finance, dayXp }, monday), [tasks, planner, finance, dayXp, monday]);
  const thisMonday = mondayOf(todayYmd());
  const ready = planner !== null && tasks !== null;

  return createPortal(
    <div className="modal-backdrop wr-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wr-sheet" role="dialog" aria-label="Итоги недели">
        <div className="wr-bar">
          <span />
          <div className="wr-bar-title">Итоги недели</div>
          <button className="icon-btn wr-close" onClick={onClose} aria-label="Закрыть">
            <X />
          </button>
        </div>

        <div className="wr-switch">
          <button className="icon-btn" onClick={() => setMonday(addDaysYmd(monday, -7))} aria-label="Предыдущая неделя">
            <ChevronLeft />
          </button>
          <div className="wr-switch-mid">
            <b>{s.label}</b>
            <span>{monday === thisMonday ? 'Эта неделя' : monday === addDaysYmd(thisMonday, -7) ? 'Прошлая неделя' : `Неделя с ${dayShort(monday)}`}</span>
          </div>
          <button className="icon-btn" onClick={() => setMonday(addDaysYmd(monday, 7))} disabled={monday >= thisMonday} aria-label="Следующая неделя">
            <ChevronRight />
          </button>
        </div>

        {!ready ? (
          <div className="empty">Считаем итоги…</div>
        ) : (
          <>
            <Stats s={s} />
            <ReviewForm key={monday} s={s} onClose={onClose} />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Цифры ----------

function Stats({ s }: { s: WeeklyStats }) {
  const money = (v: number) => fmtMoney(v, s.currency, { compact: true });
  const spentPct = s.prevSpent > 0 ? Math.round(((s.spent - s.prevSpent) / s.prevSpent) * 100) : null;
  const today = todayYmd();
  const headline =
    s.tasksDone || s.habitRate != null
      ? [s.tasksDone ? `${s.tasksDone} ${plural(s.tasksDone, 'задача', 'задачи', 'задач')}` : '', s.habitRate != null ? `привычки ${Math.round(s.habitRate * 100)}%` : '']
          .filter(Boolean)
          .join(' · ')
      : 'Неделя без отметок';

  return (
    <div className="wr-stats">
      <section className={`wr-hero${s.habitRate === 1 ? ' full' : ''}`}>
        <div className="wr-hero-big">{headline}</div>
        <div className="wr-hero-sub">
          {s.current ? 'Неделя ещё идёт' : 'Неделя завершена'}
          {s.xp > 0 ? ` · +${fmt(s.xp)} XP` : ''}
        </div>
      </section>

      <div className="wr-tiles">
        <Tile icon="✅" value={fmt(s.tasksDone)} label={plural(s.tasksDone, 'задача', 'задачи', 'задач')} note={delta(s.tasksDone, s.prevTasksDone)} good={s.tasksDone >= s.prevTasksDone} />
        <Tile icon="🔥" value={s.habitRate == null ? '—' : `${Math.round(s.habitRate * 100)}%`} label={s.habitExpected ? `привычки · ${s.habitDone} из ${s.habitExpected}` : 'привычки'} />
        <Tile icon="⏱️" value={minutesLabel(s.focusMin)} label="фокус" note={s.prevFocusMin ? delta(Math.round(s.focusMin), Math.round(s.prevFocusMin)) : ''} good={s.focusMin >= s.prevFocusMin} />
        <Tile icon="✨" value={`+${fmt(s.xp)}`} label="опыта (XP)" note={delta(s.xp, s.prevXp)} good={s.xp >= s.prevXp} />
        {s.hasFinance && (
          <Tile icon="💸" value={money(s.spent)} label="расходы" note={spentPct != null && spentPct !== 0 ? `${spentPct > 0 ? '+' : '−'}${Math.abs(spentPct)}%` : ''} good={spentPct != null && spentPct < 0} />
        )}
        {s.hasFinance && <Tile icon="💰" value={money(s.income)} label="доходы" note={delta(s.income, s.prevIncome)} good={s.income >= s.prevIncome} />}
      </div>

      <section className="wr-card wr-moods" aria-label="Настроение за неделю">
        <div className="wr-card-title">
          Настроение
          {s.moodAvg != null && (
            <span className="wr-card-aside">
              {moodForScore(s.moodAvg)} {s.moodAvg.toFixed(1).replace('.', ',')} из 5
            </span>
          )}
        </div>
        <div className="wr-mood-strip">
          {s.days.map((d) => (
            <div key={d.date} className={`wr-mood-day${d.date === today ? ' today' : ''}${d.date > today ? ' future' : ''}`}>
              <span className="wr-mood-e">{d.mood ?? <i />}</span>
              <span className="wr-mood-wd">{WD_SHORT[fromYmd(d.date).getDay()]}</span>
            </div>
          ))}
        </div>
        {s.moodDays === 0 && <div className="wr-hint">Отмечайте настроение в разделе «Привычки» — здесь появится картина недели.</div>}
      </section>

      {(s.bestDay || s.bestStreak) && (
        <section className="wr-card wr-rows">
          {s.bestDay && (
            <div className="wr-row">
              <span className="wr-row-ic">🏆</span>
              <span className="grow">
                <span className="wr-row-t">Лучший день</span>
                <span className="wr-row-s">
                  {[`${s.bestDay.tasks} ${plural(s.bestDay.tasks, 'задача', 'задачи', 'задач')}`, s.bestDay.focus ? `фокус ${minutesLabel(s.bestDay.focus)}` : '', s.bestDay.xp ? `${fmt(s.bestDay.xp)} XP` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="wr-row-v">{dayShort(s.bestDay.date)}</span>
            </div>
          )}
          {s.bestStreak && (
            <div className="wr-row">
              <span className="wr-row-ic">{s.bestStreak.icon ?? '🔥'}</span>
              <span className="grow">
                <span className="wr-row-t">Лучшая серия</span>
                <span className="wr-row-s ellipsis">{s.bestStreak.name}</span>
              </span>
              <span className="wr-row-v">{s.bestStreak.text}</span>
            </div>
          )}
        </section>
      )}

      {s.insights.length > 0 && (
        <section className="wr-card wr-insights">
          {s.insights.map((t) => (
            <div key={t} className="wr-insight">
              <Lightbulb size={16} />
              <span>{t}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Tile({ icon, value, label, note, good }: { icon: string; value: string; label: string; note?: string; good?: boolean }) {
  return (
    <div className="wr-tile">
      <span className="wr-tile-ic" aria-hidden>
        {icon}
      </span>
      <b className="wr-tile-v">{value}</b>
      <span className="wr-tile-l">
        {label}
        {note ? <em className={good ? 'up' : 'down'}>{note}</em> : null}
      </span>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// ---------- Вопросы и сохранение ----------

const PROMPTS: { k: keyof ReviewAnswers; title: string; ph: string }[] = [
  { k: 'good', title: 'Что получилось', ph: 'Закрыл проект, 3 тренировки, прочитал книгу…' },
  { k: 'bad', title: 'Что мешало', ph: 'Поздно ложился, много отвлекался на телефон…' },
  { k: 'next', title: 'Главное на следующую неделю', ph: 'По одному пункту в строке — станут задачами на понедельник' },
];

function ReviewForm({ s, onClose }: { s: WeeklyStats; onClose: () => void }) {
  const [a, setA] = useState<ReviewAnswers>(() => readDraft(s.monday));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(() => !!savedWeek(s.monday)?.text);
  const empty = !a.good.trim() && !a.bad.trim() && !a.next.trim();
  const plans = lines(a.next);
  const textMoney = (v: number) => fmtMoney(v, s.currency);

  const change = (k: keyof ReviewAnswers, v: string) => {
    const next = { ...a, [k]: v };
    setA(next);
    setSaved(false);
    writeDraft(s.monday, next);
  };

  const save = async () => {
    if (busy) return;
    if (empty) return toast('Напишите хотя бы пару строк');
    setBusy(true);
    try {
      const prev = savedWeek(s.monday);
      const text = journalText(s, a, textMoney);
      await appendJournal(s.sunday, text, prev?.text);
      // задачи на следующий понедельник — только новые строки (повторное сохранение не дублирует)
      let created = 0;
      const done = new Set(prev?.tasks ?? []);
      if (plans.some((l) => !done.has(l))) {
        await ensureTasks();
        const nextMon = addDaysYmd(s.monday, 7);
        for (const l of plans) {
          if (done.has(l)) continue;
          if (addTask({ title: l, date: nextMon })) {
            done.add(l);
            created++;
          }
        }
      }
      markSaved(s.monday, { text, tasks: [...done] });
      setSaved(true);
      toast(created ? `Итоги в дневнике · ${created} ${plural(created, 'задача', 'задачи', 'задач')} на понедельник` : 'Итоги сохранены в дневник воскресенья');
    } catch {
      toast('Не удалось сохранить итоги');
    } finally {
      setBusy(false);
    }
  };

  const saveMap = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const doc = docFromMarkdown(reviewMarkdown(s, a, textMoney), `Неделя ${s.label}`, 'map');
      onClose();
      await createAndOpen(doc);
    } catch {
      toast('Не удалось создать карту');
      setBusy(false);
    }
  };

  return (
    <div className="wr-form">
      <div className="wr-form-title">Подведите итоги — 2 минуты</div>
      {PROMPTS.map((p) => (
        <label key={p.k} className="wr-q">
          <span className="wr-q-t">{p.title}</span>
          <textarea className="textarea wr-q-ta" rows={3} value={a[p.k]} placeholder={p.ph} onChange={(e) => change(p.k, e.target.value)} />
        </label>
      ))}
      {plans.length > 0 && (
        <div className="wr-hint">
          {plans.length} {plural(plans.length, 'задача будет создана', 'задачи будут созданы', 'задач будут созданы')} на понедельник, {dayShort(addDaysYmd(s.monday, 7))}
        </div>
      )}
      <div className="wr-actions">
        <button className="btn btn-primary btn-block" onClick={() => void save()} disabled={busy || empty}>
          {saved ? 'Сохранено ✓' : 'Сохранить'}
        </button>
        <button className="btn btn-tinted btn-block" onClick={() => void saveMap()} disabled={busy}>
          <Network size={17} /> Сохранить как карту
        </button>
      </div>
      <div className="wr-foot">Итоги допишутся в дневник воскресенья, {dayShort(s.sunday)}.</div>
    </div>
  );
}
