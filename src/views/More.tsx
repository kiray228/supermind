/**
 * «Ещё» на телефоне: профиль, редкие разделы (финансы, прогресс, ассистент, фокус), настройки по пунктам,
 * поддержка и обновления. На компьютере те же разделы — в боковой панели.
 */
import { t } from '../i18n/index';
import { useEffect, useState } from 'react';
import { ArrowClockwise, Bell, ChatCircleDots, CloudArrowUp, Gift, Info, Lightbulb, Palette, Question, ShieldCheck, SlidersHorizontal, UserCircle } from '@phosphor-icons/react';
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
import { moreBlocks, TAB_INFO } from '../store/phoneNav';
import { TabsEditor } from '../ui/TabsEditor';
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
  const tabs = useApp((s) => s.tabs);
  const [editTabs, setEditTabs] = useState(false);
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
  const name = account?.user.name || account?.user.email || t('Без аккаунта');
  const sync = status === 'syncing' ? t('Синхронизация…') : status === 'offline' ? t('Нет связи — сохранено на устройстве') : status === 'error' ? t('Ошибка синхронизации') : account ? t('Синхронизировано') : t('Данные только на этом устройстве');

  const checkUpdates = async () => {
    const u = await checkForUpdate(true);
    if (u) toast(u.version ? t('Доступна версия {version}', { version: u.version }) : t('Доступно обновление'), { label: u.kind === 'apk' ? t('Скачать') : t('Обновить'), run: () => void applyUpdate() });
    else toast(t('У вас последняя версия — {version}', { version: APP_VERSION }));
  };

  return (
    <div className="page mr-page">
      <div className="page-header">
        <h1 className="grow">{t('Ещё')}</h1>
      </div>
      <div className="page-body">
        <div className="mr-wrap">
          <button className="mr-profile" onClick={() => openSettingsAt(t('Синхронизация'))}>
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

          {/* разделы, которых нет в нижней панели */}
          <ListSection header={t('Разделы')}>
            {moreBlocks(tabs).map((tab) => (
              <ListRow
                key={tab}
                icon={<IconTile section={tab} size="list" />}
                title={TAB_INFO[tab].title}
                subtitle={tab === 'finance' && fin && spent ? t('Потрачено за месяц: {sum}', { sum: fmtMoney(spent, fin.prefs.mainCurrency, { compact: true }) }) : TAB_INFO[tab].hint}
                chevron
                onClick={() => go(tab)}
              />
            ))}
            <ListRow icon={<IconTile icon={SlidersHorizontal} tone="accent" size="list" />} title={t('Настроить нижнюю панель')} subtitle={t('Какие разделы всегда под рукой')} chevron onClick={() => setEditTabs(true)} />
          </ListSection>

          <ListSection header={t('Настройки')}>
            <ListRow icon={<IconTile icon={CloudArrowUp} tone="blue" size="list" />} title={t('Аккаунт и синхронизация')} chevron onClick={() => openSettingsAt(t('Синхронизация'))} />
            <ListRow icon={<IconTile icon={Bell} tone="red" size="list" />} title={t('Задачи и напоминания')} chevron onClick={() => openSettingsAt(t('Задачи и напоминания'))} />
            <ListRow icon={<IconTile icon={Palette} tone="violet" size="list" />} title={t('Оформление')} chevron onClick={() => openSettingsAt(t('Оформление'))} />
            <ListRow icon={<IconTile icon={ShieldCheck} tone="gray" size="list" />} title={t('Защита')} chevron onClick={() => openSettingsAt(t('Защита'))} />
            <ListRow icon={<IconTile icon={ArrowClockwise} tone="teal" size="list" />} title={t('Данные и копии')} chevron onClick={() => openSettingsAt(t('Данные и копии'))} />
            <ListRow icon={<IconTile section="settings" size="list" />} title={t('Все настройки')} chevron onClick={() => go('settings')} />
          </ListSection>

          <ListSection header={t('Помощь')}>
            <ListRow icon={<IconTile icon={Question} tone="blue" size="list" />} title={t('Задать вопрос')} subtitle={t('На частые вопросы ИИ ответит сразу')} chevron onClick={() => openSupport('question')} />
            <ListRow icon={<IconTile icon={ChatCircleDots} tone="green" size="list" />} title={t('Сообщить о проблеме')} chevron onClick={() => openSupport('problem')} />
            <ListRow icon={<IconTile icon={Lightbulb} tone="yellow" size="list" />} title={t('Предложить идею')} chevron onClick={() => openSupport('idea')} />
            <ListRow icon={<IconTile icon={Gift} tone="orange" size="list" />} title={t('Что нового')} value={APP_VERSION.replace(/\.0$/, '')} chevron onClick={openWhatsNew} />
          </ListSection>

          <ListSection>
            <ListRow icon={<IconTile icon={Info} tone="gray" size="list" />} title={t('Версия')} value={APP_VERSION} />
            {canUpdate && (
              <ListRow
                icon={<IconTile icon={ArrowClockwise} tone="blue" size="list" />}
                title={found ? (found.kind === 'apk' ? t('Скачать версию {version}', { version: found.version }) : t('Обновить до новой версии')) : t('Проверить обновления')}
                value={checking ? t('Проверяю…') : undefined}
                disabled={checking}
                chevron
                onClick={() => void (found ? applyUpdate() : checkUpdates())}
              />
            )}
          </ListSection>
        </div>
      </div>
      {editTabs && <TabsEditor onClose={() => setEditTabs(false)} />}
    </div>
  );
}
