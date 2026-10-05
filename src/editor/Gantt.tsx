import { useMemo, useRef, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import type { Topic } from '../types';
import { useDoc } from '../store/docStore';
import { pathTo, walkSheet } from '../utils/tree';
import { getTheme } from '../themes';

const DAY = 86400000;
/** Сдвиг даты на n дней без ошибок перехода на летнее время */
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const dayDiff = (a: Date, b: Date) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
const toDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Диаграмма Ганта по задачам листа */
export function Gantt() {
  const sheet = useDoc((s) => s.sheet())!;
  const [dayW, setDayW] = useState(34);
  const dragRef = useRef<{ id: string; mode: 'move' | 'end' | 'start'; x0: number; s: Date; e: Date } | null>(null);
  const [preview, setPreview] = useState<{ id: string; s: Date; e: Date } | null>(null);

  const rows = useMemo(() => {
    const out: { t: Topic; s: Date; e: Date; color: string; path: string }[] = [];
    const theme = getTheme(sheet.themeId);
    walkSheet(sheet, (t) => {
      if (!t.task || (!t.task.start && !t.task.due)) return;
      const s = toDate(t.task.start ?? t.task.due!);
      let e = toDate(t.task.due ?? t.task.start!);
      if (e < s) e = s;
      const p = pathTo(sheet, t.id);
      const mainIdx = p[1] ? sheet.root.children.indexOf(p[1]) : 0;
      const color = sheet.rainbow && mainIdx >= 0 ? theme.palette[mainIdx % theme.palette.length] : theme.lineColor;
      out.push({ t, s, e, color, path: p.slice(1, -1).map((x) => x.text).join(' › ') });
    });
    return out.sort((a, b) => +a.s - +b.s);
  }, [sheet]);

  const noDates = useMemo(() => {
    const out: Topic[] = [];
    walkSheet(sheet, (t) => {
      if (t.task && !t.task.start && !t.task.due) out.push(t);
    });
    return out;
  }, [sheet]);

  if (!rows.length) {
    return (
      <div className="gantt-empty empty">
        <CalendarRange size={40} />
        <div className="bold">Нет задач с датами</div>
        <div className="small">Сделайте тему задачей (панель «Тема») и укажите дату начала и срок — задача появится на диаграмме.</div>
        {noDates.length > 0 && <div className="small">Задач без дат: {noDates.length}</div>}
      </div>
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minD = rows[0].s < today ? rows[0].s : today;
  const maxD = rows.reduce((m, r) => (r.e > m ? r.e : m), today);
  const start = addDays(minD, -3);
  const days = dayDiff(start, addDays(maxD, 7)) + 1;
  const x = (d: Date) => dayDiff(start, d) * dayW;

  const onDown = (e: React.PointerEvent, id: string, mode: 'move' | 'end' | 'start', s: Date, en: Date) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { id, mode, x0: e.clientX, s, e: en };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.x0) / dayW);
    let s = d.s, en = d.e;
    if (d.mode === 'move') { s = addDays(d.s, delta); en = addDays(d.e, delta); }
    if (d.mode === 'end') { en = addDays(d.e, delta); if (en < d.s) en = d.s; }
    if (d.mode === 'start') { s = addDays(d.s, delta); if (s > d.e) s = d.e; }
    setPreview({ id: d.id, s, e: en });
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && preview && preview.id === d.id) {
      const t = rows.find((r) => r.t.id === d.id)!.t;
      useDoc.getState().updateTopic(d.id, { task: { ...t.task!, start: ymd(preview.s), due: ymd(preview.e) } });
    }
    setPreview(null);
  };

  return (
    <div className="gantt" onPointerMove={onMove} onPointerUp={onUp}>
      <div className="gantt-tools row">
        <span className="small muted">Масштаб</span>
        <input type="range" min={12} max={60} value={dayW} onChange={(e) => setDayW(Number(e.target.value))} />
      </div>
      <div className="gantt-scroll scroll">
        <div className="gantt-grid" style={{ width: 260 + days * dayW }}>
          <div className="gantt-head">
            <div className="gantt-name-col">Задача</div>
            <div className="gantt-days">
              {Array.from({ length: days }, (_, i) => {
                const d = addDays(start, i);
                const we = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div key={i} className={`gantt-day ${we ? 'we' : ''} ${+d === +today ? 'today' : ''}`} style={{ width: dayW }}>
                    {d.getDate() === 1 || i === 0 ? <b>{MONTHS[d.getMonth()]}</b> : null}
                    <span>{d.getDate()}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {rows.map((r) => {
            const pv = preview?.id === r.t.id ? preview : null;
            const s = pv?.s ?? r.s;
            const e = pv?.e ?? r.e;
            const done = r.t.task!.status === 'done';
            const prog = done ? 100 : r.t.task!.progress ?? 0;
            return (
              <div key={r.t.id} className="gantt-row">
                <div className="gantt-name-col" onClick={() => useDoc.getState().select(r.t.id)}>
                  <div className={`ellipsis ${done ? 'faint' : ''}`} style={{ textDecoration: done ? 'line-through' : undefined }}>{r.t.text || 'Без названия'}</div>
                  {r.path && <div className="tiny faint ellipsis">{r.path}</div>}
                </div>
                <div className="gantt-track" style={{ width: days * dayW }}>
                  <div className="gantt-today" style={{ left: x(today) + dayW / 2 }} />
                  <div
                    className="gantt-bar"
                    style={{ left: x(s) + 2, width: x(e) - x(s) + dayW - 4, background: r.color + '33', borderColor: r.color }}
                    onPointerDown={(ev) => onDown(ev, r.t.id, 'move', r.s, r.e)}
                    title={`${ymd(s)} — ${ymd(e)}`}
                  >
                    <div className="gantt-prog" style={{ width: prog + '%', background: r.color }} />
                    <span className="gantt-bar-label">{r.t.text}</span>
                    <div className="gantt-handle l" onPointerDown={(ev) => onDown(ev, r.t.id, 'start', r.s, r.e)} />
                    <div className="gantt-handle r" onPointerDown={(ev) => onDown(ev, r.t.id, 'end', r.s, r.e)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
