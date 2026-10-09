/**
 * Вход обязателен: пока нет аккаунта, вместо приложения — экран регистрации/входа.
 * Данные на устройстве при этом не трогаются: после входа они уходят в аккаунт.
 * Забыли пароль — код на почту (POST /auth/forgot), затем код + новый пароль (POST /auth/reset).
 */
import { useEffect, useState } from 'react';
import { Eye, EyeOff, Cloud, ShieldCheck, Smartphone } from 'lucide-react';
import { InstallAppButton } from './InstallAppButton';
import { login, register, requestReset, resetPassword, useCloud } from '../store/cloud';
import './auth.css';

type Mode = 'register' | 'login' | 'forgot' | 'reset';

const SUB: Record<Mode, string> = {
  register: 'Создайте аккаунт — карты, задачи и привычки будут в безопасности и на всех ваших устройствах.',
  login: 'Войдите — ваши данные загрузятся с сервера.',
  forgot: 'Укажите email аккаунта — пришлём код для нового пароля.',
  reset: '',
};

const BUTTON: Record<Mode, string> = {
  register: 'Создать аккаунт',
  login: 'Войти',
  forgot: 'Отправить код',
  reset: 'Сохранить и войти',
};

const digits = (s: string) => s.replace(/\D/g, '');

export function AuthGate() {
  const { account, ready, error } = useCloud();
  const [mode, setMode] = useState<Mode>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // сессия истекла — сразу форма входа с понятным сообщением
  useEffect(() => {
    if (ready && !account && error) {
      setMode('login');
      setMsg(error);
    }
  }, [ready, account, error]);

  if (account) return null;
  if (!ready)
    return (
      <div className="auth-gate auth-loading" aria-busy="true">
        <img src="./icon.svg" alt="" className="auth-logo" />
      </div>
    );

  const switchTo = (m: Mode) => {
    setMode(m);
    setMsg('');
    if (m !== 'reset') setCode('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    if ((mode === 'register' || mode === 'reset') && password.length < 8) return setMsg('Пароль — минимум 8 символов');
    if (mode === 'reset' && digits(code).length !== 6) return setMsg('Введите 6 цифр из письма');
    setBusy(true);
    try {
      if (mode === 'register') await register(name.trim(), email.trim(), password);
      else if (mode === 'login') await login(email.trim(), password);
      else if (mode === 'forgot') {
        await requestReset(email.trim());
        setPassword('');
        switchTo('reset');
        return;
      } else await resetPassword(email.trim(), digits(code), password);
      setPassword('');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const recovering = mode === 'forgot' || mode === 'reset';
  const sub = mode === 'reset' ? `Код отправлен на ${email.trim()}. Проверьте почту и папку «Спам».` : SUB[mode];

  return (
    <div className="auth-gate" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <div className="auth-inner">
        <img src="./icon.svg" alt="" className="auth-logo" />
        <h1 id="auth-title" className="auth-title">SuperMind</h1>
        <p className="auth-sub">{sub}</p>

        {recovering ? (
          <h2 className="auth-step">{mode === 'forgot' ? 'Восстановление пароля' : 'Новый пароль'}</h2>
        ) : (
          <div className="segmented auth-seg" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchTo('register')}>
              Регистрация
            </button>
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchTo('login')}>
              Вход
            </button>
          </div>
        )}

        <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="auth-group">
            {mode === 'register' && (
              <input className="auth-field" placeholder="Имя" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            )}
            {mode !== 'reset' && (
              <input
                className="auth-field"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="Email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}
            {mode === 'reset' && (
              <input
                className="auth-field auth-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Код из письма"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              />
            )}
            {mode !== 'forgot' && (
              <div className="auth-pass">
                <input
                  className="auth-field"
                  type={show ? 'text' : 'password'}
                  placeholder={mode === 'login' ? 'Пароль' : mode === 'reset' ? 'Новый пароль (минимум 8 символов)' : 'Пароль (минимум 8 символов)'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button type="button" className="auth-eye" onClick={() => setShow(!show)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}>
                  {show ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            )}
          </div>

          {msg && (
            <p className="auth-error" role="alert">
              {msg}
            </p>
          )}

          <button className="btn btn-primary auth-submit" type="submit" disabled={busy || !email.trim() || (mode !== 'forgot' && !password)}>
            {busy ? 'Подождите…' : BUTTON[mode]}
          </button>
        </form>

        {mode === 'login' && (
          <button type="button" className="auth-link" onClick={() => switchTo('forgot')}>
            Забыли пароль?
          </button>
        )}
        {mode === 'reset' && (
          <button type="button" className="auth-link" disabled={busy} onClick={() => switchTo('forgot')}>
            Отправить код ещё раз
          </button>
        )}
        {recovering && (
          <button type="button" className="auth-link" onClick={() => switchTo('login')}>
            ← Назад ко входу
          </button>
        )}

        {!recovering && (
          <ul className="auth-perks">
            <li>
              <Cloud size={18} /> Всё сохраняется в облаке
            </li>
            <li>
              <Smartphone size={18} /> Одинаково на телефоне и компьютере
            </li>
            <li>
              <ShieldCheck size={18} /> Копии каждый час — ничего не потеряется
            </li>
          </ul>
        )}
        {!recovering && <InstallAppButton className="auth-download" iconSize={18} />}
      </div>
    </div>
  );
}
