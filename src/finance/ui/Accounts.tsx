import { useMemo, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, Plus } from '@phosphor-icons/react';
import { uid } from '../../utils/tree';
import { toast } from '../../store/appStore';
import { confirmDialog } from '../../ui/dialogs';
import { balances, COLORS, fmtMoney, parseMoneyInput, r2, sortedAccounts, sortedCategories, type Account, type Category, type CatKind, type FinanceData } from '../model';
import { deleteAccount, deleteCategory, moveAccount, moveCategory, saveAccount, saveCategory } from '../store';
import { AmountInput, CatIcon, ColorDots, CurrencySelect, EmojiPicker, Money, Sheet } from './common';
import { showOps } from './state';

// ================= Счета =================

export function AccountsSection({ data }: { data: FinanceData }) {
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const bal = useMemo(() => balances(data), [data]);
  const list = sortedAccounts(data, true);
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
                  {a.archived ? ' · в архиве' : ''}
                </span>
              </span>
              <Money v={bal.get(a.id) ?? 0} cur={a.currency} className={(bal.get(a.id) ?? 0) < 0 ? 'is-neg' : ''} />
            </button>
            <div className="fn-reorder">
              <button className="icon-btn" disabled={i === 0} onClick={() => moveAccount(a.id, -1)} aria-label="Выше">
                <ArrowUp />
              </button>
              <button className="icon-btn" disabled={i === list.length - 1} onClick={() => moveAccount(a.id, 1)} aria-label="Ниже">
                <ArrowDown />
              </button>
            </div>
          </div>
        ))}
        {!list.length && <p className="muted small fn-pad">Счетов пока нет.</p>}
      </div>
      <button className="btn btn-primary fn-self-start" onClick={() => setEdit('new')}>
        <Plus size={16} /> Новый счёт
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
  const [bal, setBal] = useState(String(acc ? balance : 0).replace('.', ','));
  const [archived, setArchived] = useState(!!acc?.archived);
  const count = acc ? data.transactions.filter((t) => t.accountId === acc.id || t.toAccountId === acc.id).length : 0;

  const save = () => {
    if (!name.trim()) return toast('Введите название счёта');
    const b = parseMoneyInput(bal || '0');
    if (!Number.isFinite(b)) return toast('Проверьте остаток');
    const initial = r2((acc?.initial ?? 0) + (b - balance));
    saveAccount({ id: acc?.id ?? uid(), name: name.trim(), emoji: emoji || '💳', color, currency, initial, archived: archived || undefined });
    onClose();
  };

  const remove = async () => {
    if (!acc) return;
    const ok = await confirmDialog(
      `Удалить счёт «${acc.name}»?`,
      count ? `Вместе с ним удалятся ${count} операций. Чтобы сохранить историю, лучше переместите счёт в архив.` : undefined,
      { okText: 'Удалить', danger: true },
    );
    if (!ok) return;
    deleteAccount(acc.id);
    onClose();
  };

  return (
    <Sheet
      title={acc ? 'Счёт' : 'Новый счёт'}
      onClose={onClose}
      actions={
        <>
          {acc && (
            <button className="btn btn-ghost btn-danger" onClick={() => void remove()}>
              Удалить
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
      <label className="label">Название</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Kaspi Gold" autoFocus={!acc} />
      <div className="fn-grid2">
        <div>
          <label className="label">Валюта</label>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <div>
          <label className="label">Текущий остаток</label>
          <AmountInput value={bal} onChange={setBal} onEnter={save} />
        </div>
      </div>
      {acc && count > 0 && <p className="tiny faint">Операций по счёту: {count}. Изменение остатка поправит начальный баланс ({fmtMoney(acc.initial, acc.currency)}).</p>}
      <label className="label">Значок</label>
      <EmojiPicker value={emoji} onChange={setEmoji} />
      <label className="label">Цвет</label>
      <ColorDots value={color} onChange={setColor} />
      {acc && (
        <>
          <label className="row fn-check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            <span>В архиве (не учитывается в общем балансе)</span>
          </label>
          {count > 0 && (
            <button
              className="fn-link small"
              onClick={() => {
                onClose();
                showOps({ accountId: acc.id });
              }}
            >
              Показать операции по счёту
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
          Расходы
        </button>
        <button className={kind === 'income' ? 'active' : ''} onClick={() => setKind('income')}>
          Доходы
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
              <button className="icon-btn" disabled={i === 0} onClick={() => moveCategory(c.id, -1)} aria-label="Выше">
                <ArrowUp />
              </button>
              <button className="icon-btn" disabled={i === list.length - 1} onClick={() => moveCategory(c.id, 1)} aria-label="Ниже">
                <ArrowDown />
              </button>
            </div>
          </div>
        ))}
        {!list.length && <p className="muted small fn-pad">Категорий нет.</p>}
      </div>
      <button className="btn btn-primary fn-self-start" onClick={() => setEdit('new')}>
        <Plus size={16} /> Новая категория
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
    if (!name.trim()) return toast('Введите название');
    saveCategory({ id: cat?.id ?? uid(), name: name.trim(), emoji: emoji || '📦', color, kind: cat?.kind ?? kind });
    onClose();
  };
  const remove = async () => {
    if (!cat) return;
    const ok = await confirmDialog(`Удалить категорию «${cat.name}»?`, used ? `${used} операций останутся без категории.` : undefined, { okText: 'Удалить', danger: true });
    if (!ok) return;
    deleteCategory(cat.id);
    onClose();
  };

  return (
    <Sheet
      title={cat ? 'Категория' : kind === 'income' ? 'Новая категория дохода' : 'Новая категория расхода'}
      onClose={onClose}
      actions={
        <>
          {cat && (
            <button className="btn btn-ghost btn-danger" onClick={() => void remove()}>
              Удалить
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
      <div className="row fn-cat-preview" style={{ '--c': color } as CSSProperties}>
        <CatIcon emoji={emoji || '📦'} color={color} size={44} />
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" autoFocus={!cat} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </div>
      <label className="label">Значок</label>
      <EmojiPicker value={emoji} onChange={setEmoji} />
      <label className="label">Цвет</label>
      <ColorDots value={color} onChange={setColor} />
    </Sheet>
  );
}
