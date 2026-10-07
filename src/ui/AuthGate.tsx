/**
 * Вход обязателен: пока нет аккаунта, вместо приложения — экран регистрации/входа.
 * Данные на устройстве при этом не трогаются: после входа они уходят в аккаунт.
 */
import { useEffect, useState } from 'react';
import { Eye, EyeOff, Cloud, ShieldCheck, Smartphone } from 'lucide-react';
import { login, register, useCloud } from '../store/cloud';
import './auth.css';

export function AuthGate() {
  const { account, ready, error } = useCloud();
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    if (mode === 'register' && password.length < 8) return setMsg('Пароль — минимум 8 символов');
    setBusy(true);
    try {
      if (mode === 'register') await register(name.trim(), email.trim(), password);
      else await login(email.trim(), password);
      setPassword('');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-gate" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <div className="auth-inner">
        <img src="./icon.svg" alt="" className="auth-logo" />
        <h1 id="auth-title" className="auth-title">SuperMind</h1>
        <p className="auth-sub">
          {mode === 'register' ? 'Создайте аккаунт — карты, задачи и привычки будут в безопасности и на всех ваших устройствах.' : 'Войдите — ваши данные загрузятся с сервера.'}
        </p>

        <div className="segmented auth-seg" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => (setMode('register'), setMsg(''))}>
            Регистрация
          </button>
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => (setMode('login'), setMsg(''))}>
            Вход
          </button>
        </div>

        <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="auth-group">
            {mode === 'register' && (
              <input className="auth-field" placeholder="Имя" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            )}
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
            <div className="auth-pass">
              <input
                className="auth-field"
                type={show ? 'text' : 'password'}
                placeholder={mode === 'register' ? 'Пароль (минимум 8 символов)' : 'Пароль'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="button" className="auth-eye" onClick={() => setShow(!show)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}>
                {show ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {msg && (
            <p className="auth-error" role="alert">
              {msg}
            </p>
          )}

          <button className="btn btn-primary auth-submit" type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>

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
      </div>
    </div>
  );
}
