import { useMemo, useState, type CSSProperties } from 'react';
import { PencilSimple, Plus, Target } from '@phosphor-icons/react';
import { toast } from '../../store/appStore';
import {
  addMonthsYmd,
  budgetLevel,
  categoryMap,
  curSymbol,
  fmtMoney,
  monthEnd,
  monthKey,
  monthStart,
  monthTitle,
  parseMoneyInput,
  perDayLeft,
  sortedCategories,
  summarize,
  totalBudget,
  type FinanceData,
} from '../model';
import { setBudget } from '../store';
import { AmountInput, CatIcon, Money, Progress, Sheet, Stepper, useToday } from './common';
import { showOps } from './state';

interface Edit {
  categoryId?: string;
  pick?: boolean;
}

export function BudgetTab({ data }: { data: FinanceData }) {
  const today = useToday();
  const [month, setMonth] = useState(monthStart(today));
  const [edit, setEdit] = useState<Edit | null>(null);
  const main = data.prefs.mainCurrency;
  const s = useMemo(() => summarize(data, { from: month, to: monthEnd(month) }), [data, month]);
  const cats = useMemo(() => categoryMap(data), [data]);
  const tb = totalBudget(data);
  const isCur = monthKey(month) === monthKey(today);
  const isPast = month < monthStart(today);

  const catBudgets = data.budgets
    .filter((b) => b.categoryId && cats.has(b.categoryId))
    .map((b) => ({ b, c: cats.get(b.categoryId!)!, spent: s.byCat.get(b.categoryId!) ?? 0 }))
    .sort((x, y) => y.spent / y.b.limit - x.spent / x.b.limit);
  const sumLimits = catBudgets.reduce((a, x) => a + x.b.limit, 0);
  const noLimit = sortedCategories(data, 'expense')
    .filter((c) => !catBudgets.some((x) => x.c.id === c.id) && (s.byCat.get(c.id) ?? 0) > 0)
    .sort((a, b) => (s.byCat.get(b.id) ?? 0) - (s.byCat.get(a.id) ?? 0));

  const perDay = tb ? perDayLeft(tb.limit, s.expense, today, month) : null;
  const leftDays = isCur ? Math.max(1, Number(monthEnd(month).slice(8)) - Number(today.slice(8)) + 1) : 0;

  return (
    <div className="fn-stack">
      <Stepper label={monthTitle(month)} onPrev={() => setMonth(addMonthsYmd(month, -1))} onNext={() => setMonth(addMonthsYmd(month, 1))} onLabel={isCur ? undefined : () => setMonth(monthStart(today))} />

      <section className="card fn-panel fn-budget-total">
        <div className="fn-panel-head">
          <h3>
            <Target size={16} /> Бюджет на месяц
          </h3>
          <button className="btn btn-sm btn-ghost" onClick={() => setEdit({})}>
            <PencilSimple size={14} /> {tb ? 'Изменить' : 'Задать'}
          </button>
        </div>
        {tb ? (
          <>
            <div className="fn-budget-big">
              <Money v={s.expense} cur={main} />
              <span className="faint"> из {fmtMoney(tb.limit, main)}</span>
            </div>
            <Progress spent={s.expense} limit={tb.limit} />
            <div className="fn-budget-stats">
              <div>
                <span className="tiny faint">{tb.limit >= s.expense ? 'Осталось' : 'Перерасход'}</span>
                <b className={tb.limit < s.expense ? 'fn-neg' : ''}>{fmtMoney(Math.abs(tb.limit - s.expense), main)}</b>
              </div>
              {isCur && (
                <div>
                  <span className="tiny faint">Осталось на день</span>
                  <b>{fmtMoney(perDay ?? 0, main)}</b>
                </div>
              )}
              {isCur && (
                <div>
                  <span className="tiny faint">Дней до конца месяца</span>
                  <b>{leftDays}</b>
                </div>
              )}
              {isPast && (
                <div>
                  <span className="tiny faint">Итог месяца</span>
                  <b className={budgetLevel(s.expense, tb.limit) === 'over' ? 'fn-neg' : 'fn-pos'}>{budgetLevel(s.expense, tb.limit) === 'over' ? 'Бюджет превышен' : 'Уложились'}</b>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="small muted fn-m0">
            Общий лимит расходов на месяц. Потрачено в этом месяце: <b>{fmtMoney(s.expense, main)}</b>
          </p>
        )}
      </section>

      <section className="card fn-panel">
        <div className="fn-panel-head">
          <h3>Лимиты по категориям</h3>
          <button className="btn btn-sm btn-ghost" onClick={() => setEdit({ pick: true })}>
            <Plus size={14} /> Добавить
          </button>
        </div>
        {catBudgets.length === 0 && <p className="small muted fn-m0">Ограничьте траты, например, на кафе или такси — полоса покраснеет при превышении.</p>}
        {catBudgets.map(({ b, c, spent }) => (
          <button key={b.id} className="fn-cat-budget" onClick={() => setEdit({ categoryId: c.id })}>
            <CatIcon emoji={c.emoji} color={c.color} size={34} />
            <span className="grow fn-cat-budget-main">
              <span className="row">
                <span className="grow ellipsis fn-tx-title">{c.name}</span>
                <span className="small">
                  <b className={spent > b.limit ? 'fn-neg' : ''}>{fmtMoney(spent, main)}</b>
                  <span className="faint"> / {fmtMoney(b.limit, main)}</span>
                </span>
              </span>
              <Progress spent={spent} limit={b.limit} thin />
              <span className="tiny faint">
                {spent > b.limit ? `Перерасход ${fmtMoney(spent - b.limit, main)}` : `Осталось ${fmtMoney(b.limit - spent, main)}`}
                {isCur && spent < b.limit ? ` · ${fmtMoney(perDayLeft(b.limit, spent, today, month) ?? 0, main)} в день` : ''}
              </span>
            </span>
          </button>
        ))}
        {tb && sumLimits > tb.limit && <p className="tiny fn-warn-text fn-m0">Сумма лимитов по категориям ({fmtMoney(sumLimits, main)}) больше общего бюджета.</p>}
      </section>

      {noLimit.length > 0 && (
        <section className="card fn-panel">
          <div className="fn-panel-head">
            <h3>Без лимита</h3>
          </div>
          {noLimit.map((c) => (
            <div key={c.id} className="fn-nolimit">
              <span>{c.emoji}</span>
              <button className="grow ellipsis fn-link-plain" onClick={() => showOps({ categoryId: c.id, period: isCur ? 'month' : 'custom', from: month, to: monthEnd(month) })}>
                {c.name}
              </button>
              <Money v={s.byCat.get(c.id) ?? 0} cur={main} className="small" />
              <button className="btn btn-sm btn-ghost" onClick={() => setEdit({ categoryId: c.id })}>
                Лимит
              </button>
            </div>
          ))}
        </section>
      )}

      {edit && <BudgetSheet data={data} edit={edit} spentByCat={s.byCat} onClose={() => setEdit(null)} />}
    </div>
  );
}

function BudgetSheet({ data, edit, spentByCat, onClose }: { data: FinanceData; edit: Edit; spentByCat: Map<string, number>; onClose: () => void }) {
  const [catId, setCatId] = useState(edit.categoryId ?? '');
  const isTotal = !edit.pick && !edit.categoryId;
  // в режиме выбора категории без выбранной категории — не общий бюджет (иначе «Убрать» удалит его)
  const existing = isTotal ? data.budgets.find((b) => !b.categoryId) : catId ? data.budgets.find((b) => b.categoryId === catId) : undefined;
  const [val, setVal] = useState(existing ? String(existing.limit).replace('.', ',') : '');
  const main = data.prefs.mainCurrency;
  const free = sortedCategories(data, 'expense').filter((c) => c.id === catId || !data.budgets.some((b) => b.categoryId === c.id));
  const cat = data.categories.find((c) => c.id === catId);

  const save = () => {
    const v = parseMoneyInput(val);
    if (!isTotal && !catId) return toast('Выберите категорию');
    if (!(v > 0)) return toast('Введите сумму лимита');
    setBudget(isTotal ? undefined : catId, v);
    onClose();
  };

  return (
    <Sheet
      title={isTotal ? 'Бюджет на месяц' : cat && !edit.pick ? `Лимит: ${cat.name}` : 'Лимит категории'}
      onClose={onClose}
      actions={
        <>
          {existing && (
            <button
              className="btn btn-ghost btn-danger"
              onClick={() => {
                setBudget(isTotal ? undefined : catId, 0);
                onClose();
              }}
            >
              Убрать
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={save}>
            Сохранить
          </button>
        </>
      }
    >
      {edit.pick && (
        <>
          <label className="label">Категория</label>
          <div className="fn-cat-grid">
            {free.map((c) => (
              <button key={c.id} type="button" className={'fn-cat-cell' + (catId === c.id ? ' active' : '')} style={{ '--c': c.color } as CSSProperties} onClick={() => setCatId(c.id)}>
                <span className="fn-cat-cell-ic">{c.emoji}</span>
                <span className="fn-cat-cell-name">{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <label className="label">Лимит в месяц, {curSymbol(main)}</label>
      <AmountInput value={val} onChange={setVal} autoFocus={!edit.pick} onEnter={save} />
      {!isTotal && catId && <p className="tiny faint">Потрачено в выбранном месяце: {fmtMoney(spentByCat.get(catId) ?? 0, main)}</p>}
      {isTotal && <p className="tiny faint">Лимит действует на каждый месяц. Суммы в других валютах пересчитываются по курсам из настроек.</p>}
    </Sheet>
  );
}
