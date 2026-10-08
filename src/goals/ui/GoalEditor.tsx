import { useState } from 'react';
import type { CSSProperties } from 'react';
import { toast } from '../../store/appStore';
import { todayYmd } from '../../utils/mapTasks';
import { uid } from '../../utils/tree';
import { fmtNum, parseMoneyInput } from '../../finance/model';
import { saveAccount, useFinance } from '../../finance/store';
import { accountBalance, defaultSavingsName, NEW_SAVINGS_ACCOUNT, savingsBase, type SavingsDraft } from '../savings';
import {
  GOAL_EMOJIS,
  GOAL_PRIORITIES,
  MODES,
  PERIODS,
  periodRange,
  sortedAreas,
  type Goal,
  type GoalPeriod,
  type GoalPriority,
  type GoalSavings,
  type GoalsData,
  type GoalTarget,
  type ProgressMode,
} from '../model';
import { addGoal, openGoal, updateGoal } from '../store';
import { Sheet } from './parts';
import { SavingsFields } from './Savings';

/** Последний символ строки (эмодзи из нескольких кодов не разрываются) */
function lastGrapheme(s: string): string {
  const parts = [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(s.trim())];
  return parts.length ? parts[parts.length - 1].segment : '';
}

/** Создание и редактирование цели */
export function GoalEditor({ data, goal, preset, onClose }: { data: GoalsData; goal?: Goal; preset?: Partial<Goal>; onClose: () => void }) {
  const init = goal ?? preset ?? {};
  const today = todayYmd();
  const firstRange = periodRange(init.period ?? 'year', today)!;
  const [title, setTitle] = useState(init.title ?? '');
  const [emoji, setEmoji] = useState(init.emoji ?? '🎯');
  const [why, setWhy] = useState(init.why ?? '');
  const [areaId, setAreaId] = useState<string | undefined>(init.areaId);
  const [period, setPeriod] = useState<GoalPeriod>(init.period ?? 'year');
  const [shift, setShift] = useState(0);
  const [start, setStart] = useState(init.start ?? firstRange.start);
  const [deadline, setDeadline] = useState(init.deadline ?? (init.period === 'custom' ? '' : firstRange.end));
  const [priority, setPriority] = useState<GoalPriority>(init.priority ?? 0);
  const [mode, setMode] = useState<ProgressMode>(init.mode ?? 'stages');
  const t0: GoalTarget = init.target ?? { start: 0, target: 12, current: 0, unit: '', step: 1 };
  // числа редактируем строками: иначе нельзя ввести «-» или «1,»
  const [tf, setTf] = useState({ start: String(t0.start), target: String(t0.target), current: String(t0.current), step: String(t0.step), unit: t0.unit });
  const tfSet = (k: keyof typeof tf) => (e: { target: { value: string } }) => setTf({ ...tf, [k]: k === 'unit' ? e.target.value.slice(0, 20) : e.target.value });
  // копилка: счёт в Финансах и сумма
  const fin = useFinance((s) => s.data);
  const sv0 = init.savings;
  const [sv, setSv] = useState<SavingsDraft>({
    accountId: sv0?.accountId ?? NEW_SAVINGS_ACCOUNT,
    amount: sv0?.amount ? fmtNum(sv0.amount) : '',
    newName: '',
    newCurrency: '',
    countExisting: !sv0?.base,
  });

  const pickMode = (m: ProgressMode) => {
    setMode(m);
    if (m !== 'savings' || goal) return;
    // новая копилка: подходящий значок и сфера «Финансы»
    if (emoji === '🎯') setEmoji('🐷');
    if (!areaId && data.areas.some((a) => a.id === 'area-finance')) setAreaId('area-finance');
  };

  /** Собрать копилку (новый счёт создаётся здесь же). null — ошибка уже показана */
  const buildSavings = (): GoalSavings | null => {
    if (!fin) {
      toast('Финансы ещё загружаются');
      return null;
    }
    const amount = parseMoneyInput(sv.amount);
    if (!(amount > 0)) {
      toast('Укажите, сколько нужно накопить');
      return null;
    }
    if (sv.accountId === NEW_SAVINGS_ACCOUNT) {
      const currency = sv.newCurrency || fin.prefs.mainCurrency;
      const id = uid();
      saveAccount({ id, name: sv.newName.trim() || defaultSavingsName(title), emoji: '🐷', color: '#ec4899', currency, initial: 0 });
      return { accountId: id, amount, currency };
    }
    const acc = fin.accounts.find((a) => a.id === sv.accountId);
    if (!acc) {
      toast('Выберите счёт-копилку');
      return null;
    }
    const base = savingsBase(sv, sv0, accountBalance(fin, acc.id));
    return { accountId: acc.id, amount, currency: acc.currency, ...(base ? { base } : {}) };
  };

  const pickPeriod = (p: GoalPeriod, n = shift) => {
    setPeriod(p);
    setShift(n);
    const r = periodRange(p, today, n);
    if (r) {
      setStart(r.start);
      setDeadline(r.end);
    } else if (!goal) setStart(today);
  };

  const num = (v: string, def = 0) => {
    // «10 000» и «4,5»: пробелы — разделители разрядов, запятая — дробь
    const t = v.replace(/\s/g, '').replace(',', '.').replace(/^[−–]/, '-');
    const n = Number(t);
    return t && Number.isFinite(n) ? n : def;
  };

  const save = () => {
    if (!title.trim()) return toast('Введите название цели');
    if (deadline && start && deadline < start) return toast('Срок не может быть раньше начала');
    const target: GoalTarget = { start: num(tf.start), target: num(tf.target), current: num(tf.current), unit: tf.unit.trim(), step: num(tf.step, 1) };
    if (mode === 'target' && target.target === target.start) return toast('Целевое значение должно отличаться от начального');
    let savings: GoalSavings | null = null;
    if (mode === 'savings' && !(savings = buildSavings())) return;
    const patch: Partial<Goal> = {
      title: title.trim(),
      emoji: emoji || '🎯',
      why: why.trim(),
      areaId,
      period,
      start: start || today,
      deadline: deadline || undefined,
      priority,
      mode,
      ...(mode === 'target' ? { target: { ...target, step: target.step > 0 ? target.step : 1 } } : {}),
      ...(savings ? { savings } : {}),
    };
    if (goal) {
      updateGoal(goal.id, patch);
      onClose();
    } else {
      const g = addGoal({ ...preset, ...patch, ...(mode === 'target' ? { target: { ...target, current: target.start } } : {}) });
      onClose();
      if (g) openGoal(g.id);
    }
  };

  const areas = sortedAreas(data);

  return (
    <Sheet onClose={onClose} className="gl-editor" title={goal ? 'Изменить цель' : 'Новая цель'}>
      <div className="gl-title-row">
        <span className="gl-emoji-big" aria-hidden>
          {emoji || '🎯'}
        </span>
        <input
          className="input grow"
          value={title}
          placeholder="Например, Пробежать полумарафон"
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={!goal}
          maxLength={200}
        />
      </div>
      <div className="gl-emojis">
        {GOAL_EMOJIS.map((e) => (
          <button key={e} type="button" className={'gl-emoji' + (emoji === e ? ' active' : '')} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
        <input className="gl-emoji gl-emoji-input" value={GOAL_EMOJIS.includes(emoji) ? '' : emoji} placeholder="✎" aria-label="Свой значок" onChange={(e) => setEmoji(lastGrapheme(e.target.value))} />
      </div>

      <label className="label">Зачем мне это</label>
      <textarea className="textarea gl-why-input" value={why} placeholder="Что изменится, когда я достигну цели? Почему это важно?" onChange={(e) => setWhy(e.target.value)} rows={3} />

      <label className="label">Сфера жизни</label>
      <div className="gl-chips">
        <button type="button" className={'chip' + (!areaId ? ' active' : '')} onClick={() => setAreaId(undefined)}>
          Без сферы
        </button>
        {areas.map((a) => (
          <button
            key={a.id}
            type="button"
            className={'chip gl-area-chip' + (areaId === a.id ? ' active' : '')}
            style={{ '--c': a.color } as CSSProperties}
            onClick={() => setAreaId(a.id)}
          >
            {a.emoji} {a.name}
          </button>
        ))}
      </div>

      <label className="label">Период</label>
      <div className="gl-chips">
        {PERIODS.map((p) => (
          <button key={p.v} type="button" className={'chip' + (period === p.v ? ' active' : '')} onClick={() => pickPeriod(p.v, 0)}>
            {p.label}
          </button>
        ))}
      </div>
      {period !== 'custom' && (
        <div className="segmented gl-shift">
          <button type="button" className={shift === 0 ? 'active' : ''} onClick={() => pickPeriod(period, 0)}>
            {period === 'year' ? 'Этот год' : period === 'quarter' ? 'Этот квартал' : period === 'month' ? 'Этот месяц' : 'Эта неделя'}
          </button>
          <button type="button" className={shift === 1 ? 'active' : ''} onClick={() => pickPeriod(period, 1)}>
            {period === 'year' ? 'Следующий' : period === 'quarter' ? 'Следующий' : period === 'month' ? 'Следующий' : 'Следующая'}
          </button>
        </div>
      )}
      <div className="gl-grid2">
        <div>
          <label className="label">Начало</label>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label">Срок</label>
          <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>

      <label className="label">Важность</label>
      <div className="gl-chips">
        {GOAL_PRIORITIES.map((p) => (
          <button key={p.v} type="button" className={'chip' + (priority === p.v ? ' active' : '')} onClick={() => setPriority(p.v)}>
            {p.v > 0 && <span className={'gl-prio p' + p.v} aria-hidden />}
            {p.label}
          </button>
        ))}
      </div>

      <label className="label">Как считать прогресс</label>
      <div className="gl-modes">
        {MODES.map((m) => (
          <button key={m.v} type="button" className={'gl-mode' + (m.v === 'savings' ? ' is-wide' : '') + (mode === m.v ? ' active' : '')} onClick={() => pickMode(m.v)}>
            <b>{m.label}</b>
            <span className="tiny muted">{m.hint}</span>
          </button>
        ))}
      </div>
      {mode === 'target' && (
        <div className="gl-grid2 gl-target-fields">
          <div>
            <label className="label">Начальное</label>
            <input className="input" inputMode="decimal" value={tf.start} onChange={tfSet('start')} />
          </div>
          <div>
            <label className="label">Цель</label>
            <input className="input" inputMode="decimal" value={tf.target} onChange={tfSet('target')} />
          </div>
          <div>
            <label className="label">Единица</label>
            <input className="input" value={tf.unit} placeholder="книг, км, ₽…" onChange={tfSet('unit')} />
          </div>
          <div>
            <label className="label">Шаг кнопок ±</label>
            <input className="input" inputMode="decimal" value={tf.step} onChange={tfSet('step')} />
          </div>
          {goal && (
            <div>
              <label className="label">Сейчас</label>
              <input className="input" inputMode="decimal" value={tf.current} onChange={tfSet('current')} />
            </div>
          )}
        </div>
      )}
      {mode === 'savings' && <SavingsFields draft={sv} onChange={setSv} prev={sv0} deadline={deadline} title={title} />}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button className="btn btn-primary" onClick={save}>
          {goal ? 'Сохранить' : 'Создать цель'}
        </button>
      </div>
    </Sheet>
  );
}
