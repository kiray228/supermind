/**
 * «Ещё» на телефоне: профиль, редкие разделы (финансы, прогресс, ассистент, фокус), настройки по пунктам,
 * поддержка и обновления. На компьютере те же разделы — в боковой панели.
 */
import { useEffect, useState } from 'react';
import { ArrowClockwise, Bell, ChatCircleDots, CloudArrowUp, Gift, Info, Lightbulb, Palette, Question, ShieldCheck, UserCircle } from '@phosphor-icons/react';
import { useApp, toast } from '../store/appStore';
import { useCloud } from '../store/cloud';
import { IconTile } from '../ui/icons';
import { ListRow, ListSection } from '../ui/list';
import { LevelBadge } from '../progress/LevelBadge';
import { openSupport } from '../ui/Support';
import { openWhatsNew } from '../onboarding/state';
import { APP_VERSION } from '../store/safety';
import { applyUpdate, checkForUpdate, updatesSupported, useAppUpdate } from '../ui/appUpdate';
import { ensureFinance, useFinance } from '../finance/store';
import { fmtMoney, summarize } from '../finance/model';
import { todayYmd } from '../utils/mapTasks';
import './more.css';

/** Открыть «Настройки» на нужной группе (по заголовку группы) */
function openSettingsAt(header: string) {
  useApp.getState().go('settings');
  let tries = 0;
  const find = () => {
    const el = [...document.querySelectorAll<HTMLElement>('.ls-header')].find((h) => h.textContent?.trim().startsWith(header));
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else if (++tries < 40) setTimeout(find, 50); // раздел подгружается
  };
  setTimeout(find, 0);
}

export default function More() {
  const go = useApp((s) => s.go);
  const account = useCloud((s) => s.account);
  const status = useCloud((s) => s.status);
  const fin = useFinance((s) => s.data);
  const found = useAppUpdate((s) => s.update);
  const checking = useAppUpdate((s) => s.checking);
  const [canUpdate, setCanUpdate] = useState(false);
  useEffect(() => {
    void ensureFinance().catch(() => undefined);
    void updatesSupported().then(setCanUpdate);
  }, []);
  const today = todayYmd();
  const spent = fin ? summarize(fin, { from: today.slice(0, 8) + '01', to: today }).expense : 0;
  const name = account?.user.name || account?.user.email || 'Без аккаунта';
  const sync = status === 'syncing' ? 'Синхронизация…' : status === 'offline' ? 'Нет связи — сохранено на устройстве' : status === 'error' ? 'Ошибка синхронизации' : account ? 'Синхронизировано' : 'Данные только на этом устройстве';

  const checkUpdates = async () => {
    const u = await checkForUpdate(true);
    if (u) toast(u.version ? `Доступна версия ${u.version}` : 'Доступно обновление', { label: u.kind === 'apk' ? 'Скачать' : 'Обновить', run: () => void applyUpdate() });
    else toast(`У вас последняя версия — ${APP_VERSION}`);
  };

  return (
    <div className="page mr-page">
      <div className="page-header">
        <h1 className="grow">Ещё</h1>
      </div>
      <div className="page-body">
        <div className="mr-wrap">
          <button className="mr-profile" onClick={() => openSettingsAt('Синхронизация')}>
            <span className="mr-ava" aria-hidden="true">
              {account ? (name.trim()[0] ?? '?').toUpperCase() : <UserCircle size={30} weight="fill" />}
            </span>
            <span className="mr-profile-x">
              <b>{name}</b>
              <small className={status === 'error' ? 'is-err' : ''}>{sync}</small>
            </span>
            <span onClick={(e) => e.stopPropagation()} role="presentation">
              <LevelBadge compact />
            </span>
          </button>

          <ListSection>
            <ListRow icon={<IconTile section="finance" size="list" />} title="Финансы" subtitle={fin && spent ? 'Потрачено за месяц: ' + fmtMoney(spent, fin.prefs.mainCurrency, { compact: true }) : 'Счета, бюджет, траты'} chevron onClick={() => go('finance')} />
            <ListRow icon={<IconTile section="progress" size="list" />} title="Прогресс" subtitle="Уровень, серия, достижения" chevron onClick={() => go('progress')} />
            <ListRow icon={<IconTile section="assistant" size="list" />} title="ИИ-ассистент" subtitle="Сводка дня и чат" chevron onClick={() => go('assistant')} />
            <ListRow icon={<IconTile section="focus" size="list" />} title="Фокус" subtitle="Помодоро, секундомер, отсчёты" chevron onClick={() => go('focus')} />
          </ListSection>

          <ListSection header="Настройки">
            <ListRow icon={<IconTile icon={CloudArrowUp} tone="blue" size="list" />} title="Аккаунт и синхронизация" chevron onClick={() => openSettingsAt('Синхронизация')} />
            <ListRow icon={<IconTile icon={Bell} tone="red" size="list" />} title="Задачи и напоминания" chevron onClick={() => openSettingsAt('Задачи и напоминания')} />
            <ListRow icon={<IconTile icon={Palette} tone="violet" size="list" />} title="Оформление" chevron onClick={() => openSettingsAt('Оформление')} />
            <ListRow icon={<IconTile icon={ShieldCheck} tone="gray" size="list" />} title="Защита" chevron onClick={() => openSettingsAt('Защита')} />
            <ListRow icon={<IconTile icon={ArrowClockwise} tone="teal" size="list" />} title="Данные и копии" chevron onClick={() => openSettingsAt('Данные и копии')} />
            <ListRow icon={<IconTile section="settings" size="list" />} title="Все настройки" chevron onClick={() => go('settings')} />
          </ListSection>

          <ListSection header="Помощь">
            <ListRow icon={<IconTile icon={Question} tone="blue" size="list" />} title="Задать вопрос" subtitle="На частые вопросы ИИ ответит сразу" chevron onClick={() => openSupport('question')} />
            <ListRow icon={<IconTile icon={ChatCircleDots} tone="green" size="list" />} title="Сообщить о проблеме" chevron onClick={() => openSupport('problem')} />
            <ListRow icon={<IconTile icon={Lightbulb} tone="yellow" size="list" />} title="Предложить идею" chevron onClick={() => openSupport('idea')} />
            <ListRow icon={<IconTile icon={Gift} tone="orange" size="list" />} title="Что нового" value={APP_VERSION.replace(/\.0$/, '')} chevron onClick={openWhatsNew} />
          </ListSection>

          <ListSection>
            <ListRow icon={<IconTile icon={Info} tone="gray" size="list" />} title="Версия" value={APP_VERSION} />
            {canUpdate && (
              <ListRow
                icon={<IconTile icon={ArrowClockwise} tone="blue" size="list" />}
                title={found ? (found.kind === 'apk' ? `Скачать версию ${found.version}` : 'Обновить до новой версии') : 'Проверить обновления'}
                value={checking ? 'Проверяю…' : undefined}
                disabled={checking}
                chevron
                onClick={() => void (found ? applyUpdate() : checkUpdates())}
              />
            )}
          </ListSection>
        </div>
      </div>
    </div>
  );
}
