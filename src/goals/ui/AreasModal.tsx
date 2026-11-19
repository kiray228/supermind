import { useState } from 'react';
import { ArrowDown, ArrowUp, Trash } from '@phosphor-icons/react';
import { confirmDialog } from '../../ui/dialogs';
import { AREA_COLORS, sortedAreas, type GoalsData, type LifeArea } from '../model';
import { addArea, deleteArea, moveArea, updateArea } from '../store';
import { Sheet } from './parts';
import { AddInput, InlineText } from './Stages';
import { LOCALE, t } from '../../i18n/index';

/** Сферы жизни: переименование, значок, цвет, порядок, удаление */
export function AreasModal({ data, onClose }: { data: GoalsData; onClose: () => void }) {
  const areas = sortedAreas(data);
  const [colorFor, setColorFor] = useState<string | null>(null);

  const remove = async (a: LifeArea) => {
    const n = data.goals.filter((g) => g.areaId === a.id).length;
    const msg = n ? t('Цели этой сферы ({n}) останутся без сферы.', { n }) : t('Оценки в истории колеса сохранятся.');
    if (await confirmDialog(t('Удалить сферу «{name}»?', { name: a.name }), msg, { okText: t('Удалить'), danger: true })) deleteArea(a.id);
  };

  return (
    <Sheet onClose={onClose} title={t('Сферы жизни')} className="gl-areas">
      <div className="small muted">{t('Сферы помогают видеть баланс: к каждой можно привязать цели и оценивать её в колесе баланса.')}</div>
      <div className="gl-areas-list">
        {areas.map((a, i) => (
          <div key={a.id} className="gl-area-row">
            <div className="row">
              <input
                className="gl-area-emoji"
                value={a.emoji}
                aria-label={t('Значок')}
                onChange={(e) => {
                  const parts = [...new Intl.Segmenter(LOCALE, { granularity: 'grapheme' }).segment(e.target.value.trim())];
                  const last = parts.length ? parts[parts.length - 1].segment : '';
                  if (last) updateArea(a.id, { emoji: last });
                }}
              />
              <InlineText className="grow gl-area-name" value={a.name} onCommit={(t) => updateArea(a.id, { name: t })} />
              <button className="gl-color-btn" style={{ background: a.color }} onClick={() => setColorFor(colorFor === a.id ? null : a.id)} aria-label={t('Цвет')} />
              <button className="icon-btn gl-mini-btn" disabled={i === 0} onClick={() => moveArea(a.id, -1)} aria-label={t('Выше')}>
                <ArrowUp size={15} />
              </button>
              <button className="icon-btn gl-mini-btn" disabled={i === areas.length - 1} onClick={() => moveArea(a.id, 1)} aria-label={t('Ниже')}>
                <ArrowDown size={15} />
              </button>
              <button className="icon-btn gl-mini-btn gl-danger" onClick={() => void remove(a)} aria-label={t('Удалить сферу')}>
                <Trash size={15} />
              </button>
            </div>
            {colorFor === a.id && (
              <div className="gl-swatches">
                {AREA_COLORS.map((c) => (
                  <button
                    key={c}
                    className={'gl-swatch' + (a.color === c ? ' active' : '')}
                    style={{ background: c }}
                    onClick={() => {
                      updateArea(a.id, { color: c });
                      setColorFor(null);
                    }}
                    aria-label={c}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <AddInput placeholder={t('Новая сфера')} onAdd={(t) => addArea(t)} />
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>
          {t('Готово')}
        </button>
      </div>
    </Sheet>
  );
}
