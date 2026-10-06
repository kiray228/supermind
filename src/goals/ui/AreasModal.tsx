import { useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { confirmDialog } from '../../ui/dialogs';
import { AREA_COLORS, sortedAreas, type GoalsData, type LifeArea } from '../model';
import { addArea, deleteArea, moveArea, updateArea } from '../store';
import { Sheet } from './parts';
import { AddInput, InlineText } from './Stages';

/** Сферы жизни: переименование, значок, цвет, порядок, удаление */
export function AreasModal({ data, onClose }: { data: GoalsData; onClose: () => void }) {
  const areas = sortedAreas(data);
  const [colorFor, setColorFor] = useState<string | null>(null);

  const remove = async (a: LifeArea) => {
    const n = data.goals.filter((g) => g.areaId === a.id).length;
    const msg = n ? `Цели этой сферы (${n}) останутся без сферы.` : 'Оценки в истории колеса сохранятся.';
    if (await confirmDialog(`Удалить сферу «${a.name}»?`, msg, { okText: 'Удалить', danger: true })) deleteArea(a.id);
  };

  return (
    <Sheet onClose={onClose} title="Сферы жизни" className="gl-areas">
      <div className="small muted">Сферы помогают видеть баланс: к каждой можно привязать цели и оценивать её в колесе баланса.</div>
      <div className="gl-areas-list">
        {areas.map((a, i) => (
          <div key={a.id} className="gl-area-row">
            <div className="row">
              <input
                className="gl-area-emoji"
                value={a.emoji}
                aria-label="Значок"
                onChange={(e) => {
                  const parts = [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(e.target.value.trim())];
                  const last = parts.length ? parts[parts.length - 1].segment : '';
                  if (last) updateArea(a.id, { emoji: last });
                }}
              />
              <InlineText className="grow gl-area-name" value={a.name} onCommit={(t) => updateArea(a.id, { name: t })} />
              <button className="gl-color-btn" style={{ background: a.color }} onClick={() => setColorFor(colorFor === a.id ? null : a.id)} aria-label="Цвет" />
              <button className="icon-btn gl-mini-btn" disabled={i === 0} onClick={() => moveArea(a.id, -1)} aria-label="Выше">
                <ArrowUp size={15} />
              </button>
              <button className="icon-btn gl-mini-btn" disabled={i === areas.length - 1} onClick={() => moveArea(a.id, 1)} aria-label="Ниже">
                <ArrowDown size={15} />
              </button>
              <button className="icon-btn gl-mini-btn gl-danger" onClick={() => void remove(a)} aria-label="Удалить сферу">
                <Trash2 size={15} />
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
      <AddInput placeholder="Новая сфера" onAdd={(t) => addArea(t)} />
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Готово
        </button>
      </div>
    </Sheet>
  );
}
