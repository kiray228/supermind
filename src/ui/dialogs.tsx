import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

interface DialogReq {
  kind: 'prompt' | 'confirm' | 'password';
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  okText?: string;
  danger?: boolean;
  multiline?: boolean;
  resolve: (v: string | boolean | null) => void;
}

const useDialogs = create<{ queue: DialogReq[] }>(() => ({ queue: [] }));

function push(req: Omit<DialogReq, 'resolve'>): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    useDialogs.setState((s) => ({ queue: [...s.queue, { ...req, resolve }] }));
  });
}

/** Запросить строку у пользователя. null — отмена */
export function askText(
  title: string,
  opts: { value?: string; placeholder?: string; message?: string; okText?: string; multiline?: boolean } = {},
): Promise<string | null> {
  return push({ kind: 'prompt', title, ...opts }) as Promise<string | null>;
}

export function askPassword(title: string, message?: string): Promise<string | null> {
  return push({ kind: 'password', title, message, okText: 'Открыть' }) as Promise<string | null>;
}

export function confirmDialog(title: string, message?: string, opts: { okText?: string; danger?: boolean } = {}): Promise<boolean> {
  return push({ kind: 'confirm', title, message, ...opts }).then((v) => v === true);
}

const OVERLAYS = '.modal-backdrop, .menu-layer, .kb-menu-backdrop';

/** Есть ли открытое окно/меню поверх экрана */
export function hasOverlay(): boolean {
  return !!document.querySelector(OVERLAYS);
}

/** Закрыть верхнее окно/меню (как нажатие на затемнение). true — если что-то закрыли */
export function closeTopOverlay(): boolean {
  const all = document.querySelectorAll<HTMLElement>(OVERLAYS);
  const top = all[all.length - 1];
  if (!top) return false;
  top.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  return true;
}

/** Обработчики «назад» (кнопка Android, Escape): последний зарегистрированный — первый */
const backHandlers: (() => boolean)[] = [];
export function onBack(fn: () => boolean): () => void {
  backHandlers.push(fn);
  return () => {
    const i = backHandlers.lastIndexOf(fn);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}
export function runBack(): boolean {
  if (closeTopOverlay()) return true;
  for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return true;
  return false;
}

export function DialogHost() {
  const queue = useDialogs((s) => s.queue);
  const req = queue[0];
  if (!req) return null;
  return <Dialog key={queue.length + req.title} req={req} />;
}

function Dialog({ req }: { req: DialogReq }) {
  const [value, setValue] = useState(req.value ?? '');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setTimeout(() => {
      if (req.kind === 'confirm') okRef.current?.focus();
      else {
        ref.current?.focus();
        ref.current?.select();
      }
    }, 30);
  }, [req.kind]);
  const done = (v: string | boolean | null) => {
    useDialogs.setState((s) => ({ queue: s.queue.slice(1) }));
    req.resolve(v);
  };
  const ok = () => done(req.kind === 'confirm' ? true : value);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && done(req.kind === 'confirm' ? false : null)}>
      <div className="modal" style={{ width: 'min(420px,100%)' }} onKeyDown={(e) => e.key === 'Escape' && done(req.kind === 'confirm' ? false : null)}>
        <h2>{req.title}</h2>
        {req.message && <p className="muted" style={{ margin: '6px 0 0' }}>{req.message}</p>}
        {req.kind !== 'confirm' && (
          <div style={{ marginTop: 14 }}>
            {req.multiline ? (
              <textarea ref={ref} className="textarea" value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} rows={5} />
            ) : (
              <input
                ref={ref}
                className="input"
                type={req.kind === 'password' ? 'password' : 'text'}
                autoComplete={req.kind === 'password' ? 'off' : undefined}
                value={value}
                placeholder={req.placeholder ?? (req.kind === 'password' ? 'Пароль' : '')}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ok()}
              />
            )}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => done(req.kind === 'confirm' ? false : null)}>
            Отмена
          </button>
          <button ref={okRef} className="btn btn-primary" style={req.danger ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : undefined} onClick={ok}>
            {req.okText ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
