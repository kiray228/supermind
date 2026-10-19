import { useEffect, useState } from 'react';
import { Delete, Lock } from 'lucide-react';
import { biometricOn, lockWait, tryUnlock, unlockWithBiometric, useLock } from './lock';
import { Fingerprint } from 'lucide-react';
import { onBack } from './dialogs';
import './lock.css';

/** Поле ввода кода: точки и цифровая клавиатура (и клавиатура компьютера) */
/** errorN — номер ошибки: та же ошибка второй раз тоже очищает поле и встряхивает точки */
export function PinPad({ title, hint, error, errorN = 0, onDone, busy }: { title: string; hint?: string; error?: string; errorN?: number; onDone: (pin: string) => void; busy?: boolean }) {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  // новая ошибка — очистить и встряхнуть (сравнение с прошлой — прямо при отрисовке, без лишнего прохода)
  const errKey = error ? `${errorN}|${error}` : '';
  const [seenErr, setSeenErr] = useState(errKey);
  if (errKey !== seenErr) {
    setSeenErr(errKey);
    if (errKey) {
      setPin('');
      setShake(true);
    }
  }

  const press = (d: string) => {
    if (busy) return;
    setPin((p) => {
      const next = (p + d).slice(0, 6);
      navigator.vibrate?.(5);
      return next;
    });
  };
  const back = () => setPin((p) => p.slice(0, -1));
  const submit = () => {
    if (pin.length >= 4 && !busy) onDone(pin);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') submit();
      else return;
      e.preventDefault();
      // цифры кода — только сюда: открытая под замком карта иначе приняла бы их как ввод в тему
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div className="pin">
      <div className="pin-title">{title}</div>
      <div className={`pin-dots${shake ? ' shake' : ''}`} role="status" aria-label={`Введено цифр: ${pin.length}`} onAnimationEnd={() => setShake(false)}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <i key={i} className={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      {/* пока ввод недоступен (пауза после ошибок) — подсказка важнее ошибки */}
      <div className={`pin-hint${error && !(busy && hint) ? ' err' : ''}`} role="alert">{(busy && hint) || error || hint || ' '}</div>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="pin-key" onClick={() => press(d)} disabled={busy}>
            {d}
          </button>
        ))}
        <button className="pin-key pin-ok" onClick={submit} disabled={busy || pin.length < 4}>
          OK
        </button>
        <button className="pin-key" onClick={() => press('0')} disabled={busy}>
          0
        </button>
        <button className="pin-key pin-del" onClick={back} disabled={!pin} aria-label="Стереть">
          <Delete size={22} />
        </button>
      </div>
    </div>
  );
}

/** Экран блокировки поверх всего приложения */
export function LockScreen() {
  const locked = useLock((s) => s.locked);
  const [error, setError] = useState('');
  const [errorN, setErrorN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [forgot, setForgot] = useState(false);

  // «Назад» на Android не должен закрывать окна под экраном блокировки
  useEffect(() => (locked ? onBack(() => true) : undefined), [locked]);
  // отпечаток — сразу, как появился экран (не вышло — остаётся код)
  const bio = biometricOn();
  useEffect(() => {
    if (locked && bio) void unlockWithBiometric();
  }, [locked, bio]);
  useEffect(() => {
    if (!locked) return;
    const tick = () => setWait(lockWait());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [locked]);

  if (!locked) return null;
  return <LockScreenBody setBusy={setBusy} busy={busy} wait={wait} setWait={setWait} error={error} setError={setError} errorN={errorN} setErrorN={setErrorN} bio={bio} forgot={forgot} setForgot={setForgot} />;
}

/** Экран замка (отдельный компонент — эффекты работают, только пока приложение заблокировано) */
function LockScreenBody(p: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  wait: number;
  setWait: (v: number) => void;
  error: string;
  setError: (v: string) => void;
  errorN: number;
  setErrorN: (f: (n: number) => number) => void;
  bio: boolean;
  forgot: boolean;
  setForgot: (v: boolean) => void;
}) {
  const { busy, setBusy, wait, setWait, error, setError, errorN, setErrorN, bio, forgot, setForgot } = p;
  // под замком приложение недоступно: клавиши не доходят до разделов (сочетания карт, удаление тем),
  // остальной экран — inert (не получает фокус и нажатия)
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') e.stopPropagation();
    };
    window.addEventListener('keydown', block, true);
    const self = document.querySelector('.lock-screen');
    const others = self?.parentElement ? [...self.parentElement.children].filter((x) => x !== self && !x.hasAttribute('inert')) : [];
    for (const x of others) x.setAttribute('inert', '');
    return () => {
      window.removeEventListener('keydown', block, true);
      for (const x of others) x.removeAttribute('inert');
    };
  }, []);

  const done = async (pin: string) => {
    setBusy(true);
    try {
      const r = await tryUnlock(pin);
      if (r === 'ok') setError('');
      else {
        setWait(lockWait());
        setError(r === 'wait' ? 'Подождите немного' : 'Неверный код');
        setErrorN((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Приложение заблокировано">
      <div className="lock-icon">
        <Lock size={26} />
      </div>
      <PinPad
        title="Введите код"
        busy={busy || wait > 0}
        error={error}
        errorN={errorN}
        hint={wait > 0 ? `Слишком много попыток. Ещё ${Math.ceil(wait / 1000)} с` : undefined}
        onDone={(p) => void done(p)}
      />
      {bio && (
        <button className="lock-bio" onClick={() => void unlockWithBiometric()}>
          <Fingerprint size={22} /> Отпечаток
        </button>
      )}
      <button className="lock-forgot" onClick={() => setForgot(!forgot)}>
        Забыли код?
      </button>
      {forgot && (
        <p className="lock-forgot-text">
          Код хранится только на этом устройстве, и восстановить его нельзя. Можно очистить данные приложения в настройках телефона и войти в аккаунт заново — заметки, задачи и карты вернутся из облака (если синхронизация включена).
        </p>
      )}
    </div>
  );
}
