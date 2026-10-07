import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import './dialogs.css';

interface DialogReq {
  kind: 'prompt' | 'confirm' | 'password';
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  okText?: string;
  cancelText?: string;
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

export function confirmDialog(title: string, message?: string, opts: { okText?: string; cancelText?: string; danger?: boolean } = {}): Promise<boolean> {
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

const isPhone = () => window.matchMedia('(max-width: 640px)').matches;

function Dialog({ req }: { req: DialogReq }) {
  const [value, setValue] = useState(req.value ?? '');
  const [phone] = useState(isPhone);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setTimeout(() => {
      if (req.kind === 'confirm') okRef.current?.focus({ preventScroll: true });
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
  const cancel = () => done(req.kind === 'confirm' ? false : null);
  const ok = () => done(req.kind === 'confirm' ? true : value);
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
  const okText = req.okText ?? (req.kind === 'confirm' ? 'OK' : 'Готово');
  const cancelText = req.cancelText ?? 'Отмена';

  // подтверждение на телефоне — «лист действий» iOS снизу
  if (req.kind === 'confirm' && phone)
    return (
      <div className="modal-backdrop dlg-backdrop dlg-as-backdrop" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
        <div className="dlg-as" role="alertdialog" aria-label={req.title} onKeyDown={onKey}>
          <div className="dlg-as-group">
            <div className="dlg-as-head">
              <div className="dlg-as-title">{req.title}</div>
              {req.message && <div className="dlg-as-msg">{req.message}</div>}
            </div>
            <button ref={okRef} className={`dlg-as-btn${req.danger ? ' danger' : ''}`} onClick={ok}>
              {okText}
            </button>
          </div>
          <button className="dlg-as-btn dlg-as-cancel" onClick={cancel}>
            {cancelText}
          </button>
        </div>
      </div>
    );

  const field =
    req.kind !== 'confirm' &&
    (req.multiline ? (
      <textarea ref={ref} className="textarea dlg-field" value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} rows={5} />
    ) : (
      <input
        ref={ref}
        className="input dlg-field"
        type={req.kind === 'password' ? 'password' : 'text'}
        autoComplete={req.kind === 'password' ? 'off' : undefined}
        value={value}
        placeholder={req.placeholder ?? (req.kind === 'password' ? 'Пароль' : '')}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && ok()}
      />
    ));

  // ввод на телефоне — лист с панелью «Отмена · Заголовок · Готово»
  if (phone)
    return (
      <div className="modal-backdrop dlg-backdrop" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
        <div className="modal dlg-sheet" role="dialog" aria-label={req.title} onKeyDown={onKey}>
          <div className="dlg-bar">
            <button className="dlg-bar-btn" onClick={cancel}>
              {cancelText}
            </button>
            <div className="dlg-bar-title ellipsis">{req.title}</div>
            <button className="dlg-bar-btn dlg-bar-ok" onClick={ok}>
              {okText}
            </button>
          </div>
          {req.message && <p className="dlg-sheet-msg">{req.message}</p>}
          {field}
        </div>
      </div>
    );

  // компьютер — окно-предупреждение iOS/macOS по центру
  return (
    <div className="modal-backdrop dlg-backdrop" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className={`modal dlg-alert${req.kind !== 'confirm' ? ' has-field' : ''}`} role={req.kind === 'confirm' ? 'alertdialog' : 'dialog'} aria-label={req.title} onKeyDown={onKey}>
        <div className="dlg-alert-body">
          <h2>{req.title}</h2>
          {req.message && <p>{req.message}</p>}
          {field}
        </div>
        <div className="dlg-alert-actions">
          <button className="dlg-alert-btn" onClick={cancel}>
            {cancelText}
          </button>
          <button ref={okRef} className={`dlg-alert-btn dlg-alert-ok${req.danger ? ' danger' : ''}`} onClick={ok}>
            {okText}
          </button>
        </div>
      </div>
    </div>
  );
}
