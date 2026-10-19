/**
 * Поддержка: сообщить о проблеме, предложить идею или задать вопрос. Обращение уходит на сервер (POST /feedback),
 * владелец получает письмо и push и отвечает из «Входящих» (SupportInbox). На вопрос ИИ отвечает сразу по справке.
 * В «Мои обращения» — переписка: ответы поддержки и ИИ, а пользователь может дописать («не помогло», уточнение).
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Bug, Lightbulb, Question, Image as ImageIcon, X, PaperPlaneTilt, CheckCircle, Sparkle } from '@phosphor-icons/react';
import { api, useCloud } from '../store/cloud';
import { APP_VERSION } from '../store/safety';
import { toast } from '../store/appStore';
import { pickFile } from '../io/download';
import { deviceInfo, diagnostics } from './errorReport';
import './support.css';

export type Kind = 'problem' | 'idea' | 'question';
export interface Msg {
  author: 'user' | 'support' | 'ai';
  text: string;
  at: number;
}
interface Item {
  id: string;
  kind: Kind;
  text: string;
  status: string;
  at: number;
  messages: Msg[];
}

/** Статусы обращения — как их видит пользователь (и владелец во «Входящих») */
export const STATUS_LABEL: Record<string, string> = {
  new: 'Получено',
  seen: 'Прочитано',
  planned: 'В планах',
  answered: 'Есть ответ',
  done: 'Решено',
  rejected: 'Не планируется',
};

export const KIND_ICON = { problem: Bug, idea: Lightbulb, question: Question } as const;

const useSupport = create<{ open: Kind | null }>(() => ({ open: null }));
export const openSupport = (kind: Kind = 'problem') => useSupport.setState({ open: kind });
const close = () => useSupport.setState({ open: null });

/** Снимок экрана → JPEG до ~1200px (base64 без префикса) */
async function shrink(file: File): Promise<{ data: string; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, 1200 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const preview = c.toDataURL('image/jpeg', 0.8);
    return { data: preview.split(',')[1], preview };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const when = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Сколько сообщений в обращении пользователь уже видел — чтобы отметить новый ответ */
const SEEN_KEY = 'sm-support-seen';
function seenCount(id: string): number {
  try {
    return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>)[id] ?? 0;
  } catch {
    return 0;
  }
}
function markSeen(id: string, n: number) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
    all[id] = n;
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {
    /* без хранилища — отметка не запомнится */
  }
}

const AUTHOR: Record<Msg['author'], string> = { user: 'Вы', support: 'Поддержка', ai: 'Автоответ ИИ' };

/** Сообщения переписки «пузырями»; you — чьи сообщения справа (у пользователя — свои, у владельца — поддержки) */
export function Thread({ messages, mine, names = AUTHOR }: { messages: Msg[]; mine: Msg['author'][]; names?: Record<Msg['author'], string> }) {
  if (!messages.length) return null;
  return (
    <div className="sp-thread">
      {messages.map((m, i) => (
        <div key={i} className={`sp-msg ${m.author} ${mine.includes(m.author) ? 'mine' : ''}`}>
          <span>
            {m.author === 'ai' && <Sparkle size={12} weight="fill" />} {names[m.author]} · {when(m.at)}
          </span>
          {m.text}
        </div>
      ))}
    </div>
  );
}

export function SupportHost() {
  const open = useSupport((s) => s.open);
  if (!open) return null;
  return <SupportSheet initial={open} />;
}

const PLACEHOLDER: Record<Kind, string> = {
  problem: 'Что случилось? Что вы делали перед этим и что ожидали увидеть?',
  idea: 'Что добавить или улучшить? Как бы вам было удобнее?',
  question: 'Что хотите узнать? Например: как поставить напоминание на каждый день',
};

function SupportSheet({ initial }: { initial: Kind }) {
  const email = useCloud((s) => s.account?.user.email);
  const [kind, setKind] = useState<Kind>(initial);
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ data: string; preview: string } | null>(null);
  const [withInfo, setWithInfo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ id: string; answer?: string } | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<{ items: Item[] }>('/feedback')
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [sent, reload]);

  const attach = async () => {
    const f = await pickFile('image/*');
    if (!f) return;
    try {
      setImage(await shrink(f));
    } catch {
      toast('Не удалось открыть изображение');
    }
  };

  const send = async () => {
    if (text.trim().length < 3) return toast(kind === 'idea' ? 'Опишите идею' : kind === 'question' ? 'Напишите вопрос' : 'Опишите проблему');
    setBusy(true);
    try {
      const diag = withInfo ? await diagnostics().catch(() => undefined) : undefined;
      const r = await api<{ id: string; answer?: string }>('/feedback', {
        method: 'POST',
        body: JSON.stringify({ kind, text: text.trim(), meta: withInfo ? deviceInfo() : `SuperMind ${APP_VERSION}`, image: image?.data, diag }),
      });
      setSent(r);
      setOpenId(r.id);
      setText('');
      setImage(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const title = kind === 'question' ? 'Вопрос' : 'Поддержка';
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="modal sp-sheet" role="dialog" aria-label="Поддержка">
        <div className="sp-bar">
          <button className="sp-text-btn" onClick={close} disabled={busy}>
            {sent ? 'Готово' : 'Отмена'}
          </button>
          <b>{title}</b>
          {sent ? (
            <span className="sp-text-btn" />
          ) : (
            <button className="sp-text-btn sp-send" onClick={() => void send()} disabled={busy || text.trim().length < 3}>
              {busy ? '…' : 'Отправить'}
            </button>
          )}
        </div>

        {sent ? (
          <div className="sp-done">
            {sent.answer ? (
              <>
                <Sparkle size={48} weight="fill" />
                <h3>Ответ на вопрос №{sent.id}</h3>
                <div className="sp-answer">{sent.answer}</div>
                <p>Это автоответ ИИ по справке. Если не помогло — напишите об этом ниже в обращении, ответит человек.</p>
              </>
            ) : (
              <>
                <CheckCircle size={64} weight="fill" />
                <h3>Спасибо! Обращение №{sent.id}</h3>
                <p>Мы прочитаем его и ответим на {email ?? 'вашу почту'} — ответ появится и здесь, в «Мои обращения».</p>
              </>
            )}
            <button className="btn" onClick={() => setSent(null)}>
              Написать ещё
            </button>
          </div>
        ) : (
          <>
            <div className="segmented sp-seg">
              {(['problem', 'idea', 'question'] as const).map((k) => {
                const Icon = KIND_ICON[k];
                return (
                  <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
                    <Icon size={16} weight={kind === k ? 'fill' : 'regular'} /> {k === 'problem' ? 'Проблема' : k === 'idea' ? 'Идея' : 'Вопрос'}
                  </button>
                );
              })}
            </div>

            <textarea className="sp-text" autoFocus rows={6} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER[kind]} />

            {image ? (
              <div className="sp-shot">
                <img src={image.preview} alt="Снимок экрана" />
                <button className="sp-shot-x" onClick={() => setImage(null)} aria-label="Убрать снимок">
                  <X size={16} weight="bold" />
                </button>
              </div>
            ) : (
              <button className="sp-attach" onClick={() => void attach()}>
                <ImageIcon size={20} weight="duotone" /> Прикрепить снимок экрана
              </button>
            )}

            <label className="sp-check">
              <input type="checkbox" checked={withInfo} onChange={(e) => setWithInfo(e.target.checked)} />
              <span>
                Добавить сведения для диагностики
                <small>
                  {deviceInfo()} · последние ошибки приложения и состояние синхронизации. Ваши заметки, задачи и другие данные не отправляются.
                </small>
              </span>
            </label>

            <button className="btn btn-primary sp-big" onClick={() => void send()} disabled={busy || text.trim().length < 3}>
              <PaperPlaneTilt size={18} weight="fill" /> {busy ? 'Отправляю…' : 'Отправить'}
            </button>
            <p className="sp-note">{kind === 'question' ? 'На частые вопросы ИИ ответит сразу, на остальные — человек.' : `Ответ придёт на ${email ?? 'почту аккаунта'} и появится здесь.`}</p>
          </>
        )}

        {!!items?.length && (
          <div className="sp-history">
            <h4>Мои обращения</h4>
            {items.slice(0, 10).map((it) => (
              <HistoryItem key={it.id} it={it} open={openId === it.id} onToggle={() => setOpenId(openId === it.id ? null : it.id)} onSent={() => setReload((n) => n + 1)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryItem({ it, open, onToggle, onSent }: { it: Item; open: boolean; onToggle: () => void; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const Icon = KIND_ICON[it.kind] ?? Bug;
  const last = it.messages.at(-1);
  const answered = !!last && last.author !== 'user';
  const fresh = answered && it.messages.length > seenCount(it.id);
  useEffect(() => {
    if (open) markSeen(it.id, it.messages.length);
  }, [open, it.id, it.messages.length]);

  const send = async () => {
    setBusy(true);
    try {
      await api(`/feedback/${it.id}/messages`, { method: 'POST', body: JSON.stringify({ text: text.trim() }) });
      setText('');
      onSent();
      toast('Отправлено — ответим здесь и на почту');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp-item">
      <span className={`sp-kind ${it.kind}`}>
        <Icon size={16} weight="fill" />
      </span>
      <div className="sp-item-body">
        <button className="sp-item-head" onClick={onToggle} aria-expanded={open}>
          <div className={`sp-item-text ${open ? 'full' : ''}`}>{it.text}</div>
          <div className="sp-item-meta">
            №{it.id} · {when(it.at)} · {STATUS_LABEL[it.status] ?? 'Получено'}
            {it.messages.length ? ` · сообщений: ${it.messages.length}` : ''}
            {fresh && !open && <b className="sp-dot"> · новый ответ</b>}
          </div>
        </button>
        {open && (
          <>
            <Thread messages={it.messages} mine={['user']} />
            {it.status !== 'rejected' && (
              <div className="sp-compose">
                <textarea rows={2} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} placeholder={answered ? 'Не помогло? Напишите, что не так' : 'Дополнить обращение'} />
                <button className="btn btn-primary" onClick={() => void send()} disabled={busy || text.trim().length < 2} aria-label="Отправить">
                  <PaperPlaneTilt size={16} weight="fill" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
