import { useMemo, useState, type CSSProperties } from 'react';
import { PencilSimple, Plus, Target } from '@phosphor-icons/react';
import { toast } from '../../store/appStore';
import { t } from '../../i18n/index';
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
  fmtInputNum
} from '../model';
import { setBudget } from '../store';
import { AmountInput, CatIcon, Money, Progress, Sheet, Stepper, useToday } from './common';
import { showOps } from './state';
import { RateWarning } from './RateWarning';

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
      <RateWarning data={data} range={{ from: month, to: monthEnd(month) }} />

      <section className="card fn-panel fn-budget-total">
        <div className="fn-panel-head">
          <h3>
            <Target size={16} /> {t('Бюджет на месяц')}
          </h3>
          <button className="btn btn-sm btn-ghost" onClick={() => setEdit({})}>
            <PencilSimple size={14} /> {tb ? t('Изменить') : t('Задать')}
          </button>
        </div>
        {tb ? (
          <>
            <div className="fn-budget-big">
              <Money v={s.expense} cur={main} />
              <span className="faint"> {t('из {amount}', { amount: fmtMoney(tb.limit, main) })}</span>
            </div>
            <Progress spent={s.expense} limit={tb.limit} />
            <div className="fn-budget-stats">
              <div>
                <span className="tiny faint">{tb.limit >= s.expense ? t('Осталось') : t('Перерасход')}</span>
                <b className={tb.limit < s.expense ? 'fn-neg' : ''}>{fmtMoney(Math.abs(tb.limit - s.expense), main)}</b>
              </div>
              {isCur && (
                <div>
                  <span className="tiny faint">{t('Осталось на день')}</span>
                  <b>{fmtMoney(perDay ?? 0, main)}</b>
                </div>
              )}
              {isCur && (
                <div>
                  <span className="tiny faint">{t('Дней до конца месяца')}</span>
                  <b>{leftDays}</b>
                </div>
              )}
              {isPast && (
                <div>
                  <span className="tiny faint">{t('Итог месяца')}</span>
                  <b className={budgetLevel(s.expense, tb.limit) === 'over' ? 'fn-neg' : 'fn-pos'}>{budgetLevel(s.expense, tb.limit) === 'over' ? t('Бюджет превышен') : t('Уложились')}</b>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="small muted fn-m0">
            {t('Общий лимит расходов на месяц. Потрачено в этом месяце:')} <b>{fmtMoney(s.expense, main)}</b>
          </p>
        )}
      </section>

      <section className="card fn-panel">
        <div className="fn-panel-head">
          <h3>{t('Лимиты по категориям')}</h3>
          <button className="btn btn-sm btn-ghost" onClick={() => setEdit({ pick: true })}>
            <Plus size={14} /> {t('Добавить')}
          </button>
        </div>
        {catBudgets.length === 0 && <p className="small muted fn-m0">{t('Ограничьте траты, например, на кафе или такси — полоса покраснеет при превышении.')}</p>}
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
                {spent > b.limit ? t('Перерасход {amount}', { amount: fmtMoney(spent - b.limit, main) }) : t('Осталось {amount}', { amount: fmtMoney(b.limit - spent, main) })}
                {isCur && spent < b.limit ? t(' · {amount} в день', { amount: fmtMoney(perDayLeft(b.limit, spent, today, month) ?? 0, main) }) : ''}
              </span>
            </span>
          </button>
        ))}
        {tb && sumLimits > tb.limit && <p className="tiny fn-warn-text fn-m0">{t('Сумма лимитов по категориям ({amount}) больше общего бюджета.', { amount: fmtMoney(sumLimits, main) })}</p>}
      </section>

      {noLimit.length > 0 && (
        <section className="card fn-panel">
          <div className="fn-panel-head">
            <h3>{t('Без лимита')}</h3>
          </div>
          {noLimit.map((c) => (
            <div key={c.id} className="fn-nolimit">
              <span>{c.emoji}</span>
              <button className="grow ellipsis fn-link-plain" onClick={() => showOps({ categoryId: c.id, period: isCur ? 'month' : 'custom', from: month, to: monthEnd(month) })}>
                {c.name}
              </button>
              <Money v={s.byCat.get(c.id) ?? 0} cur={main} className="small" />
              <button className="btn btn-sm btn-ghost" onClick={() => setEdit({ categoryId: c.id })}>
                {t('Лимит')}
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
  const [val, setVal] = useState(existing ? fmtInputNum(existing.limit) : '');
  const main = data.prefs.mainCurrency;
  const free = sortedCategories(data, 'expense').filter((c) => c.id === catId || !data.budgets.some((b) => b.categoryId === c.id));
  const cat = data.categories.find((c) => c.id === catId);

  const save = () => {
    const v = parseMoneyInput(val);
    if (!isTotal && !catId) return toast(t('Выберите категорию'));
    if (!(v > 0)) return toast(t('Введите сумму лимита'));
    setBudget(isTotal ? undefined : catId, v);
    onClose();
  };

  return (
    <Sheet
      title={isTotal ? t('Бюджет на месяц') : cat && !edit.pick ? t('Лимит: {name}', { name: cat.name }) : t('Лимит категории')}
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
              {t('Убрать')}
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn btn-primary" onClick={save}>
            {t('Сохранить')}
          </button>
        </>
      }
    >
      {edit.pick && (
        <>
          <label className="label">{t('Категория')}</label>
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
      <label className="label">{t('Лимит в месяц, {cur}', { cur: curSymbol(main) })}</label>
      <AmountInput value={val} onChange={setVal} autoFocus={!edit.pick} onEnter={save} />
      {!isTotal && catId && <p className="tiny faint">{t('Потрачено в выбранном месяце: {amount}', { amount: fmtMoney(spentByCat.get(catId) ?? 0, main) })}</p>}
      {isTotal && <p className="tiny faint">{t('Лимит действует на каждый месяц. Суммы в других валютах пересчитываются по курсам из настроек.')}</p>}
    </Sheet>
  );
}
