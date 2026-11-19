import { useEffect, useState } from 'react';
import { ArrowsClockwise, BellRinging, CloudArrowUp, CloudCheck, CloudSlash, CloudWarning, PaperPlaneTilt, Password, User } from '@phosphor-icons/react';
import { changePassword, deleteAccount, login, logout, register, syncNow, useCloud } from '../store/cloud';
import { enablePush, disablePush, isStandalone, pushActive, pushSupported, testPush } from '../store/push';
import { toast } from '../store/appStore';
import { dirtyKeys } from '../store/kv';
import { clockText, recount, usePendingSync } from '../store/pending';
import { LOCALE, t, tn } from '../i18n/index';
import { askPassword, askText, confirmDialog } from './dialogs';
import { isNative } from '../platform';
import { IconTile } from './icons';
import { ListCell, ListRow, ListSection, SwitchRow } from './list';

function ago(ms?: number): string {
  if (!ms) return t('ещё не было');
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return t('только что');
  if (s < 3600) return t('{n} мин назад', { n: Math.floor(s / 60) });
  return new Date(ms).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** «3 изменения» */
const changesText = (n: number) => `${n} ${tn(n, 'изменение', 'изменения', 'изменений')}`;

/** Аккаунт: вход/регистрация и синхронизация между устройствами */
export function AccountCard() {
  const { account, status, error, lastSync, localOnly } = useCloud();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  // неотправленные изменения (пересчёт по событиям)
  const { count, since } = usePendingSync();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'register') await register(name.trim(), email.trim(), password);
      else await login(email.trim(), password);
      setPassword('');
      toast(mode === 'register' ? t('Аккаунт создан — данные сохраняются в облаке') : t('Вы вошли — данные синхронизированы'));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** «Отправить сейчас»: синхронизация и понятный итог */
  const sendNow = async () => {
    setSending(true);
    try {
      await syncNow();
      const left = await recount();
      const s = useCloud.getState();
      if (s.status === 'offline') toast(t('Нет интернета — отправим, когда появится связь'));
      else if (s.status === 'error') toast(s.error ?? t('Не удалось синхронизировать'));
      else if (left) toast(t('Не всё отправлено: осталось {changes}', { changes: changesText(left) }));
      else toast(count ? t('Все изменения отправлены в облако') : t('Синхронизировано'));
    } finally {
      setSending(false);
    }
  };

  if (account) {
    const who = account.user.name || account.user.email;
    const syncing = status === 'syncing' || sending;
    const cloudIcon = status === 'offline' ? CloudSlash : status === 'error' ? CloudWarning : count ? CloudArrowUp : CloudCheck;
    const cloudTone = status === 'error' ? 'red' : status === 'offline' || count ? 'orange' : 'blue';
    const unsent = count ? (since ? t('Не отправлено: {changes} · с {time}', { changes: changesText(count), time: clockText(since) }) : t('Не отправлено: {changes}', { changes: changesText(count) })) : '';
    return (
      <>
        <ListSection>
          <ListRow
            className="acc-profile"
            icon={<span className="acc-avatar on">{who[0]?.toUpperCase()}</span>}
            title={who}
            subtitle={account.user.name ? t('{email} · аккаунт SuperMind', { email: account.user.email }) : t('Аккаунт SuperMind')}
          />
        </ListSection>
        <ListSection
          className="acc-sync"
          header={t('Синхронизация')}
          footer={t('Карты, задачи, ежедневник и всё остальное сохраняются в облаке и одинаковы на всех устройствах.')}
        >
          <ListRow
            icon={<IconTile icon={cloudIcon} tone={cloudTone} size="list" />}
            title={t('Облако')}
            subtitle={
              status === 'offline' ? (
                <>
                  <span className="acc-status offline">{t('Нет интернета — отправим, когда появится связь')}</span>
                  {unsent && <span className="acc-unsent">{unsent}</span>}
                </>
              ) : status === 'error' ? (
                <>
                  <span className="acc-status error">{error ?? t('Ошибка синхронизации')}</span>
                  {unsent && <span className="acc-unsent">{unsent}</span>}
                </>
              ) : status === 'syncing' ? (
                count ? t('Отправляем {changes}…', { changes: changesText(count) }) : t('Синхронизация…')
              ) : (
                unsent || (lastSync ? t('Все изменения в облаке · синхронизировано {ago}', { ago: ago(lastSync) }) : t('Все изменения в облаке'))
              )
            }
            value={status === 'syncing' && !sending ? <span className="spinner acc-spinner" aria-label={t('Синхронизация')} /> : undefined}
          />
          {!!localOnly && (
            <ListRow
              icon={<IconTile icon={CloudSlash} tone="orange" size="list" />}
              title={t('{n} {objects} только на устройстве', { n: localOnly, objects: tn(localOnly, 'объект', 'объекта', 'объектов') })}
              subtitle={t('Слишком большие для облака (много фото). Скачайте копию файлом в разделе «Файл» ниже.')}
            />
          )}
          <ListRow
            icon={<IconTile icon={count ? CloudArrowUp : ArrowsClockwise} tone="green" size="list" />}
            title={syncing ? (count ? t('Отправка…') : t('Синхронизация…')) : count ? t('Отправить сейчас') : t('Синхронизировать сейчас')}
            tone="accent"
            disabled={syncing}
            trailing={sending ? <span className="spinner acc-spinner" /> : undefined}
            onClick={() => void sendNow()}
          />
        </ListSection>
        <ListSection>
          <ListRow
            icon={<IconTile icon={Password} tone="gray" size="list" />}
            title={t('Сменить пароль')}
            chevron
            onClick={async () => {
              const oldP = await askPassword(t('Текущий пароль'));
              if (!oldP) return;
              const newP = await askText(t('Новый пароль'), { placeholder: t('Минимум 8 символов') });
              if (!newP) return;
              try {
                await changePassword(oldP, newP);
                toast(t('Пароль изменён. На других устройствах нужно войти заново'));
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e));
              }
            }}
          />
          <ListRow
            title={t('Выйти')}
            tone="danger"
            onClick={async () => {
              // сначала отправить несохранённое; не ушло (нет сети) — предупредить
              await syncNow();
              const unsent = Object.keys(await dirtyKeys()).length;
              const text = unsent
                ? t('Не все изменения успели уйти в облако (нет связи): {n} — они останутся только на этом устройстве и отправятся, когда вы снова войдёте в этот аккаунт.', { n: unsent })
                : t('Данные останутся на этом устройстве, но перестанут синхронизироваться.');
              if (await confirmDialog(t('Выйти из аккаунта?'), text, { okText: t('Выйти'), danger: !!unsent })) await logout();
            }}
          />
          <ListRow
            title={t('Удалить аккаунт')}
            tone="danger"
            onClick={async () => {
              if (!(await confirmDialog(t('Удалить аккаунт?'), t('Данные будут удалены из облака навсегда. На этом устройстве они останутся.'), { danger: true, okText: t('Удалить') }))) return;
              const p = await askPassword(t('Пароль для подтверждения'));
              if (!p) return;
              try {
                await deleteAccount(p);
                toast(t('Аккаунт удалён'));
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
          title={t('Войдите в SuperMind')}
          subtitle={t('Карты, задачи и заметки — в облаке и на всех устройствах')}
        />
      </ListSection>
      <form
        className="ls-section"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3 className="ls-header">{t('Аккаунт')}</h3>
        <div className="ls-group">
          <ListCell>
            <div className="segmented acc-seg">
              <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
                {t('Создать аккаунт')}
              </button>
              <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
                {t('Войти')}
              </button>
            </div>
          </ListCell>
          {mode === 'register' && (
            <div className="ls-field">
              <input className="ls-input" placeholder={t('Имя')} aria-label={t('Имя')} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
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
              aria-label={t('Пароль')}
              placeholder={mode === 'register' ? t('Пароль (минимум 8 символов)') : t('Пароль')}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : 1}
            />
          </div>
        </div>
        <div className="ls-footer">{t('Без аккаунта всё работает только на этом устройстве.')}</div>
        <div className="acc-form-row">
          <button className="btn btn-primary" type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? t('Подождите…') : mode === 'register' ? t('Создать аккаунт') : t('Войти')}
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
      toast(t('Не удалось включить: {error}', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ListSection
      header={t('Push-уведомления')}
      footer={
        on
          ? t('Напоминания придут, даже когда SuperMind закрыт. Расписание обновляется автоматически при изменении задач.')
          : ios && !isStandalone()
            ? t('На iPhone push работает только у приложения, добавленного на экран «Домой»: Safari → «Поделиться» → «На экран „Домой“», затем откройте SuperMind с иконки и включите.')
            : t('Включите, чтобы напоминания приходили, даже когда приложение закрыто.')
      }
    >
      <SwitchRow
        icon={<IconTile icon={BellRinging} tone="red" size="list" />}
        title={t('Push-уведомления')}
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
          title={t('Отправить проверочное')}
          tone="accent"
          onClick={async () => {
            const ok = await testPush().catch(() => false);
            toast(ok ? t('Отправлено — уведомление придёт через пару секунд') : t('Не удалось отправить — включите уведомления заново'));
          }}
        />
      )}
    </ListSection>
  );
}
