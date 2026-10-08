import { useEffect, useState } from 'react';
import { ArrowsClockwise, BellRinging, Cloud, CloudSlash, PaperPlaneTilt, Password, User } from '@phosphor-icons/react';
import { changePassword, deleteAccount, login, logout, register, syncNow, useCloud } from '../store/cloud';
import { enablePush, disablePush, isStandalone, pushActive, pushSupported, testPush } from '../store/push';
import { toast } from '../store/appStore';
import { dirtyKeys } from '../store/kv';
import { askPassword, askText, confirmDialog } from './dialogs';
import { isNative } from '../platform';
import { IconTile } from './icons';
import { ListCell, ListRow, ListSection, SwitchRow } from './list';

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
    const who = account.user.name || account.user.email;
    return (
      <>
        <ListSection>
          <ListRow
            className="acc-profile"
            icon={<span className="acc-avatar on">{who[0]?.toUpperCase()}</span>}
            title={who}
            subtitle={account.user.name ? `${account.user.email} · аккаунт SuperMind` : 'Аккаунт SuperMind'}
          />
        </ListSection>
        <ListSection
          header="Синхронизация"
          footer="Карты, задачи, ежедневник и всё остальное сохраняются в облаке и одинаковы на всех устройствах."
        >
          <ListRow
            icon={<IconTile icon={status === 'error' || status === 'offline' ? CloudSlash : Cloud} tone={status === 'error' || status === 'offline' ? 'red' : 'blue'} size="list" />}
            title="Облако"
            subtitle={
              status === 'error' || status === 'offline' ? (
                <span className={`acc-status ${status}`}>{error}</span>
              ) : undefined
            }
            value={status === 'syncing' ? 'Синхронизация…' : status === 'error' || status === 'offline' ? undefined : ago(lastSync)}
          />
          {!!localOnly && (
            <ListRow
              icon={<IconTile icon={CloudSlash} tone="orange" size="list" />}
              title={`${localOnly} ${localOnly === 1 ? 'объект только на устройстве' : 'объекта(ов) только на устройстве'}`}
              subtitle="Слишком большие для облака (много фото). Скачайте копию файлом в разделе «Файл» ниже."
            />
          )}
          <ListRow
            icon={<IconTile icon={ArrowsClockwise} tone="green" size="list" />}
            title={status === 'syncing' ? 'Синхронизация…' : 'Синхронизировать сейчас'}
            tone="accent"
            disabled={status === 'syncing'}
            onClick={() => void syncNow()}
          />
        </ListSection>
        <ListSection>
          <ListRow
            icon={<IconTile icon={Password} tone="gray" size="list" />}
            title="Сменить пароль"
            chevron
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
          />
          <ListRow
            title="Выйти"
            tone="danger"
            onClick={async () => {
              // сначала отправить несохранённое; не ушло (нет сети) — предупредить
              await syncNow();
              const unsent = Object.keys(await dirtyKeys()).length;
              const text = unsent
                ? `Не все изменения успели уйти в облако (нет связи): ${unsent} — они останутся только на этом устройстве и отправятся, когда вы снова войдёте в этот аккаунт.`
                : 'Данные останутся на этом устройстве, но перестанут синхронизироваться.';
              if (await confirmDialog('Выйти из аккаунта?', text, { okText: 'Выйти', danger: !!unsent })) await logout();
            }}
          />
          <ListRow
            title="Удалить аккаунт"
            tone="danger"
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
          />
        </ListSection>
      </>
    );
  }

  return (
    <>
      <ListSection>
        <ListRow
          className="acc-profile"
          icon={
            <span className="acc-avatar">
              <User size={32} weight="fill" />
            </span>
          }
          title="Войдите в SuperMind"
          subtitle="Карты, задачи и заметки — в облаке и на всех устройствах"
        />
      </ListSection>
      <form
        className="ls-section"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3 className="ls-header">Аккаунт</h3>
        <div className="ls-group">
          <ListCell>
            <div className="segmented acc-seg">
              <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
                Создать аккаунт
              </button>
              <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
                Войти
              </button>
            </div>
          </ListCell>
          {mode === 'register' && (
            <div className="ls-field">
              <input className="ls-input" placeholder="Имя" aria-label="Имя" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="ls-field">
            <input
              className="ls-input"
              type="email"
              placeholder="Email"
              aria-label="Email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="ls-field">
            <input
              className="ls-input"
              type="password"
              aria-label="Пароль"
              placeholder={mode === 'register' ? 'Пароль (минимум 8 символов)' : 'Пароль'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : 1}
            />
          </div>
        </div>
        <div className="ls-footer">Без аккаунта всё работает только на этом устройстве.</div>
        <div className="acc-form-row">
          <button className="btn btn-primary" type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : 'Войти'}
          </button>
        </div>
      </form>
    </>
  );
}

/** Push-уведомления в веб-версии и на iPhone */
export function PushCard() {
  const [on, setOn] = useState(pushActive());
  const [busy, setBusy] = useState(false);
  if (isNative()) return null;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const enable = async () => {
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
  };
  return (
    <ListSection
      header="Push-уведомления"
      footer={
        on
          ? 'Напоминания придут, даже когда SuperMind закрыт. Расписание обновляется автоматически при изменении задач.'
          : ios && !isStandalone()
            ? 'На iPhone push работает только у приложения, добавленного на экран «Домой»: Safari → «Поделиться» → «На экран „Домой“», затем откройте SuperMind с иконки и включите.'
            : 'Включите, чтобы напоминания приходили, даже когда приложение закрыто.'
      }
    >
      <SwitchRow
        icon={<IconTile icon={BellRinging} tone="red" size="list" />}
        title="Push-уведомления"
        checked={on}
        disabled={busy || (!on && !pushSupported())}
        onChange={async (v) => {
          if (v) await enable();
          else {
            await disablePush();
            setOn(false);
          }
        }}
      />
      {on && (
        <ListRow
          icon={<IconTile icon={PaperPlaneTilt} tone="blue" size="list" />}
          title="Отправить проверочное"
          tone="accent"
          onClick={async () => {
            const ok = await testPush().catch(() => false);
            toast(ok ? 'Отправлено — уведомление придёт через пару секунд' : 'Не удалось отправить — включите уведомления заново');
          }}
        />
      )}
    </ListSection>
  );
}
