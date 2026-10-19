import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EyeSlash, Fingerprint, LockKey, Timer, Password } from '@phosphor-icons/react';
import { toast } from '../store/appStore';
import { IconTile } from './icons';
import { ListRow, ListSection, SelectRow, SwitchRow } from './list';
import { biometricAvailable, biometricOn, disableLock, LOCK_AFTER_OPTIONS, lockConfig, secureWindow, setBiometric, setLockAfter, setPin, setSecure, useLock } from './lock';
import { isAndroidApp } from '../platform';
import { PinPad } from './LockScreen';
import { onBack } from './dialogs';

/** Установка кода: придумать и повторить */
function PinSetup({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => onBack(() => (onClose(), true)), [onClose]);

  const done = async (pin: string) => {
    if (!first) {
      setFirst(pin);
      setError('');
      return;
    }
    if (pin !== first) {
      setFirst(null);
      setError('Коды не совпали — придумайте заново');
      return;
    }
    setBusy(true);
    try {
      await setPin(pin);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить код');
      setFirst(null);
    } finally {
      setBusy(false);
    }
  };

  // в корень страницы: у разделов настроек своё «стекло», внутри него окно не легло бы поверх экрана
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pin-sheet" role="dialog" aria-label="Код-пароль">
        <PinPad
          key={first ? 'repeat' : 'first'}
          title={first ? 'Повторите код' : 'Придумайте код'}
          hint={first ? undefined : 'От 4 до 6 цифр'}
          error={error}
          busy={busy}
          onDone={(p) => void done(p)}
        />
        <button className="lock-forgot" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Настройки → «Защита»: код-пароль на запуск и возврат в приложение */
export function LockSettings() {
  const enabled = useLock((s) => s.enabled);
  const [setup, setSetup] = useState(false);
  const [after, setAfter] = useState(() => lockConfig()?.after ?? 1);
  const [secure, setSecureState] = useState(secureWindow);
  const [bio, setBio] = useState(biometricOn);
  const [bioAvail, setBioAvail] = useState(false);
  useEffect(() => {
    void biometricAvailable().then(setBioAvail);
  }, []);

  return (
    <ListSection
      header="Защита"
      footer="Код спрашивается при запуске и при возврате в приложение. Он хранится только на этом устройстве — в облако не попадает."
    >
      <SwitchRow
        icon={<IconTile icon={LockKey} tone="green" size="list" />}
        title="Код-пароль"
        subtitle={enabled ? 'Включён' : 'Чтобы финансы и дневник не открыл посторонний'}
        checked={enabled}
        onChange={(v) => {
          if (v) setSetup(true);
          else {
            disableLock();
            toast('Код-пароль выключен');
          }
        }}
      />
      {enabled && (
        <>
          <SelectRow
            icon={<IconTile icon={Timer} tone="orange" size="list" />}
            title="Запирать"
            value={String(after)}
            options={LOCK_AFTER_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            onChange={(v) => {
              setAfter(Number(v));
              setLockAfter(Number(v));
            }}
          />
          {bioAvail && (
            <SwitchRow
              icon={<IconTile icon={Fingerprint} tone="blue" size="list" />}
              title="Вход по отпечатку"
              subtitle="Код остаётся запасным способом"
              checked={bio}
              onChange={(v) => {
                setBiometric(v);
                setBio(v);
              }}
            />
          )}
          <ListRow icon={<IconTile icon={Password} tone="gray" size="list" />} title="Сменить код" chevron onClick={() => setSetup(true)} />
        </>
      )}
      {isAndroidApp() && (
        <SwitchRow
          icon={<IconTile icon={EyeSlash} tone="indigo" size="list" />}
          title="Прятать в недавних"
          subtitle="Вместо содержимого — пустой экран в списке приложений. Скриншоты при этом недоступны"
          checked={secure}
          onChange={(v) => {
            setSecure(v);
            setSecureState(v);
          }}
        />
      )}
      {setup && (
        <PinSetup
          onClose={() => setSetup(false)}
          onDone={() => {
            setSetup(false);
            setAfter(lockConfig()?.after ?? 1);
            toast('Код-пароль включён');
          }}
        />
      )}
    </ListSection>
  );
}
