import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, Plus } from '@phosphor-icons/react';
import { uid } from '../../utils/tree';
import { toast } from '../../store/appStore';
import { confirmDialog } from '../../ui/dialogs';
import { balances, COLORS, fmtMoney, parseMoneyInput, r2, sortedAccounts, sortedCategories, type Account, type Category, type CatKind, type FinanceData, fmtInputNum } from '../model';
import { deleteAccount, deleteCategory, moveAccount, moveCategory, saveAccount, saveCategory } from '../store';
import { AmountInput, CatIcon, ColorDots, CurrencySelect, EmojiPicker, Money, Sheet } from './common';
import { showOps } from './state';
import { ensureGoals, useGoals } from '../../goals/store';
import { savingsByAccount } from '../../goals/savings';
import { t, tn } from '../../i18n/index';

// ================= Счета =================

export function AccountsSection({ data }: { data: FinanceData }) {
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const bal = useMemo(() => balances(data), [data]);
  const list = sortedAccounts(data, true);
  // счета-копилки целей
  const goals = useGoals((s) => s.data);
  useEffect(() => void ensureGoals().catch(() => undefined), []);
  const piggy = useMemo(() => savingsByAccount(goals, data), [goals, data]);
  return (
    <div className="fn-stack">
      <div className="card fn-list">
        {list.map((a, i) => (
          <div key={a.id} className={'fn-item' + (a.archived ? ' is-archived' : '')}>
            <button className="fn-item-main" onClick={() => setEdit(a)}>
              <CatIcon emoji={a.emoji} color={a.color} />
              <span className="grow fn-tx-main">
                <span className="fn-tx-title ellipsis">{a.name}</span>
                <span className="fn-tx-sub">
                  {a.currency}
                  {a.archived ? t(' · в архиве') : ''}
                  {piggy.has(a.id) ? t(' · цель «{title}»: {pct}%', { title: piggy.get(a.id)!.title, pct: piggy.get(a.id)!.pct }) : ''}
                </span>
              </span>
              <Money v={bal.get(a.id) ?? 0} cur={a.currency} className={(bal.get(a.id) ?? 0) < 0 ? 'is-neg' : ''} />
            </button>
            <div className="fn-reorder">
              <button className="icon-btn" disabled={i === 0} onClick={() => moveAccount(a.id, -1)} aria-label={t('Выше')}>
                <ArrowUp />
              </button>
              <button className="icon-btn" disabled={i === list.length - 1} onClick={() => moveAccount(a.id, 1)} aria-label={t('Ниже')}>
                <ArrowDown />
              </button>
            </div>
          </div>
        ))}
        {!list.length && <p className="muted small fn-pad">{t('Счетов пока нет.')}</p>}
      </div>
      <button className="btn btn-primary fn-self-start" onClick={() => setEdit('new')}>
        <Plus size={16} /> {t('Новый счёт')}
      </button>
      {edit && <AccountSheet data={data} acc={edit === 'new' ? null : edit} balance={edit === 'new' ? 0 : (bal.get(edit.id) ?? 0)} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AccountSheet({ data, acc, balance, onClose }: { data: FinanceData; acc: Account | null; balance: number; onClose: () => void }) {
  const [name, setName] = useState(acc?.name ?? '');
  const [emoji, setEmoji] = useState(acc?.emoji ?? '💳');
  const [color, setColor] = useState(acc?.color ?? COLORS[data.accounts.length % COLORS.length]);
  const [currency, setCurrency] = useState(acc?.currency ?? data.prefs.mainCurrency);
  // пользователь вводит текущий остаток, начальный пересчитывается
  const [bal, setBal] = useState(fmtInputNum(acc ? balance : 0));
  const [archived, setArchived] = useState(!!acc?.archived);
  const count = acc ? data.transactions.filter((t) => t.accountId === acc.id || t.toAccountId === acc.id).length : 0;

  const save = () => {
    if (!name.trim()) return toast(t('Введите название счёта'));
    const b = parseMoneyInput(bal || '0');
    if (!Number.isFinite(b)) return toast(t('Проверьте остаток'));
    const initial = r2((acc?.initial ?? 0) + (b - balance));
    saveAccount({ id: acc?.id ?? uid(), name: name.trim(), emoji: emoji || '💳', color, currency, initial, archived: archived || undefined });
    onClose();
  };

  const remove = async () => {
    if (!acc) return;
    const ok = await confirmDialog(
      t('Удалить счёт «{name}»?', { name: acc.name }),
      count
        ? t('Вместе с ним удалятся {n} {ops}. Чтобы сохранить историю, лучше переместите счёт в архив.', { n: count, ops: tn(count, 'операция', 'операции', 'операций') })
        : undefined,
      { okText: t('Удалить'), danger: true },
    );
    if (!ok) return;
    deleteAccount(acc.id);
    onClose();
  };

  return (
    <Sheet
      title={acc ? t('Счёт') : t('Новый счёт')}
      onClose={onClose}
      actions={
        <>
          {acc && (
            <button className="btn btn-ghost btn-danger" onClick={() => void remove()}>
              {t('Удалить')}
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
      <label className="label">{t('Название')}</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Например: Kaspi Gold')} autoFocus={!acc} />
      <div className="fn-grid2">
        <div>
          <label className="label">{t('Валюта')}</label>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <div>
          <label className="label">{t('Текущий остаток')}</label>
          <AmountInput value={bal} onChange={setBal} onEnter={save} />
        </div>
      </div>
      {acc && count > 0 && <p className="tiny faint">{t('Операций по счёту: {count}. Изменение остатка поправит начальный баланс ({initial}).', { count, initial: fmtMoney(acc.initial, acc.currency) })}</p>}
      <label className="label">{t('Значок')}</label>
      <EmojiPicker value={emoji} onChange={setEmoji} />
      <label className="label">{t('Цвет')}</label>
      <ColorDots value={color} onChange={setColor} />
      {acc && (
        <>
          <label className="row fn-check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            <span>{t('В архиве (не учитывается в общем балансе)')}</span>
          </label>
          {count > 0 && (
            <button
              className="fn-link small"
              onClick={() => {
                onClose();
                showOps({ accountId: acc.id });
              }}
            >
              {t('Показать операции по счёту')}
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}

// ================= Категории =================

export function CategoriesSection({ data }: { data: FinanceData }) {
  const [kind, setKind] = useState<CatKind>('expense');
  const [edit, setEdit] = useState<Category | 'new' | null>(null);
  const list = sortedCategories(data, kind);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data.transactions) if (t.categoryId) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
    return m;
  }, [data.transactions]);
  return (
    <div className="fn-stack">
      <div className="segmented fn-seg-wide">
        <button className={kind === 'expense' ? 'active' : ''} onClick={() => setKind('expense')}>
          {t('Расходы')}
        </button>
        <button className={kind === 'income' ? 'active' : ''} onClick={() => setKind('income')}>
          {t('Доходы')}
        </button>
      </div>
      <div className="card fn-list">
        {list.map((c, i) => (
          <div key={c.id} className="fn-item">
            <button className="fn-item-main" onClick={() => setEdit(c)}>
              <CatIcon emoji={c.emoji} color={c.color} size={32} />
              <span className="grow ellipsis fn-tx-title">{c.name}</span>
              <span className="tiny faint">{usage.get(c.id) ?? 0}</span>
            </button>
            <div className="fn-reorder">
              <button className="icon-btn" disabled={i === 0} onClick={() => moveCategory(c.id, -1)} aria-label={t('Выше')}>
                <ArrowUp />
              </button>
              <button className="icon-btn" disabled={i === list.length - 1} onClick={() => moveCategory(c.id, 1)} aria-label={t('Ниже')}>
                <ArrowDown />
              </button>
            </div>
          </div>
        ))}
        {!list.length && <p className="muted small fn-pad">{t('Категорий нет.')}</p>}
      </div>
      <button className="btn btn-primary fn-self-start" onClick={() => setEdit('new')}>
        <Plus size={16} /> {t('Новая категория')}
      </button>
      {edit && <CategorySheet kind={kind} cat={edit === 'new' ? null : edit} used={edit === 'new' ? 0 : (usage.get(edit.id) ?? 0)} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CategorySheet({ kind, cat, used, onClose }: { kind: CatKind; cat: Category | null; used: number; onClose: () => void }) {
  const [name, setName] = useState(cat?.name ?? '');
  const [emoji, setEmoji] = useState(cat?.emoji ?? '📦');
  const [color, setColor] = useState(cat?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)]);

  const save = () => {
    if (!name.trim()) return toast(t('Введите название'));
    saveCategory({ id: cat?.id ?? uid(), name: name.trim(), emoji: emoji || '📦', color, kind: cat?.kind ?? kind });
    onClose();
  };
  const remove = async () => {
    if (!cat) return;
    const ok = await confirmDialog(
      t('Удалить категорию «{name}»?', { name: cat.name }),
      used ? t('{n} {ops} останутся без категории.', { n: used, ops: tn(used, 'операция', 'операции', 'операций') }) : undefined,
      { okText: t('Удалить'), danger: true },
    );
    if (!ok) return;
    deleteCategory(cat.id);
    onClose();
  };

  return (
    <Sheet
      title={cat ? t('Категория') : kind === 'income' ? t('Новая категория дохода') : t('Новая категория расхода')}
      onClose={onClose}
      actions={
        <>
          {cat && (
            <button className="btn btn-ghost btn-danger" onClick={() => void remove()}>
              {t('Удалить')}
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
      <div className="row fn-cat-preview" style={{ '--c': color } as CSSProperties}>
        <CatIcon emoji={emoji || '📦'} color={color} size={44} />
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Название')} autoFocus={!cat} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </div>
      <label className="label">{t('Значок')}</label>
      <EmojiPicker value={emoji} onChange={setEmoji} />
      <label className="label">{t('Цвет')}</label>
      <ColorDots value={color} onChange={setColor} />
    </Sheet>
  );
}
