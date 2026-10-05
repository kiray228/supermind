import { useEffect, useRef } from 'react';
import { ChevronRight, StickyNote, Link2 } from 'lucide-react';
import type { Topic } from '../types';
import { useDoc } from '../store/docStore';
import { MARKER_MAP } from '../markers';
import { findInSheet, visibleOrder } from '../utils/tree';

/** Режим «Структура»: карта в виде вложенного списка */
export function Outliner() {
  const sheet = useDoc((s) => s.sheet());
  if (!sheet) return null;
  return (
    <div className="outliner scroll">
      <div className="outliner-inner">
        <Row t={sheet.root} depth={0} />
        {sheet.floating.map((f) => (
          <div key={f.id} style={{ marginTop: 18 }}>
            <Row t={f} depth={0} />
          </div>
        ))}
        <p className="faint tiny" style={{ marginTop: 24 }}>
          Enter — новая тема · Tab / Shift+Tab — вложить / вынести · Backspace в пустой — удалить · Alt+↑/↓ — переместить
        </p>
      </div>
    </div>
  );
}

function Row({ t, depth }: { t: Topic; depth: number }) {
  const selected = useDoc((s) => s.selection.includes(t.id));
  const focusId = useDoc((s) => s.editingId);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusId === t.id && document.activeElement !== ref.current) {
      ref.current?.focus();
    }
  }, [focusId, t.id]);

  const st = useDoc.getState();
  const focusOther = (id: string | null | undefined) => {
    if (!id) return;
    useDoc.setState({ editingId: id, selection: [id] });
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const val = e.currentTarget.value;
    const sh = st.sheet()!;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (val !== t.text) st.setText(t.id, val);
      const id = depth === 0 ? st.addChild(t.id) : st.addSibling(t.id);
      focusOther(id);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (val !== t.text) st.setText(t.id, val);
      if (e.shiftKey) st.outdent(t.id);
      else st.indent(t.id);
      focusOther(t.id);
    } else if (e.key === 'Backspace' && !val && depth > 0) {
      e.preventDefault();
      const order = visibleOrder(sh);
      const i = order.findIndex((x) => x.id === t.id);
      st.deleteTopics([t.id]);
      focusOther(order[i - 1]?.id);
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) {
      e.preventDefault();
      st.reorder(t.id, e.key === 'ArrowUp' ? -1 : 1);
      focusOther(t.id);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const order = visibleOrder(sh);
      const i = order.findIndex((x) => x.id === t.id);
      focusOther(order[i + (e.key === 'ArrowUp' ? -1 : 1)]?.id);
    }
  };

  const done = t.task?.status === 'done';
  return (
    <div className="ol-node">
      <div className={`ol-row ${selected ? 'sel' : ''} depth-${Math.min(depth, 3)}`} style={{ paddingLeft: depth * 22 }}>
        <button className={`ol-toggle ${t.children.length ? '' : 'hidden'} ${t.collapsed ? '' : 'open'}`} onClick={() => st.toggleCollapse(t.id)}>
          <ChevronRight size={15} />
        </button>
        <span className="ol-bullet" />
        {t.task && (
          <input
            type="checkbox"
            checked={done}
            onChange={() => st.updateTopic(t.id, { task: { ...t.task!, status: done ? 'todo' : 'done', progress: done ? t.task!.progress : 100 } })}
          />
        )}
        {(t.markers ?? []).map((m) => (
          <span key={m} className="ol-marker">
            {MARKER_MAP[m]?.kind === 'emoji' ? MARKER_MAP[m].value : MARKER_MAP[m]?.kind === 'priority' ? <b style={{ color: MARKER_MAP[m].color }}>P{MARKER_MAP[m].value}</b> : '◔'}
          </span>
        ))}
        <input
          ref={ref}
          className={`ol-input ${done ? 'done' : ''}`}
          defaultValue={t.text}
          key={t.text}
          placeholder={depth === 0 ? 'Центральная тема' : 'Тема'}
          onFocus={() => useDoc.setState({ selection: [t.id], editingId: t.id })}
          onBlur={(e) => {
            if (e.target.value !== t.text && findInSheet(st.sheet()!, t.id)) st.setText(t.id, e.target.value);
          }}
          onKeyDown={onKey}
        />
        {t.note && <StickyNote size={14} className="faint" />}
        {t.link && <Link2 size={14} className="faint" />}
      </div>
      {!t.collapsed && t.children.map((c) => <Row key={c.id} t={c} depth={depth + 1} />)}
    </div>
  );
}
