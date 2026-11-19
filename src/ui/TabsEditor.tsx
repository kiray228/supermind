/** Настройка нижней панели телефона: какие три раздела в ней стоят и в каком порядке («Ещё» — всегда) */
import { Fragment, useState } from 'react';
import { CaretLeft, Check, DotsThreeCircle, Microphone, X } from '@phosphor-icons/react';
import { toast, useApp } from '../store/appStore';
import { DEFAULT_TABS, TAB_BLOCKS, TAB_INFO, TAB_SLOTS, type TabBlock } from '../store/phoneNav';
import { IconTile } from './icons';
import { tabIcon } from './tabIcons';
import { t } from '../i18n/index';
import './tabs-editor.css';

export function TabsEditor({ onClose }: { onClose: () => void }) {
  const [sel, setSel] = useState<TabBlock[]>(() => useApp.getState().tabs);
  const left = TAB_SLOTS - sel.length;

  // по свежему состоянию: несколько быстрых нажатий подряд не теряются
  const toggle = (tab: TabBlock) => {
    if (!sel.includes(tab) && sel.length >= TAB_SLOTS) toast(t('В панели {n} места — сначала уберите один раздел', { n: TAB_SLOTS }));
    setSel((cur) => (cur.includes(tab) ? cur.filter((x) => x !== tab) : cur.length < TAB_SLOTS ? [...cur, tab] : cur));
  };
  const moveLeft = (i: number) => {
    if (i <= 0) return;
    setSel((cur) => {
      const n = [...cur];
      [n[i - 1], n[i]] = [n[i], n[i - 1]];
      return n;
    });
  };
  const save = () => {
    useApp.getState().setTabs(sel);
    toast(t('Панель обновлена'));
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal te-modal" role="dialog" aria-modal="true" aria-label={t('Нижняя панель')} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row te-head">
          <h2 className="grow">{t('Нижняя панель')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Закрыть')}>
            <X size={20} />
          </button>
        </div>
        <p className="te-text">{t('Выберите {n} раздела, которыми пользуетесь чаще всего. Остальные будут в «Ещё».', { n: TAB_SLOTS })}</p>

        <div className="te-bar" aria-label={t('Как будет выглядеть панель')}>
          {Array.from({ length: TAB_SLOTS }, (_, i) => {
            const tab = sel[i];
            return (
              <Fragment key={i}>
                <span className={`te-slot${tab ? '' : ' empty'}`}>
                  {tab ? <TabIco id={tab} /> : <span className="te-dash" />}
                  <small>{tab ? TAB_INFO[tab].label : i + 1}</small>
                  {tab && i > 0 && (
                    <button className="te-move" onClick={() => moveLeft(i)} aria-label={t('{name}: левее', { name: TAB_INFO[tab].label })}>
                      <CaretLeft size={12} weight="bold" />
                    </button>
                  )}
                </span>
                {/* микрофон — после второго раздела, как в панели */}
                {i === 1 && (
                  <span className="te-slot te-mic" aria-hidden="true">
                    <Microphone size={20} weight="fill" />
                  </span>
                )}
              </Fragment>
            );
          })}
          <span className="te-slot te-fixed" aria-hidden="true">
            <DotsThreeCircle size={22} />
            <small>{t('Ещё')}</small>
          </span>
        </div>

        <div className="te-list">
          {TAB_BLOCKS.map((tab) => {
            const n = sel.indexOf(tab);
            return (
              <button key={tab} className={`te-item${n >= 0 ? ' on' : ''}`} onClick={() => toggle(tab)} aria-pressed={n >= 0}>
                <IconTile section={tab} size="list" />
                <span className="te-item-x">
                  <b>{TAB_INFO[tab].title}</b>
                  <small>{TAB_INFO[tab].hint}</small>
                </span>
                <span className="te-num">{n >= 0 ? n + 1 : ''}</span>
              </button>
            );
          })}
        </div>

        <div className="modal-actions te-actions">
          <button className="btn btn-ghost" onClick={() => setSel(DEFAULT_TABS)}>
            {t('По умолчанию')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={left > 0}>
            {left > 0 ? t('Выберите ещё {n}', { n: left }) : (
              <>
                <Check size={16} weight="bold" /> {t('Готово')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabIco({ id }: { id: TabBlock }) {
  const I = tabIcon(id);
  return <I size={22} />;
}
