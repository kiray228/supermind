import { useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Strikethrough, Image as ImageIcon, Trash2, Link2, X, Plus, CheckSquare, StickyNote, Tag, Palette, Map as MapIcon, Shapes,
} from 'lucide-react';
import type { LineStyle, ShapeType, StructureType, TaskStatus, Topic } from '../types';
import { useDoc } from '../store/docStore';
import { findInSheet } from '../utils/tree';
import { MARKER_GROUPS, MARKERS, toggleMarker } from '../markers';
import { COLOR_SWATCHES, THEMES } from '../themes';
import { StructureIcon } from './StructureIcon';

export type InspectorTab = 'topic' | 'style' | 'map';

export const STRUCTURES: { id: StructureType; name: string }[] = [
  { id: 'map', name: 'Интеллект-карта' },
  { id: 'logic-right', name: 'Логическая →' },
  { id: 'logic-left', name: 'Логическая ←' },
  { id: 'org', name: 'Орг-структура' },
  { id: 'tree', name: 'Дерево' },
  { id: 'timeline', name: 'Таймлайн' },
  { id: 'fishbone', name: 'Рыбья кость' },
  { id: 'brace', name: 'Скобки' },
];

const SHAPES: { id: ShapeType; name: string }[] = [
  { id: 'rounded', name: 'Скруглённый' },
  { id: 'rect', name: 'Прямоугольник' },
  { id: 'pill', name: 'Капсула' },
  { id: 'ellipse', name: 'Эллипс' },
  { id: 'diamond', name: 'Ромб' },
  { id: 'hexagon', name: 'Шестиугольник' },
  { id: 'underline', name: 'Подчёркивание' },
  { id: 'none', name: 'Без рамки' },
];

const LINES: { id: LineStyle; name: string }[] = [
  { id: 'curve', name: 'Кривая' },
  { id: 'taper', name: 'Сужающаяся' },
  { id: 'straight', name: 'Прямая' },
  { id: 'elbow', name: 'Угловая' },
  { id: 'rounded-elbow', name: 'Скруглённый угол' },
];

function ShapePreview({ shape }: { shape: ShapeType }) {
  const c = { fill: 'var(--surface-2)', stroke: 'currentColor', strokeWidth: 1.5 };
  return (
    <svg width="34" height="20" viewBox="0 0 34 20">
      {shape === 'rounded' && <rect x="2" y="3" width="30" height="14" rx="4" {...c} />}
      {shape === 'rect' && <rect x="2" y="3" width="30" height="14" rx="1" {...c} />}
      {shape === 'pill' && <rect x="2" y="3" width="30" height="14" rx="7" {...c} />}
      {shape === 'ellipse' && <ellipse cx="17" cy="10" rx="15" ry="7.5" {...c} />}
      {shape === 'diamond' && <polygon points="17,1 33,10 17,19 1,10" {...c} />}
      {shape === 'hexagon' && <polygon points="6,3 28,3 33,10 28,17 6,17 1,10" {...c} />}
      {shape === 'underline' && <line x1="2" y1="16" x2="32" y2="16" stroke="currentColor" strokeWidth="2" />}
      {shape === 'none' && <text x="17" y="14" textAnchor="middle" fontSize="10" fill="currentColor">Aa</text>}
    </svg>
  );
}

function Swatches({ value, onChange, allowNone = true }: { value?: string; onChange(v: string | undefined): void; allowNone?: boolean }) {
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch auto ${value === undefined ? 'active' : ''}`} title="Авто (по теме)" onClick={() => onChange(undefined)}>
          A
        </button>
      )}
      {COLOR_SWATCHES.map((c) => (
        <button
          key={c}
          className={`swatch ${value === c ? 'active' : ''} ${c === 'transparent' ? 'none' : ''}`}
          style={{ background: c === 'transparent' ? undefined : c }}
          title={c === 'transparent' ? 'Нет' : c}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="swatch custom" title="Свой цвет">
        <input type="color" value={value && value.startsWith('#') && value.length === 7 ? value : '#ff4a2b'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export function Inspector({ tab, setTab, onClose }: { tab: InspectorTab; setTab(t: InspectorTab): void; onClose(): void }) {
  const sheet = useDoc((s) => s.sheet());
  const selection = useDoc((s) => s.selection);
  const selectedRel = useDoc((s) => s.selectedRel);
  if (!sheet) return null;
  const topics = selection.map((id) => findInSheet(sheet, id)?.topic).filter(Boolean) as Topic[];
  const t = topics[topics.length - 1];
  const rel = selectedRel ? sheet.relationships.find((r) => r.id === selectedRel) : null;

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="segmented">
          <button className={tab === 'topic' ? 'active' : ''} onClick={() => setTab('topic')}>
            <StickyNote size={14} /> Тема
          </button>
          <button className={tab === 'style' ? 'active' : ''} onClick={() => setTab('style')}>
            <Palette size={14} /> Стиль
          </button>
          <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>
            <MapIcon size={14} /> Карта
          </button>
        </div>
        <button className="icon-btn" onClick={onClose} title="Закрыть">
          <X />
        </button>
      </div>
      <div className="inspector-body scroll">
        {rel ? (
          <RelationshipPanel id={rel.id} />
        ) : tab === 'map' ? (
          <MapPanel />
        ) : !t ? (
          <div className="empty">
            <Shapes size={32} />
            Выберите тему на карте
          </div>
        ) : tab === 'topic' ? (
          <TopicPanel key={t.id} t={t} ids={topics.map((x) => x.id)} />
        ) : (
          <StylePanel t={t} ids={topics.map((x) => x.id)} />
        )}
      </div>
    </aside>
  );
}

// ---------- Свойства темы ----------

function TopicPanel({ t, ids }: { t: Topic; ids: string[] }) {
  const st = useDoc.getState();
  const [note, setNote] = useState(t.note ?? '');
  const [link, setLink] = useState(t.link ?? '');
  const [label, setLabel] = useState('');
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  const saveNote = (v: string) => {
    setNote(v);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => st.updateTopic(t.id, { note: v || undefined }), 400);
  };

  const onImage = async (file: File) => {
    const src = await resizeImage(file, 640);
    const img = new Image();
    img.onload = () => st.updateTopic(t.id, { image: { src, w: img.naturalWidth, h: img.naturalHeight } });
    img.src = src;
  };

  const task = t.task;
  const setTask = (patch: Partial<NonNullable<Topic['task']>> | null) => {
    if (patch === null) st.updateTopics(ids, (x) => void delete x.task);
    else st.updateTopics(ids, (x) => void (x.task = { status: 'todo', ...x.task, ...patch }));
  };

  return (
    <div className="col" style={{ gap: 2 }}>
      <label className="label"><CheckSquare size={12} /> Задача</label>
      {!task ? (
        <button className="btn btn-sm" onClick={() => setTask({ status: 'todo' })}>
          <Plus size={14} /> Сделать задачей
        </button>
      ) : (
        <div className="card-lite col">
          <div className="segmented" style={{ width: '100%' }}>
            {(['todo', 'doing', 'done'] as TaskStatus[]).map((s) => (
              <button key={s} className={task.status === s ? 'active' : ''} style={{ flex: 1 }} onClick={() => setTask({ status: s, progress: s === 'done' ? 100 : task.progress })}>
                {s === 'todo' ? 'К выполнению' : s === 'doing' ? 'В работе' : 'Готово'}
              </button>
            ))}
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 80 }}>Приоритет</span>
            <select className="select" value={task.priority ?? 0} onChange={(e) => setTask({ priority: Number(e.target.value) || undefined })}>
              <option value={0}>Нет</option>
              <option value={1}>🔴 Высокий</option>
              <option value={2}>🟠 Средний</option>
              <option value={3}>🔵 Низкий</option>
            </select>
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 80 }}>Начало</span>
            <input className="input" type="date" value={task.start ?? ''} onChange={(e) => setTask({ start: e.target.value || undefined })} />
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 80 }}>Срок</span>
            <input className="input" type="date" value={task.due ?? ''} onChange={(e) => setTask({ due: e.target.value || undefined })} />
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 80 }}>Исполнит.</span>
            <input className="input" placeholder="Имя" defaultValue={task.assignee ?? ''} onBlur={(e) => setTask({ assignee: e.target.value || undefined })} />
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 80 }}>Прогресс</span>
            <input type="range" min={0} max={100} step={5} className="grow" value={task.progress ?? 0} onChange={(e) => setTask({ progress: Number(e.target.value) })} />
            <span className="small bold" style={{ width: 38, textAlign: 'right' }}>{task.progress ?? 0}%</span>
          </div>
          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setTask(null)}>
            Убрать задачу
          </button>
        </div>
      )}

      <label className="label">Маркеры</label>
      {MARKER_GROUPS.map((g) => (
        <div key={g.id} className="marker-row">
          {MARKERS.filter((m) => m.group === g.id).map((m) => (
            <button
              key={m.id}
              className={`marker-btn ${t.markers?.includes(m.id) ? 'active' : ''}`}
              title={m.title}
              onClick={() => st.updateTopics(ids, (x) => void (x.markers = toggleMarker(x.markers, m.id)))}
            >
              {m.kind === 'priority' ? (
                <span className="mk-prio" style={{ background: m.color }}>{m.value}</span>
              ) : m.kind === 'progress' ? (
                <span className="mk-prog" style={{ background: `conic-gradient(#16a34a ${Number(m.value) * 25}%, transparent 0)` }} />
              ) : (
                m.value
              )}
            </button>
          ))}
        </div>
      ))}

      <label className="label"><Tag size={12} /> Метки</label>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {(t.labels ?? []).map((l) => (
          <span key={l} className="chip active">
            {l}
            <X size={12} style={{ cursor: 'pointer' }} onClick={() => st.updateTopic(t.id, { labels: t.labels!.filter((x) => x !== l) })} />
          </span>
        ))}
      </div>
      <input
        className="input"
        placeholder="Новая метка + Enter"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && label.trim()) {
            const v = label.trim();
            st.updateTopics(ids, (x) => void (x.labels = [...new Set([...(x.labels ?? []), v])]));
            setLabel('');
          }
        }}
      />

      <label className="label"><StickyNote size={12} /> Заметка</label>
      <textarea className="textarea" rows={5} placeholder="Подробности, мысли, ссылки…" value={note} onChange={(e) => saveNote(e.target.value)} />

      <label className="label"><Link2 size={12} /> Ссылка</label>
      <div className="row">
        <input
          className="input"
          placeholder="https://…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onBlur={() => st.updateTopic(t.id, { link: link.trim() ? normalizeUrl(link.trim()) : undefined })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {t.link && (
          <a className="icon-btn" href={t.link} target="_blank" rel="noreferrer" title="Открыть">
            <Link2 size={18} />
          </a>
        )}
      </div>

      <label className="label"><ImageIcon size={12} /> Изображение</label>
      {t.image ? (
        <div className="col">
          <img src={t.image.src} alt="" style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--border)' }} />
          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => st.updateTopic(t.id, { image: undefined })}>
            <Trash2 size={14} /> Удалить изображение
          </button>
        </div>
      ) : (
        <label className="btn btn-sm">
          <ImageIcon size={14} /> Добавить изображение
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}

function normalizeUrl(u: string) {
  return /^[a-z]+:/i.test(u) ? u : 'https://' + u;
}

export async function resizeImage(file: File, max: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Стиль ----------

function StylePanel({ t, ids }: { t: Topic; ids: string[] }) {
  const st = useDoc.getState();
  const s = t.style ?? {};
  const set = (p: Parameters<typeof st.updateStyle>[1]) => st.updateStyle(ids, p);
  return (
    <div className="col" style={{ gap: 2 }}>
      <label className="label">Форма</label>
      <div className="grid-4">
        {SHAPES.map((sh) => (
          <button key={sh.id} className={`tile ${s.shape === sh.id ? 'active' : ''}`} title={sh.name} onClick={() => set({ shape: s.shape === sh.id ? undefined : sh.id })}>
            <ShapePreview shape={sh.id} />
          </button>
        ))}
      </div>
      <label className="label">Текст</label>
      <div className="row">
        <select className="select" style={{ width: 90 }} value={s.fontSize ?? ''} onChange={(e) => set({ fontSize: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">Авто</option>
          {[10, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button className={`icon-btn ${s.bold ? 'active' : ''}`} onClick={() => set({ bold: s.bold ? undefined : true })} title="Жирный"><Bold /></button>
        <button className={`icon-btn ${s.italic ? 'active' : ''}`} onClick={() => set({ italic: s.italic ? undefined : true })} title="Курсив"><Italic /></button>
        <button className={`icon-btn ${s.strike ? 'active' : ''}`} onClick={() => set({ strike: s.strike ? undefined : true })} title="Зачёркнутый"><Strikethrough /></button>
      </div>
      <label className="label">Цвет текста</label>
      <Swatches value={s.textColor} onChange={(v) => set({ textColor: v })} />
      <label className="label">Заливка</label>
      <Swatches value={s.fill} onChange={(v) => set({ fill: v })} />
      <label className="label">Рамка</label>
      <Swatches value={s.borderColor} onChange={(v) => set({ borderColor: v, borderWidth: v && v !== 'transparent' ? s.borderWidth ?? 2 : s.borderWidth })} />
      <div className="row">
        <span className="small muted">Толщина</span>
        <input type="range" className="grow" min={0} max={6} step={0.5} value={s.borderWidth ?? 0} onChange={(e) => set({ borderWidth: Number(e.target.value) })} />
      </div>
      <label className="label">Линия ветви</label>
      <Swatches value={s.lineColor} onChange={(v) => set({ lineColor: v })} />
      <select className="select" value={s.lineStyle ?? ''} onChange={(e) => set({ lineStyle: (e.target.value || undefined) as LineStyle })}>
        <option value="">Как у карты</option>
        {LINES.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <div className="row">
        <span className="small muted">Толщина</span>
        <input type="range" className="grow" min={0.5} max={8} step={0.5} value={s.lineWidth ?? 2} onChange={(e) => set({ lineWidth: Number(e.target.value) })} />
      </div>
      <button className="btn btn-sm btn-ghost" style={{ marginTop: 12 }} onClick={() => st.updateTopics(ids, (x) => void delete x.style)}>
        Сбросить стиль
      </button>
    </div>
  );
}

// ---------- Карта ----------

function MapPanel() {
  const sheet = useDoc((s) => s.sheet())!;
  const st = useDoc.getState();
  return (
    <div className="col" style={{ gap: 2 }}>
      <label className="label">Структура</label>
      <div className="grid-2">
        {STRUCTURES.map((s) => (
          <button key={s.id} className={`tile tile-lg ${sheet.structure === s.id ? 'active' : ''}`} onClick={() => st.setSheetProps({ structure: s.id })}>
            <StructureIcon id={s.id} />
            <span className="tiny">{s.name}</span>
          </button>
        ))}
      </div>
      <label className="label">Тема оформления</label>
      <div className="grid-3">
        {THEMES.map((th) => (
          <button key={th.id} className={`theme-tile ${sheet.themeId === th.id ? 'active' : ''}`} onClick={() => st.setSheetProps({ themeId: th.id, background: undefined })} style={{ background: th.background }}>
            <span className="tt-central" style={{ background: th.central.fill, color: th.central.textColor, borderColor: th.central.borderColor }} />
            <span className="tt-row">
              {th.palette.slice(0, 4).map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            <span className="tt-name" style={{ color: th.dark ? '#fff' : '#111' }}>{th.name}</span>
          </button>
        ))}
      </div>
      <label className="row small" style={{ marginTop: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!sheet.rainbow} onChange={(e) => st.setSheetProps({ rainbow: e.target.checked })} />
        Радужные ветви
      </label>
      <label className="label">Линии</label>
      <select className="select" value={sheet.lineStyle ?? ''} onChange={(e) => st.setSheetProps({ lineStyle: (e.target.value || undefined) as LineStyle })}>
        <option value="">Как в теме</option>
        {LINES.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <label className="label">Плотность</label>
      <input type="range" min={0.6} max={2} step={0.1} value={sheet.spacing ?? 1} onChange={(e) => st.setSheetProps({ spacing: Number(e.target.value) })} />
      <label className="label">Фон</label>
      <Swatches value={sheet.background} onChange={(v) => st.setSheetProps({ background: v === 'transparent' ? undefined : v })} />
      <div className="divider" />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => st.collapseAll(true, 1)}>Свернуть всё</button>
        <button className="btn btn-sm" onClick={() => st.collapseAll(false)}>Развернуть всё</button>
      </div>
    </div>
  );
}

function RelationshipPanel({ id }: { id: string }) {
  const sheet = useDoc((s) => s.sheet())!;
  const r = sheet.relationships.find((x) => x.id === id)!;
  const st = useDoc.getState();
  return (
    <div className="col" style={{ gap: 2 }}>
      <h3 style={{ margin: '4px 0' }}>Связь</h3>
      <label className="label">Подпись</label>
      <input className="input" defaultValue={r.label} key={r.id} placeholder="Например: влияет на" onBlur={(e) => st.updateRelationship(id, { label: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <label className="label">Цвет</label>
      <Swatches value={r.color} onChange={(v) => st.updateRelationship(id, { color: v })} />
      <label className="row small" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={r.dashed !== false} onChange={(e) => st.updateRelationship(id, { dashed: e.target.checked })} /> Пунктир
      </label>
      <label className="label">Изгиб</label>
      <input type="range" min={-250} max={250} step={5} value={r.bend ?? 0} onChange={(e) => st.updateRelationship(id, { bend: Number(e.target.value) })} />
      <button className="btn btn-sm btn-danger" style={{ marginTop: 14 }} onClick={() => st.removeRelationship(id)}>
        <Trash2 size={14} /> Удалить связь
      </button>
    </div>
  );
}
