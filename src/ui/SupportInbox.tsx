/**
 * Входящие поддержки — только для владельца (сервер пускает адреса из ADMIN_EMAILS).
 *  · Обращения: переписка с пользователем (ответ уходит письмом и виден ему в «Мои обращения»), статус, разбор
 *    (видит только владелец), снимок экрана и сведения для диагностики.
 *  · Ошибки: автоматические отчёты приложения — что падает, сколько раз, в какой версии.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { ArrowClockwise, Image as ImageIcon, PaperPlaneTilt, Stethoscope, Bug } from '@phosphor-icons/react';
import { api, useCloud } from '../store/cloud';
import { toast } from '../store/appStore';
import { confirmDialog } from './dialogs';
import { KIND_ICON, STATUS_LABEL, Thread, when, type Kind, type Msg } from './Support';
import './support.css';

interface InboxItem {
  id: string;
  kind: Kind;
  text: string;
  status: string;
  at: number;
  email: string;
  name: string;
  meta: string;
  hasImage: boolean;
  hasDiag: boolean;
  note: string;
  messages: Msg[];
}

interface ClientError {
  id: string;
  message: string;
  stack: string;
  version: string;
  platform: string;
  view: string;
  count: number;
  firstAt: number;
  lastAt: number;
  status: string;
  note: string;
}

const STATUSES = ['new', 'seen', 'planned', 'answered', 'done', 'rejected'] as const;
const ERROR_STATUS: Record<string, string> = { new: 'Новая', seen: 'Просмотрена', planned: 'В планах', done: 'Исправлена', ignored: 'Не важно' };
const NAMES: Record<Msg['author'], string> = { user: 'Пользователь', support: 'Вы', ai: 'Автоответ ИИ' };

const useInbox = create<{ open: boolean; admin: boolean; checkedFor?: string; openCount?: number }>(() => ({ open: false, admin: false }));
export const openInbox = () => useInbox.setState({ open: true });
const close = () => useInbox.setState({ open: false });

/** Владелец ли этот аккаунт (спрашиваем сервер один раз на вход) и сколько новых обращений */
export function useSupportAdmin(): { admin: boolean; openCount?: number } {
  const token = useCloud((s) => s.account?.token);
  const admin = useInbox((s) => s.admin);
  const openCount = useInbox((s) => s.openCount);
  useEffect(() => {
    if (!token) return void useInbox.setState({ admin: false, checkedFor: undefined, openCount: undefined });
    if (useInbox.getState().checkedFor === token) return;
    api<{ admin?: boolean }>('/auth/me')
      .then(async (r) => {
        useInbox.setState({ admin: !!r.admin, checkedFor: token });
        if (r.admin) {
          const inbox = await api<{ items: InboxItem[] }>('/admin/feedback');
          useInbox.setState({ openCount: inbox.items.filter((x) => x.status === 'new').length });
        }
      })
      .catch(() => {});
  }, [token]);
  return { admin, openCount };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function InboxHost() {
  const open = useInbox((s) => s.open);
  return open ? <InboxSheet /> : null;
}

function InboxSheet() {
  const [tab, setTab] = useState<'feedback' | 'errors'>('feedback');
  const [all, setAll] = useState(false);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [errors, setErrors] = useState<ClientError[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const q = all ? '?status=all' : '';
      if (tab === 'feedback') {
        const r = await api<{ items: InboxItem[]; counts: Record<string, number> }>(`/admin/feedback${q}`);
        setItems(r.items);
        setCounts(r.counts);
        useInbox.setState({ openCount: r.counts.new ?? 0 });
      } else {
        const r = await api<{ items: ClientError[]; counts: Record<string, number> }>(`/admin/errors${q}`);
        setErrors(r.items);
        setCounts(r.counts);
      }
    } catch (e) {
      toast(errText(e));
      if (tab === 'feedback') setItems([]);
      else setErrors([]);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => void load(), [all, tab]);

  const closed = tab === 'feedback' ? ['done', 'rejected'] : ['done', 'ignored'];
  const open = Object.entries(counts).reduce((n, [st, c]) => (closed.includes(st) ? n : n + c), 0);
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  const list = tab === 'feedback' ? items : errors;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal sp-sheet sp-inbox" role="dialog" aria-label="Входящие поддержки">
        <div className="sp-bar">
          <button className="sp-text-btn" onClick={close}>
            Закрыть
          </button>
          <b>Входящие</b>
          <button className="sp-text-btn sp-send" onClick={() => void load()} disabled={busy} aria-label="Обновить">
            <ArrowClockwise size={20} weight="bold" />
          </button>
        </div>

        <div className="segmented sp-seg">
          <button className={tab === 'feedback' ? 'active' : ''} onClick={() => setTab('feedback')}>
            Обращения
          </button>
          <button className={tab === 'errors' ? 'active' : ''} onClick={() => setTab('errors')}>
            <Bug size={16} /> Ошибки
          </button>
        </div>
        <div className="sp-filter">
          <button className={!all ? 'active' : ''} onClick={() => setAll(false)}>
            Открытые · {open}
          </button>
          <button className={all ? 'active' : ''} onClick={() => setAll(true)}>
            Все · {total}
          </button>
        </div>

        {list === null ? (
          <p className="sp-note">Загружаю…</p>
        ) : list.length === 0 ? (
          <p className="sp-note">{tab === 'errors' ? (all ? 'Отчётов об ошибках пока нет' : 'Открытых ошибок нет') : all ? 'Обращений пока нет' : 'Все обращения разобраны'}</p>
        ) : tab === 'feedback' ? (
          items!.map((it) => <InboxCard key={it.id} it={it} onChange={(c) => setItems((l) => l?.map((x) => (x.id === it.id ? { ...x, ...c } : x)) ?? null)} />)
        ) : (
          errors!.map((er) => <ErrorCard key={er.id} er={er} onChange={(c) => setErrors((l) => l?.map((x) => (x.id === er.id ? { ...x, ...c } : x)) ?? null)} />)
        )}
      </div>
    </div>
  );
}

/** Разбор — заметка только для владельца (её же пишет ежедневный разбор Claude) */
function NoteField({ value, onSave }: { value: string; onSave: (note: string) => void }) {
  const [note, setNote] = useState(value);
  return (
    <label className="sp-field">
      <span>Разбор (видите только вы)</span>
      <textarea
        rows={note ? Math.min(8, note.split('\n').length + 1) : 1}
        value={note}
        placeholder="Причина, что сделать, ветка с исправлением…"
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== value && onSave(note)}
      />
    </label>
  );
}

function InboxCard({ it, onChange }: { it: InboxItem; onChange: (c: Partial<InboxItem>) => void }) {
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const Icon = KIND_ICON[it.kind] ?? Bug;

  const save = async (change: { status?: string; note?: string }) => {
    // «Решено» — предложить письмо пользователю (у него обращение сменит статус и без письма)
    const notify =
      change.status === 'done' &&
      it.status !== 'done' &&
      (await confirmDialog('Сообщить пользователю?', `${it.email} получит письмо: «${it.kind === 'idea' ? 'Ваша идея теперь в SuperMind' : 'Проблема исправлена'} — обновите приложение».`, {
        okText: 'Отправить письмо',
        cancelText: 'Без письма',
      }));
    try {
      const r = await api<{ mailed?: boolean }>(`/admin/feedback/${it.id}`, { method: 'PATCH', body: JSON.stringify({ ...change, ...(notify ? { notify } : {}) }) });
      onChange(change);
      if (notify) toast(r.mailed ? 'Письмо отправлено' : 'Статус сохранён, письмо не ушло');
    } catch (e) {
      toast(errText(e));
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      const text = reply.trim();
      const r = await api<{ mailed: boolean }>(`/admin/feedback/${it.id}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
      onChange({ messages: [...it.messages, { author: 'support', text, at: Date.now() }], status: 'answered' });
      setReply('');
      setReplying(false);
      toast(r.mailed ? 'Ответ отправлен на почту' : 'Ответ сохранён — письмо не ушло, пользователь увидит его в приложении');
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const load = async (what: 'image' | 'diag') => {
    try {
      if (what === 'image') setImage((await api<{ image: string }>(`/admin/feedback/${it.id}/image`)).image);
      else setDiag(JSON.stringify((await api<{ diag: unknown }>(`/admin/feedback/${it.id}/diag`)).diag, null, 2));
    } catch (e) {
      toast(errText(e));
    }
  };

  return (
    <div className="sp-card">
      <div className="sp-card-head">
        <span className={`sp-kind ${it.kind}`}>
          <Icon size={16} weight="fill" />
        </span>
        <div className="sp-item-body">
          <div className="sp-card-who">{it.name || it.email}</div>
          <div className="sp-item-meta">
            №{it.id} · {when(it.at)}
            {it.name ? ` · ${it.email}` : ''}
          </div>
        </div>
        <select className={`sp-status ${it.status}`} value={it.status} onChange={(e) => void save({ status: e.target.value })} aria-label="Статус">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="sp-card-text">{it.text}</div>
      {it.meta && <div className="sp-item-meta">{it.meta}</div>}

      <div className="sp-card-links">
        {it.hasImage && !image && (
          <button className="sp-link" onClick={() => void load('image')}>
            <ImageIcon size={16} weight="duotone" /> Снимок экрана
          </button>
        )}
        {it.hasDiag && diag === null && (
          <button className="sp-link" onClick={() => void load('diag')}>
            <Stethoscope size={16} weight="duotone" /> Сведения для диагностики
          </button>
        )}
      </div>
      {image && <img className="sp-card-img" src={`data:image/jpeg;base64,${image}`} alt="Снимок экрана" />}
      {diag !== null && <pre className="sp-pre">{diag}</pre>}

      <Thread messages={it.messages} mine={['support']} names={NAMES} />

      <NoteField value={it.note} onSave={(note) => void save({ note })} />

      {replying ? (
        <div className="sp-field">
          <textarea autoFocus rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Ответ для ${it.email} — уйдёт письмом и появится в приложении`} />
          <div className="sp-card-actions">
            <button className="btn" onClick={() => setReplying(false)} disabled={busy}>
              Отмена
            </button>
            <button className="btn btn-primary" onClick={() => void send()} disabled={busy || reply.trim().length < 2}>
              <PaperPlaneTilt size={16} weight="fill" /> {busy ? 'Отправляю…' : 'Отправить'}
            </button>
          </div>
        </div>
      ) : (
        <button className="sp-link" onClick={() => setReplying(true)}>
          <PaperPlaneTilt size={16} weight="duotone" /> {it.messages.some((m) => m.author === 'support') ? 'Ответить ещё' : 'Ответить'}
        </button>
      )}
    </div>
  );
}

function ErrorCard({ er, onChange }: { er: ClientError; onChange: (c: Partial<ClientError>) => void }) {
  const save = async (change: { status?: string; note?: string }) => {
    try {
      await api(`/admin/errors/${er.id}`, { method: 'PATCH', body: JSON.stringify(change) });
      onChange(change);
    } catch (e) {
      toast(errText(e));
    }
  };
  return (
    <div className="sp-card">
      <div className="sp-card-head">
        <span className="sp-kind problem">
          <Bug size={16} weight="fill" />
        </span>
        <div className="sp-item-body">
          <div className="sp-card-who">
            ×{er.count} · версия {er.version || '?'}
          </div>
          <div className="sp-item-meta">
            {er.platform}
            {er.view ? ` · раздел ${er.view}` : ''} · последняя {when(er.lastAt)}
            {er.firstAt !== er.lastAt ? ` · первая ${when(er.firstAt)}` : ''}
          </div>
        </div>
        <select className={`sp-status ${er.status}`} value={er.status} onChange={(e) => void save({ status: e.target.value })} aria-label="Статус">
          {Object.entries(ERROR_STATUS).map(([s, label]) => (
            <option key={s} value={s}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="sp-card-text sp-mono">{er.message}</div>
      {er.stack && (
        <details>
          <summary className="sp-link">Стек</summary>
          <pre className="sp-pre">{er.stack}</pre>
        </details>
      )}
      <NoteField value={er.note} onSave={(note) => void save({ note })} />
    </div>
  );
}
