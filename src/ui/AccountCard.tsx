import { useEffect, useState } from 'react';
import { Cloud, CloudOff, KeyRound, LogOut, RefreshCw, Trash2, UserRound, BellRing, Send } from 'lucide-react';
import { changePassword, deleteAccount, login, logout, register, syncNow, useCloud } from '../store/cloud';
import { enablePush, disablePush, isStandalone, pushActive, pushSupported, testPush } from '../store/push';
import { toast } from '../store/appStore';
import { askPassword, askText, confirmDialog } from './dialogs';
import { isNative } from '../platform';

function ago(ms?: number): string {
  if (!ms) return 'ещё не было';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  return new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Аккаунт: вход/регистрация и синхронизация между устройствами */
export function AccountCard() {
  const { account, status, error, lastSync, localOnly } = useCloud();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'register') await register(name.trim(), email.trim(), password);
      else await login(email.trim(), password);
      setPassword('');
      toast(mode === 'register' ? 'Аккаунт создан — данные сохраняются в облаке' : 'Вы вошли — данные синхронизированы');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (account) {
    return (
      <section className="card set-card acc-card">
        <h3>
          <Cloud size={18} color="var(--accent)" /> Аккаунт и синхронизация
        </h3>
        <div className="acc-user">
          <span className="acc-avatar">{(account.user.name || account.user.email)[0]?.toUpperCase()}</span>
          <div className="grow">
            <div className="bold ellipsis">{account.user.name || account.user.email}</div>
            <div className="small muted ellipsis">{account.user.email}</div>
          </div>
        </div>
        <p className={`small acc-status ${status}`}>
          {status === 'syncing' ? (
            <>
              <RefreshCw size={14} className="spin" /> Синхронизация…
            </>
          ) : status === 'error' || status === 'offline' ? (
            <>
              <CloudOff size={14} /> {error}
            </>
          ) : (
            <>
              <Cloud size={14} /> Карты, задачи, ежедневник и всё остальное сохраняются в облаке. Последняя синхронизация: {ago(lastSync)}
            </>
          )}
        </p>
        {!!localOnly && (
          <p className="small acc-status error">
            <CloudOff size={14} /> {localOnly} {localOnly === 1 ? 'объект слишком большой' : 'объекта(ов) слишком большие'} для облака (много фото) — они хранятся только на этом устройстве. Скачайте копию файлом в разделе «Данные и копии».
          </p>
        )}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => void syncNow()} disabled={status === 'syncing'}>
            <RefreshCw size={15} /> Синхронизировать
          </button>
          <button
            className="btn btn-sm"
            onClick={async () => {
              const oldP = await askPassword('Текущий пароль');
              if (!oldP) return;
              const newP = await askText('Новый пароль', { placeholder: 'Минимум 8 символов' });
              if (!newP) return;
              try {
                await changePassword(oldP, newP);
                toast('Пароль изменён. На других устройствах нужно войти заново');
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <KeyRound size={15} /> Сменить пароль
          </button>
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (await confirmDialog('Выйти из аккаунта?', 'Данные останутся на этом устройстве, но перестанут синхронизироваться.', { okText: 'Выйти' })) await logout();
            }}
          >
            <LogOut size={15} /> Выйти
          </button>
          <button
            className="btn btn-sm btn-ghost btn-danger"
            onClick={async () => {
              if (!(await confirmDialog('Удалить аккаунт?', 'Данные будут удалены из облака навсегда. На этом устройстве они останутся.', { danger: true, okText: 'Удалить' }))) return;
              const p = await askPassword('Пароль для подтверждения');
              if (!p) return;
              try {
                await deleteAccount(p);
                toast('Аккаунт удалён');
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <Trash2 size={15} /> Удалить аккаунт
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card set-card acc-card">
      <h3>
        <UserRound size={18} color="var(--accent)" /> Аккаунт
      </h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Войдите, чтобы карты, задачи, ежедневник, финансы и заметки сохранялись в облаке и были одинаковыми на телефоне и компьютере. Без аккаунта всё работает только на этом устройстве.
      </p>
      <div className="segmented acc-seg">
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
          Создать аккаунт
        </button>
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Войти
        </button>
      </div>
      <form
        className="acc-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === 'register' && <input className="input" placeholder="Имя" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        <input className="input" type="email" placeholder="Email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          className="input"
          type="password"
          placeholder={mode === 'register' ? 'Пароль (минимум 8 символов)' : 'Пароль'}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === 'register' ? 8 : 1}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : 'Войти'}
        </button>
      </form>
    </section>
  );
}

/** Push-уведомления в веб-версии и на iPhone */
export function PushCard() {
  const [on, setOn] = useState(pushActive());
  const [busy, setBusy] = useState(false);
  if (isNative()) return null;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  return (
    <div className="acc-push">
      <div className="row">
        <BellRing size={18} color="var(--accent)" />
        <b className="grow">Push-уведомления</b>
        <span className={`chip${on ? ' active' : ''}`}>{on ? 'включены' : 'выключены'}</span>
      </div>
      <p className="tiny muted" style={{ margin: '6px 0 8px' }}>
        {on
          ? 'Напоминания придут, даже когда SuperMind закрыт. Расписание обновляется автоматически при изменении задач.'
          : ios && !isStandalone()
            ? 'На iPhone push работает только у приложения, добавленного на экран «Домой»: Safari → «Поделиться» → «На экран „Домой“», затем откройте SuperMind с иконки и нажмите «Включить».'
            : 'Включите, чтобы напоминания приходили, даже когда приложение закрыто.'}
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {!on ? (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || !pushSupported()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await enablePush();
                toast(r.message);
                setOn(r.ok);
              } catch (e) {
                toast('Не удалось включить: ' + (e instanceof Error ? e.message : String(e)));
              } finally {
                setBusy(false);
              }
            }}
          >
            <BellRing size={15} /> Включить
          </button>
        ) : (
          <>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const ok = await testPush().catch(() => false);
                toast(ok ? 'Отправлено — уведомление придёт через пару секунд' : 'Не удалось отправить — включите уведомления заново');
              }}
            >
              <Send size={15} /> Проверить
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                await disablePush();
                setOn(false);
              }}
            >
              Выключить
            </button>
          </>
        )}
      </div>
    </div>
  );
}
