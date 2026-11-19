import { useEffect, useRef, useState } from 'react';
import {
  TextB, TextItalic, TextStrikethrough, Image as ImageIcon, Trash, Link, X, Plus, CheckSquare, Note, Tag, Palette, MapTrifold as MapIcon, Shapes, Bell,
} from '@phosphor-icons/react';
import type { LineStyle, ShapeType, StructureType, TaskStatus, Topic } from '../types';
import { useDoc, beginBatch, endBatch, flushSave } from '../store/docStore';
import { findInSheet } from '../utils/tree';
import { safeUrl } from '../utils/url';
import { toast } from '../store/appStore';
import { MARKER_GROUPS, MARKERS, toggleMarker } from '../markers';
import { COLOR_SWATCHES, THEMES } from '../themes';
import { StructureIcon } from './StructureIcon';
import { t } from '../i18n/index';

export type InspectorTab = 'topic' | 'style' | 'map';

export const STRUCTURES: { id: StructureType; name: string }[] = [
  { id: 'map', name: t('Интеллект-карта') },
  { id: 'logic-right', name: t('Логическая →') },
  { id: 'logic-left', name: t('Логическая ←') },
  { id: 'org', name: t('Орг-структура') },
  { id: 'tree', name: t('Дерево') },
  { id: 'timeline', name: t('Таймлайн') },
  { id: 'fishbone', name: t('Рыбья кость') },
  { id: 'brace', name: t('Скобки') },
];

const SHAPES: { id: ShapeType; name: string }[] = [
  { id: 'rounded', name: t('Скруглённый') },
  { id: 'rect', name: t('Прямоугольник') },
  { id: 'pill', name: t('Капсула') },
  { id: 'ellipse', name: t('Эллипс') },
  { id: 'diamond', name: t('Ромб') },
  { id: 'hexagon', name: t('Шестиугольник') },
  { id: 'underline', name: t('Подчёркивание') },
  { id: 'none', name: t('Без рамки') },
];

const LINES: { id: LineStyle; name: string }[] = [
  { id: 'curve', name: t('Кривая') },
  { id: 'taper', name: t('Сужающаяся') },
  { id: 'straight', name: t('Прямая') },
  { id: 'elbow', name: t('Угловая') },
  { id: 'rounded-elbow', name: t('Скруглённый угол') },
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

/** Начать пакет на время касания: конец — по отпусканию где угодно (иначе незакрытый пакет глотал бы шаги отмены) */
function beginRangeBatch() {
  beginBatch();
  const end = () => {
    endBatch();
    window.removeEventListener('pointerup', end, true);
    window.removeEventListener('pointercancel', end, true);
  };
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
}

/** Ползунок: всё перетаскивание — один шаг отмены */
function Range(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="range"
      {...props}
      onPointerDown={beginRangeBatch}
      onPointerUp={endBatch}
      onPointerCancel={endBatch}
      onBlur={endBatch}
      onKeyUp={endBatch}
    />
  );
}

function Swatches({ value, onChange, allowNone = true }: { value?: string; onChange(v: string | undefined): void; allowNone?: boolean }) {
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch auto ${value === undefined ? 'active' : ''}`} title={t('Авто (по теме)')} onClick={() => onChange(undefined)}>
          A
        </button>
      )}
      {COLOR_SWATCHES.map((c) => (
        <button
          key={c}
          className={`swatch ${value === c ? 'active' : ''} ${c === 'transparent' ? 'none' : ''}`}
          style={{ background: c === 'transparent' ? undefined : c }}
          title={c === 'transparent' ? t('Нет') : c}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="swatch custom" title={t('Свой цвет')}>
        <input type="color" value={value && value.startsWith('#') && value.length === 7 ? value : '#ff4a2b'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export function Inspector({ tab, setTab, onClose }: { tab: InspectorTab; setTab(tp: InspectorTab): void; onClose(): void }) {
  const sheet = useDoc((s) => s.sheet());
  const selection = useDoc((s) => s.selection);
  const selectedRel = useDoc((s) => s.selectedRel);
  if (!sheet) return null;
  const topics = selection.map((id) => findInSheet(sheet, id)?.topic).filter(Boolean) as Topic[];
  const tp = topics[topics.length - 1];
  const rel = selectedRel ? sheet.relationships.find((r) => r.id === selectedRel) : null;

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="segmented">
          <button className={tab === 'topic' ? 'active' : ''} onClick={() => setTab('topic')}>
            <Note size={15} weight={tab === 'topic' ? 'fill' : 'regular'} /> {t('Тема')}
          </button>
          <button className={tab === 'style' ? 'active' : ''} onClick={() => setTab('style')}>
            <Palette size={15} weight={tab === 'style' ? 'fill' : 'regular'} /> {t('Стиль')}
          </button>
          <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>
            <MapIcon size={15} weight={tab === 'map' ? 'fill' : 'regular'} /> {t('Карта')}
          </button>
        </div>
        <button className="icon-btn" onClick={onClose} title={t('Закрыть')} aria-label={t('Закрыть')}>
          <X weight="bold" />
        </button>
      </div>
      <div className="inspector-body scroll">
        {rel ? (
          <RelationshipPanel id={rel.id} />
        ) : tab === 'map' ? (
          <MapPanel />
        ) : !tp ? (
          <div className="empty">
            <Shapes size={34} weight="duotone" />
            {t('Выберите тему на карте')}
          </div>
        ) : tab === 'topic' ? (
          <TopicPanel key={tp.id} tp={tp} ids={topics.map((x) => x.id)} />
        ) : (
          <StylePanel tp={tp} ids={topics.map((x) => x.id)} />
        )}
      </div>
    </aside>
  );
}

// ---------- Свойства темы ----------

function TopicPanel({ tp, ids }: { tp: Topic; ids: string[] }) {
  const st = useDoc.getState();
  const [note, setNote] = useState(tp.note ?? '');
  const [link, setLink] = useState(tp.link ?? '');
  const [label, setLabel] = useState('');
  // заметку и ссылку поменяли не здесь («Отменить», версия с другого устройства) — показать новые,
  // если в поле нет своих несохранённых правок (иначе следующая буква вернула бы старый текст)
  const [noteDirty, setNoteDirty] = useState(false);
  const [linkFocus, setLinkFocus] = useState(false);
  const [seen, setSeen] = useState({ note: tp.note ?? '', link: tp.link ?? '' });
  if ((tp.note ?? '') !== seen.note || (tp.link ?? '') !== seen.link) {
    setSeen({ note: tp.note ?? '', link: tp.link ?? '' });
    if ((tp.note ?? '') !== seen.note && !noteDirty) setNote(tp.note ?? '');
    if ((tp.link ?? '') !== seen.link && !linkFocus) setLink(tp.link ?? '');
  }
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingNote = useRef<string | null>(null);
  // при переключении темы/закрытии панели — дописать заметку, а не терять её
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
      if (pendingNote.current !== null) {
        const v = pendingNote.current;
        const sh = useDoc.getState().sheet();
        if (sh && findInSheet(sh, tp.id)) useDoc.getState().updateTopic(tp.id, { note: v || undefined });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const saveNote = (v: string) => {
    setNote(v);
    setNoteDirty(true);
    pendingNote.current = v;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      pendingNote.current = null;
      st.updateTopic(tp.id, { note: v || undefined });
      setNoteDirty(false);
    }, 400);
  };
  /** Записать набранное сразу (уход из поля, выход из карты, сворачивание приложения) */
  const flushNote = () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;
    const v = pendingNote.current;
    if (v === null) return;
    pendingNote.current = null;
    setNoteDirty(false);
    const sh = useDoc.getState().sheet();
    if (sh && findInSheet(sh, tp.id)) useDoc.getState().updateTopic(tp.id, { note: v || undefined });
  };
  const flushRef = useRef(flushNote);
  flushRef.current = flushNote;
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden' || pendingNote.current === null) return;
      flushRef.current();
      void flushSave();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  const onImage = async (file: File) => {
    const src = await resizeImage(file, 640);
    const img = new Image();
    img.onload = () => st.updateTopic(tp.id, { image: { src, w: img.naturalWidth, h: img.naturalHeight } });
    img.src = src;
  };

  const task = tp.task;
  const setTask = (patch: Partial<NonNullable<Topic['task']>> | null) => {
    if (patch === null) st.updateTopics(ids, (x) => void delete x.task);
    else st.updateTopics(ids, (x) => void (x.task = { status: 'todo', ...x.task, ...patch }));
  };

  return (
    <div className="col" style={{ gap: 2 }}>
      <label className="label"><CheckSquare size={12} /> {t('Задача')}</label>
      {!task ? (
        <button className="btn btn-sm" onClick={() => setTask({ status: 'todo' })}>
          <Plus size={14} /> {t('Сделать задачей')}
        </button>
      ) : (
        <div className="card-lite col">
          <div className="segmented" style={{ width: '100%' }}>
            {(['todo', 'doing', 'done'] as TaskStatus[]).map((s) => (
              <button key={s} className={task.status === s ? 'active' : ''} style={{ flex: 1 }} onClick={() => setTask({ status: s, progress: s === 'done' ? 100 : task.progress })}>
                {s === 'todo' ? t('К выполнению') : s === 'doing' ? t('В работе') : t('Готово')}
              </button>
            ))}
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 80 }}>{t('Приоритет')}</span>
            <select className="select" value={task.priority ?? 0} onChange={(e) => setTask({ priority: Number(e.target.value) || undefined })}>
              <option value={0}>{t('Нет')}</option>
              <option value={1}>{t('🔴 Высокий')}</option>
              <option value={2}>{t('🟠 Средний')}</option>
              <option value={3}>{t('🔵 Низкий')}</option>
            </select>
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 80 }}>{t('Начало')}</span>
            <input className="input" type="date" value={task.start ?? ''} onChange={(e) => setTask({ start: e.target.value || undefined })} />
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 80 }}>{t('Срок')}</span>
            <input className="input" type="date" value={task.due ?? ''} onChange={(e) => setTask({ due: e.target.value || undefined })} />
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 80 }}>{t('Исполнит.')}</span>
            <input className="input" placeholder={t('Имя')} defaultValue={task.assignee ?? ''} onBlur={(e) => setTask({ assignee: e.target.value || undefined })} />
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 80 }}>{t('Прогресс')}</span>
            <Range min={0} max={100} step={5} className="grow" value={task.progress ?? 0} onChange={(e) => setTask({ progress: Number(e.target.value) })} />
            <span className="small bold" style={{ width: 38, textAlign: 'right' }}>{task.progress ?? 0}%</span>
          </div>
          <button className="btn btn-sm" onClick={() => void remindTopic(tp, task.due, task.priority)}>
            <Bell size={14} /> {t('Напоминание, время и календарь')}
          </button>
          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setTask(null)}>
            {t('Убрать задачу')}
          </button>
        </div>
      )}

      <label className="label">{t('Маркеры')}</label>
      {MARKER_GROUPS.map((g) => (
        <div key={g.id} className="marker-row">
          {MARKERS.filter((m) => m.group === g.id).map((m) => (
            <button
              key={m.id}
              className={`marker-btn ${tp.markers?.includes(m.id) ? 'active' : ''}`}
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

      <label className="label"><Tag size={12} /> {t('Метки')}</label>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {(tp.labels ?? []).map((l) => (
          <span key={l} className="chip active">
            {l}
            <X size={12} style={{ cursor: 'pointer' }} onClick={() => st.updateTopic(tp.id, { labels: tp.labels!.filter((x) => x !== l) })} />
          </span>
        ))}
      </div>
      <input
        className="input"
        placeholder={t('Новая метка + Enter')}
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

      <label className="label"><Note size={12} /> {t('Заметка')}</label>
      <textarea className="textarea" rows={5} placeholder={t('Подробности, мысли, ссылки…')} value={note} onChange={(e) => saveNote(e.target.value)} onBlur={flushNote} />

      <label className="label"><Link size={12} /> {t('Ссылка')}</label>
      <div className="row">
        <input
          className="input"
          placeholder="https://…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onFocus={() => setLinkFocus(true)}
          onBlur={() => {
            setLinkFocus(false);
            const v = link.trim() ? (safeUrl(link) ?? undefined) : undefined;
            if (link.trim() && !v) {
              toast(t('Такую ссылку открыть нельзя — нужен адрес сайта, почта или телефон'));
              setLink(tp.link ?? '');
              return;
            }
            if (v !== tp.link) {
              st.updateTopic(tp.id, { link: v });
              if (v) setLink(v);
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {tp.link && safeUrl(tp.link) && (
          <a className="icon-btn" href={safeUrl(tp.link)!} target="_blank" rel="noreferrer" title={t('Открыть')}>
            <Link size={18} />
          </a>
        )}
      </div>

      <label className="label"><ImageIcon size={12} /> {t('Изображение')}</label>
      {tp.image ? (
        <div className="col">
          <img src={tp.image.src} alt="" style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--border)' }} />
          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => st.updateTopic(tp.id, { image: undefined })}>
            <Trash size={14} /> {t('Удалить изображение')}
          </button>
        </div>
      ) : (
        <label className="btn btn-sm">
          <ImageIcon size={14} /> {t('Добавить изображение')}
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
        </label>
      )}
    </div>
  );
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

function StylePanel({ tp, ids }: { tp: Topic; ids: string[] }) {
  const st = useDoc.getState();
  const s = tp.style ?? {};
  const set = (p: Parameters<typeof st.updateStyle>[1]) => st.updateStyle(ids, p);
  return (
    <div className="col" style={{ gap: 2 }}>
      <label className="label">{t('Форма')}</label>
      <div className="grid-4">
        {SHAPES.map((sh) => (
          <button key={sh.id} className={`tile ${s.shape === sh.id ? 'active' : ''}`} title={sh.name} onClick={() => set({ shape: s.shape === sh.id ? undefined : sh.id })}>
            <ShapePreview shape={sh.id} />
          </button>
        ))}
      </div>
      <label className="label">{t('Текст')}</label>
      <div className="row">
        <select className="select" style={{ width: 90 }} value={s.fontSize ?? ''} onChange={(e) => set({ fontSize: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">{t('Авто')}</option>
          {[10, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button className={`icon-btn ${s.bold ? 'active' : ''}`} onClick={() => set({ bold: s.bold ? undefined : true })} title={t('Жирный')}><TextB /></button>
        <button className={`icon-btn ${s.italic ? 'active' : ''}`} onClick={() => set({ italic: s.italic ? undefined : true })} title={t('Курсив')}><TextItalic /></button>
        <button className={`icon-btn ${s.strike ? 'active' : ''}`} onClick={() => set({ strike: s.strike ? undefined : true })} title={t('Зачёркнутый')}><TextStrikethrough /></button>
      </div>
      <label className="label">{t('Цвет текста')}</label>
      <Swatches value={s.textColor} onChange={(v) => set({ textColor: v })} />
      <label className="label">{t('Заливка')}</label>
      <Swatches value={s.fill} onChange={(v) => set({ fill: v })} />
      <label className="label">{t('Рамка')}</label>
      <Swatches value={s.borderColor} onChange={(v) => set({ borderColor: v, borderWidth: v && v !== 'transparent' ? s.borderWidth ?? 2 : s.borderWidth })} />
      <div className="row">
        <span className="small muted">{t('Толщина')}</span>
        <Range className="grow" min={0} max={6} step={0.5} value={s.borderWidth ?? 0} onChange={(e) => set({ borderWidth: Number(e.target.value) })} />
      </div>
      <label className="label">{t('Линия ветви')}</label>
      <Swatches value={s.lineColor} onChange={(v) => set({ lineColor: v })} />
      <select className="select" value={s.lineStyle ?? ''} onChange={(e) => set({ lineStyle: (e.target.value || undefined) as LineStyle })}>
        <option value="">{t('Как у карты')}</option>
        {LINES.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <div className="row">
        <span className="small muted">{t('Толщина')}</span>
        <Range className="grow" min={0.5} max={8} step={0.5} value={s.lineWidth ?? 2} onChange={(e) => set({ lineWidth: Number(e.target.value) })} />
      </div>
      <button className="btn btn-sm btn-ghost" style={{ marginTop: 12 }} onClick={() => st.updateTopics(ids, (x) => void delete x.style)}>
        {t('Сбросить стиль')}
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
      <label className="label">{t('Структура')}</label>
      <div className="grid-2">
        {STRUCTURES.map((s) => (
          <button key={s.id} className={`tile tile-lg ${sheet.structure === s.id ? 'active' : ''}`} onClick={() => st.setSheetProps({ structure: s.id })}>
            <StructureIcon id={s.id} />
            <span className="tiny">{s.name}</span>
          </button>
        ))}
      </div>
      <label className="label">{t('Тема оформления')}</label>
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
      {(['main', 'sub'] as const).map((lvl) => (
        <div key={lvl}>
          <label className="label">{lvl === 'main' ? t('Форма основных тем') : t('Форма подтем')}</label>
          <div className="grid-4">
            <button className={`tile ${!sheet.shapes?.[lvl] ? 'active' : ''}`} title={t('Как в теме оформления')} onClick={() => st.setSheetProps({ shapes: { ...sheet.shapes, [lvl]: undefined } })}>
              <span className="tiny bold">{t('Авто')}</span>
            </button>
            {SHAPES.filter((x) => x.id !== 'diamond').map((sh) => (
              <button key={sh.id} className={`tile ${sheet.shapes?.[lvl] === sh.id ? 'active' : ''}`} title={sh.name} onClick={() => st.setSheetProps({ shapes: { ...sheet.shapes, [lvl]: sh.id } })}>
                <ShapePreview shape={sh.id} />
              </button>
            ))}
          </div>
        </div>
      ))}
      <label className="row small" style={{ marginTop: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!sheet.rainbow} onChange={(e) => st.setSheetProps({ rainbow: e.target.checked })} />
        {t('Радужные ветви')}
      </label>
      <label className="label">{t('Линии')}</label>
      <select className="select" value={sheet.lineStyle ?? ''} onChange={(e) => st.setSheetProps({ lineStyle: (e.target.value || undefined) as LineStyle })}>
        <option value="">{t('Как в теме')}</option>
        {LINES.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <label className="label">{t('Плотность')}</label>
      <Range min={0.6} max={2} step={0.1} value={sheet.spacing ?? 1} onChange={(e) => st.setSheetProps({ spacing: Number(e.target.value) })} />
      <label className="label">{t('Фон')}</label>
      <Swatches value={sheet.background} onChange={(v) => st.setSheetProps({ background: v === 'transparent' ? undefined : v })} />
      <div className="divider" />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => st.collapseAll(true, 1)}>{t('Свернуть всё')}</button>
        <button className="btn btn-sm" onClick={() => st.collapseAll(false)}>{t('Развернуть всё')}</button>
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
      <h3 style={{ margin: '4px 0' }}>{t('Связь')}</h3>
      <label className="label">{t('Подпись')}</label>
      <input className="input" defaultValue={r.label} key={r.id} placeholder={t('Например: влияет на')} onBlur={(e) => st.updateRelationship(id, { label: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <label className="label">{t('Цвет')}</label>
      <Swatches value={r.color} onChange={(v) => st.updateRelationship(id, { color: v })} />
      <label className="row small" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={r.dashed !== false} onChange={(e) => st.updateRelationship(id, { dashed: e.target.checked })} /> {t('Пунктир')}
      </label>
      <label className="label">{t('Изгиб')}</label>
      <Range min={-250} max={250} step={5} value={r.bend ?? 0} onChange={(e) => st.updateRelationship(id, { bend: Number(e.target.value) })} />
      <button className="btn btn-sm btn-danger" style={{ marginTop: 14 }} onClick={() => st.removeRelationship(id)}>
        <Trash size={14} /> {t('Удалить связь')}
      </button>
    </div>
  );
}

/** Задача с напоминанием для темы карты (в разделе «Задачи»; выполнение отмечается и в карте) */
async function remindTopic(tp: Topic, due?: string, priority?: number) {
  const { ensureTasks, addTask, openTask } = await import('../tasks/store');
  const d = await ensureTasks();
  const doc = useDoc.getState().doc;
  if (!doc) return;
  const found = d.tasks.find((x) => !x.deleted && x.source?.docId === doc.id && x.source.topicId === tp.id);
  if (found) return openTask(found.id);
  const created = addTask({
    title: tp.text || t('Задача из карты'),
    date: due,
    priority: (priority ?? 0) as 0 | 1 | 2 | 3,
    source: { docId: doc.id, topicId: tp.id, docTitle: doc.title },
  });
  if (created) openTask(created.id);
}
