/**
 * Входящие поддержки — только для владельца (сервер пускает адреса из ADMIN_EMAILS).
 * Все обращения пользователей: статус, разбор (видит только владелец) и ответ — он уходит письмом
 * и виден пользователю в «Мои обращения».
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Bug, Lightbulb, ArrowClockwise, Image as ImageIcon, PaperPlaneTilt } from '@phosphor-icons/react';
import { api, useCloud } from '../store/cloud';
import { toast } from '../store/appStore';
import { STATUS_LABEL } from './Support';
import './support.css';

interface InboxItem {
  id: string;
  kind: 'problem' | 'idea';
  text: string;
  status: string;
  at: number;
  email: string;
  name: string;
  meta: string;
  hasImage: boolean;
  reply: string;
  repliedAt: number | null;
  note: string;
}

const STATUSES = ['new', 'seen', 'planned', 'answered', 'done', 'rejected'] as const;

const useInbox = create<{ open: boolean; admin: boolean; checkedFor?: string; openCount?: number }>(() => ({ open: false, admin: false }));
export const openInbox = () => useInbox.setState({ open: true });
const close = () => useInbox.setState({ open: false });

/** Владелец ли этот аккаунт (спрашиваем сервер один раз на вход) и сколько открытых обращений */
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

const when = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function InboxHost() {
  const open = useInbox((s) => s.open);
  return open ? <InboxSheet /> : null;
}

function InboxSheet() {
  const [all, setAll] = useState(false);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const r = await api<{ items: InboxItem[]; counts: Record<string, number> }>(`/admin/feedback${all ? '?status=all' : ''}`);
      setItems(r.items);
      setCounts(r.counts);
      useInbox.setState({ openCount: r.counts.new ?? 0 });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => void load(), [all]);

  const patch = (id: string, change: Partial<InboxItem>) => setItems((list) => list?.map((x) => (x.id === id ? { ...x, ...change } : x)) ?? null);
  const open = Object.entries(counts).reduce((n, [st, c]) => (st === 'done' || st === 'rejected' ? n : n + c), 0);
  const total = Object.values(counts).reduce((n, c) => n + c, 0);

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
          <button className={!all ? 'active' : ''} onClick={() => setAll(false)}>
            Открытые · {open}
          </button>
          <button className={all ? 'active' : ''} onClick={() => setAll(true)}>
            Все · {total}
          </button>
        </div>

        {items === null ? (
          <p className="sp-note">Загружаю…</p>
        ) : items.length === 0 ? (
          <p className="sp-note">{all ? 'Обращений пока нет' : 'Все обращения разобраны'}</p>
        ) : (
          items.map((it) => <InboxCard key={it.id} it={it} onChange={(c) => patch(it.id, c)} />)
        )}
      </div>
    </div>
  );
}

function InboxCard({ it, onChange }: { it: InboxItem; onChange: (c: Partial<InboxItem>) => void }) {
  const [note, setNote] = useState(it.note);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (change: { status?: string; note?: string }) => {
    try {
      await api(`/admin/feedback/${it.id}`, { method: 'PATCH', body: JSON.stringify(change) });
      onChange(change);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ mailed: boolean }>(`/admin/feedback/${it.id}/reply`, { method: 'POST', body: JSON.stringify({ text: reply.trim() }) });
      onChange({ reply: reply.trim(), repliedAt: Date.now(), status: 'answered' });
      setReply('');
      setReplying(false);
      toast(r.mailed ? 'Ответ отправлен на почту' : 'Ответ сохранён — письмо не ушло, пользователь увидит его в приложении');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const showImage = async () => {
    try {
      setImage((await api<{ image: string }>(`/admin/feedback/${it.id}/image`)).image);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="sp-card">
      <div className="sp-card-head">
        <span className={`sp-kind ${it.kind}`}>{it.kind === 'idea' ? <Lightbulb size={16} weight="fill" /> : <Bug size={16} weight="fill" />}</span>
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

      {it.hasImage &&
        (image ? (
          <img className="sp-card-img" src={`data:image/jpeg;base64,${image}`} alt="Снимок экрана" />
        ) : (
          <button className="sp-link" onClick={() => void showImage()}>
            <ImageIcon size={16} weight="duotone" /> Показать снимок
          </button>
        ))}

      <label className="sp-field">
        <span>Разбор (видите только вы)</span>
        <textarea
          rows={note ? 3 : 1}
          value={note}
          placeholder="Причина, что сделать, ветка с исправлением…"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== it.note && void save({ note })}
        />
      </label>

      {it.reply && (
        <div className="sp-reply">
          <span>Ваш ответ · {it.repliedAt ? when(it.repliedAt) : ''}</span>
          {it.reply}
        </div>
      )}

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
          <PaperPlaneTilt size={16} weight="duotone" /> {it.reply ? 'Ответить ещё' : 'Ответить'}
        </button>
      )}
    </div>
  );
}
