/** Настройка нижней панели телефона: какие три раздела в ней стоят и в каком порядке («Ещё» — всегда) */
import { Fragment, useState } from 'react';
import { CaretLeft, Check, DotsThreeCircle, Microphone, X } from '@phosphor-icons/react';
import { toast, useApp } from '../store/appStore';
import { DEFAULT_TABS, TAB_BLOCKS, TAB_INFO, TAB_SLOTS, type TabBlock } from '../store/phoneNav';
import { IconTile } from './icons';
import { tabIcon } from './tabIcons';
import './tabs-editor.css';

export function TabsEditor({ onClose }: { onClose: () => void }) {
  const [sel, setSel] = useState<TabBlock[]>(() => useApp.getState().tabs);
  const left = TAB_SLOTS - sel.length;

  // по свежему состоянию: несколько быстрых нажатий подряд не теряются
  const toggle = (t: TabBlock) => {
    if (!sel.includes(t) && sel.length >= TAB_SLOTS) toast(`В панели ${TAB_SLOTS} места — сначала уберите один раздел`);
    setSel((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length < TAB_SLOTS ? [...cur, t] : cur));
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
    toast('Панель обновлена');
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal te-modal" role="dialog" aria-modal="true" aria-label="Нижняя панель" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row te-head">
          <h2 className="grow">Нижняя панель</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <p className="te-text">Выберите {TAB_SLOTS} раздела, которыми пользуетесь чаще всего. Остальные будут в «Ещё».</p>

        <div className="te-bar" aria-label="Как будет выглядеть панель">
          {Array.from({ length: TAB_SLOTS }, (_, i) => {
            const t = sel[i];
            return (
              <Fragment key={i}>
                <span className={`te-slot${t ? '' : ' empty'}`}>
                  {t ? <TabIco id={t} /> : <span className="te-dash" />}
                  <small>{t ? TAB_INFO[t].label : i + 1}</small>
                  {t && i > 0 && (
                    <button className="te-move" onClick={() => moveLeft(i)} aria-label={`${TAB_INFO[t].label}: левее`}>
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
            <small>Ещё</small>
          </span>
        </div>

        <div className="te-list">
          {TAB_BLOCKS.map((t) => {
            const n = sel.indexOf(t);
            return (
              <button key={t} className={`te-item${n >= 0 ? ' on' : ''}`} onClick={() => toggle(t)} aria-pressed={n >= 0}>
                <IconTile section={t} size="list" />
                <span className="te-item-x">
                  <b>{TAB_INFO[t].title}</b>
                  <small>{TAB_INFO[t].hint}</small>
                </span>
                <span className="te-num">{n >= 0 ? n + 1 : ''}</span>
              </button>
            );
          })}
        </div>

        <div className="modal-actions te-actions">
          <button className="btn btn-ghost" onClick={() => setSel(DEFAULT_TABS)}>
            По умолчанию
          </button>
          <button className="btn btn-primary" onClick={save} disabled={left > 0}>
            {left > 0 ? `Выберите ещё ${left}` : (
              <>
                <Check size={16} weight="bold" /> Готово
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
