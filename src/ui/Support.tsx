/**
 * Поддержка: сообщить о проблеме или предложить идею. Обращение уходит на сервер (POST /feedback),
 * владелец получает письмо и отвечает пользователю на email аккаунта.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Bug, Lightbulb, Image as ImageIcon, X, PaperPlaneTilt, CheckCircle } from '@phosphor-icons/react';
import { api, useCloud } from '../store/cloud';
import { APP_VERSION } from '../store/safety';
import { toast } from '../store/appStore';
import { pickFile } from '../io/download';
import { isNative } from '../platform';
import './support.css';

type Kind = 'problem' | 'idea';
interface Item {
  id: string;
  kind: Kind;
  text: string;
  status: string;
  at: number;
}

const useSupport = create<{ open: Kind | null }>(() => ({ open: null }));
export const openSupport = (kind: Kind = 'problem') => useSupport.setState({ open: kind });
const close = () => useSupport.setState({ open: null });

/** Сведения для разбора проблемы — без личных данных */
function deviceInfo(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : 'другая ОС';
  const app = isNative() ? 'приложение' : window.matchMedia('(display-mode: standalone)').matches ? 'PWA' : 'браузер';
  return `SuperMind ${APP_VERSION} · ${os} · ${app} · экран ${screen.width}×${screen.height} · ${navigator.language}`;
}

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

const when = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function SupportHost() {
  const open = useSupport((s) => s.open);
  if (!open) return null;
  return <SupportSheet initial={open} />;
}

function SupportSheet({ initial }: { initial: Kind }) {
  const email = useCloud((s) => s.account?.user.email);
  const [kind, setKind] = useState<Kind>(initial);
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ data: string; preview: string } | null>(null);
  const [withInfo, setWithInfo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    api<{ items: Item[] }>('/feedback')
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [sent]);

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
    if (text.trim().length < 3) return toast(kind === 'idea' ? 'Опишите идею' : 'Опишите проблему');
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/feedback', {
        method: 'POST',
        body: JSON.stringify({ kind, text: text.trim(), meta: withInfo ? deviceInfo() : `SuperMind ${APP_VERSION}`, image: image?.data }),
      });
      setSent(r.id);
      setText('');
      setImage(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="modal sp-sheet" role="dialog" aria-label="Поддержка">
        <div className="sp-bar">
          <button className="sp-text-btn" onClick={close} disabled={busy}>
            {sent ? 'Готово' : 'Отмена'}
          </button>
          <b>Поддержка</b>
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
            <CheckCircle size={64} weight="fill" />
            <h3>Спасибо! Обращение №{sent}</h3>
            <p>Мы прочитаем его и ответим на {email ?? 'вашу почту'}.</p>
            <button className="btn" onClick={() => setSent(null)}>
              Написать ещё
            </button>
          </div>
        ) : (
          <>
            <div className="segmented sp-seg">
              <button className={kind === 'problem' ? 'active' : ''} onClick={() => setKind('problem')}>
                <Bug size={16} weight={kind === 'problem' ? 'fill' : 'regular'} /> Проблема
              </button>
              <button className={kind === 'idea' ? 'active' : ''} onClick={() => setKind('idea')}>
                <Lightbulb size={16} weight={kind === 'idea' ? 'fill' : 'regular'} /> Идея
              </button>
            </div>

            <textarea
              className="sp-text"
              autoFocus
              rows={6}
              maxLength={5000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                kind === 'problem'
                  ? 'Что случилось? Что вы делали перед этим и что ожидали увидеть?'
                  : 'Что добавить или улучшить? Как бы вам было удобнее?'
              }
            />

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
                Добавить сведения об устройстве
                <small>{deviceInfo()}</small>
              </span>
            </label>

            <button className="btn btn-primary sp-big" onClick={() => void send()} disabled={busy || text.trim().length < 3}>
              <PaperPlaneTilt size={18} weight="fill" /> {busy ? 'Отправляю…' : 'Отправить'}
            </button>
            <p className="sp-note">Ответ придёт на {email ?? 'почту аккаунта'}.</p>
          </>
        )}

        {!!items?.length && (
          <div className="sp-history">
            <h4>Мои обращения</h4>
            {items.slice(0, 10).map((it) => (
              <div key={it.id} className="sp-item">
                <span className={`sp-kind ${it.kind}`}>{it.kind === 'idea' ? <Lightbulb size={16} weight="fill" /> : <Bug size={16} weight="fill" />}</span>
                <div className="sp-item-body">
                  <div className="sp-item-text">{it.text}</div>
                  <div className="sp-item-meta">
                    №{it.id} · {when(it.at)} · {it.status === 'done' ? 'Решено' : it.status === 'answered' ? 'Есть ответ' : 'Получено'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
