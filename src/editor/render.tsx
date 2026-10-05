import { memo } from 'react';
import type { Boundary, Relationship, Summary } from '../types';
import { type LayoutResult, type LNode, bracePath, formatDue, subtreeBounds } from '../layout/layout';
import { FONT_FAMILY } from '../layout/measure';
import { MARKER_MAP } from '../markers';

export const ACCENT = '#ff4a2b';

function shapePath(n: LNode): React.ReactNode {
  const { x, y, w, h } = { x: 0, y: 0, w: n.w, h: n.h };
  const s = n.style;
  const fill = s.fill === 'transparent' ? 'none' : s.fill;
  const stroke = s.borderWidth > 0 && s.borderColor !== 'transparent' ? s.borderColor : 'none';
  const sw = s.borderWidth;
  const common = { fill, stroke, strokeWidth: sw };
  switch (s.shape) {
    case 'rect':
      return <rect x={x} y={y} width={w} height={h} rx={3} {...common} />;
    case 'rounded':
      return <rect x={x} y={y} width={w} height={h} rx={Math.min(10, h / 2.6)} {...common} />;
    case 'pill':
      return <rect x={x} y={y} width={w} height={h} rx={h / 2} {...common} />;
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />;
    case 'diamond':
      return <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} {...common} />;
    case 'hexagon': {
      const i = Math.min(h * 0.35, w / 4);
      return <polygon points={`${i},0 ${w - i},0 ${w},${h / 2} ${w - i},${h} ${i},${h} 0,${h / 2}`} {...common} />;
    }
    case 'underline': {
      const col = s.borderColor !== 'transparent' && s.borderWidth > 0 ? s.borderColor : n.color;
      return (
        <>
          {fill !== 'none' && <rect x={0} y={0} width={w} height={h} rx={4} fill={fill} />}
          <line x1={0} y1={h} x2={w} y2={h} stroke={col} strokeWidth={Math.max(1.5, s.borderWidth || 2)} strokeLinecap="round" />
        </>
      );
    }
    case 'none':
    default:
      return fill !== 'none' ? <rect x={0} y={0} width={w} height={h} rx={4} fill={fill} /> : null;
  }
}

function Marker({ id, x, y, size }: { id: string; x: number; y: number; size: number }) {
  const m = MARKER_MAP[id];
  if (!m) return null;
  const r = size / 2;
  if (m.kind === 'priority') {
    return (
      <g transform={`translate(${x},${y})`}>
        <circle cx={r} cy={r} r={r} fill={m.color} />
        <text x={r} y={r + size * 0.24} textAnchor="middle" fontSize={size * 0.66} fontWeight={700} fill="#fff" fontFamily={FONT_FAMILY}>
          {m.value}
        </text>
      </g>
    );
  }
  if (m.kind === 'progress') {
    const v = Number(m.value) / 4;
    const a = v * Math.PI * 2;
    const ex = r + (r - 2) * Math.sin(a);
    const ey = r - (r - 2) * Math.cos(a);
    return (
      <g transform={`translate(${x},${y})`}>
        <circle cx={r} cy={r} r={r - 0.75} fill="#fff" stroke={m.color} strokeWidth={1.5} />
        {v >= 1 ? (
          <circle cx={r} cy={r} r={r - 2} fill={m.color} />
        ) : v > 0 ? (
          <path d={`M${r},${r} L${r},2 A${r - 2},${r - 2} 0 ${v > 0.5 ? 1 : 0} 1 ${ex},${ey} Z`} fill={m.color} />
        ) : null}
      </g>
    );
  }
  return (
    <text x={x + r} y={y + size * 0.82} textAnchor="middle" fontSize={size * 0.88} fontFamily="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">
      {m.value}
    </text>
  );
}

function TaskBox({ x, y, size, status }: { x: number; y: number; size: number; status: string }) {
  const s = size * 0.86;
  const o = (size - s) / 2;
  return (
    <g transform={`translate(${x + o},${y + o})`} data-task-toggle="1" style={{ cursor: 'pointer' }}>
      <rect width={s} height={s} rx={s * 0.25} fill={status === 'done' ? '#16a34a' : status === 'doing' ? '#fff7e6' : '#fff'} stroke={status === 'done' ? '#16a34a' : status === 'doing' ? '#f59e0b' : '#94a3b8'} strokeWidth={1.6} />
      {status === 'done' && <path d={`M${s * 0.25},${s * 0.52} L${s * 0.43},${s * 0.7} L${s * 0.76},${s * 0.32}`} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
      {status === 'doing' && <rect x={s * 0.22} y={s * 0.22} width={s * 0.56} height={s * 0.56} rx={s * 0.12} fill="#f59e0b" />}
    </g>
  );
}

function NoteIcon({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  const k = size / 16;
  return (
    <g transform={`translate(${x},${y}) scale(${k})`} data-icon="note" style={{ cursor: 'pointer' }}>
      <rect x={2} y={1.5} width={12} height={13} rx={2} fill="#fff8db" stroke="#d4a017" strokeWidth={1.2} />
      <path d="M5 5.5h6M5 8h6M5 10.5h4" stroke={color === '#ffffff' ? '#8a6d00' : '#8a6d00'} strokeWidth={1.2} strokeLinecap="round" />
    </g>
  );
}

function LinkIcon({ x, y, size }: { x: number; y: number; size: number }) {
  const k = size / 16;
  return (
    <g transform={`translate(${x},${y}) scale(${k})`} data-icon="link" style={{ cursor: 'pointer' }}>
      <circle cx={8} cy={8} r={7.2} fill="#e0edff" stroke="#3b82f6" strokeWidth={1} />
      <path d="M7 9.2a2.2 2.2 0 0 0 3.1 0l1.6-1.6a2.2 2.2 0 0 0-3.1-3.1l-.6.6M9 6.8a2.2 2.2 0 0 0-3.1 0L4.3 8.4a2.2 2.2 0 0 0 3.1 3.1l.6-.6" fill="none" stroke="#2563eb" strokeWidth={1.3} strokeLinecap="round" />
    </g>
  );
}

const labelColor = (t: string) => {
  const cols = ['#e0e7ff:#3730a3', '#dcfce7:#166534', '#fef3c7:#92400e', '#fce7f3:#9d174d', '#cffafe:#155e75', '#ede9fe:#5b21b6'];
  let h = 0;
  for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return cols[Math.abs(h) % cols.length].split(':');
};

export interface NodeViewProps {
  n: LNode;
  selected: boolean;
  editing: boolean;
  dim?: boolean;
  dropHint?: 'child' | 'before' | 'after' | null;
  highlight?: boolean;
}

export const NodeView = memo(function NodeView({ n, selected, editing, dim, dropHint, highlight }: NodeViewProps) {
  const s = n.style;
  const c = n.content;
  const fs = s.fontSize;
  const fontWeight = s.bold ? 700 : 400;
  return (
    <g transform={`translate(${n.x},${n.y})`} data-topic={n.id} opacity={dim ? 0.14 : 1} style={{ transition: 'opacity .3s' }}>
      {selected && (
        <rect className="no-export" x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={Math.min(12, n.h / 2 + 4)} fill="none" stroke={ACCENT} strokeWidth={2.2} />
      )}
      {highlight && !selected && (
        <rect className="no-export" x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={10} fill="rgba(250,204,21,.25)" stroke="#eab308" strokeWidth={1.5} />
      )}
      {/* прозрачная область для кликов */}
      <rect className="no-export" x={0} y={0} width={n.w} height={n.h} fill="transparent" />
      {shapePath(n)}
      {c.image && <image href={n.topic.image!.src} x={c.image.x} y={c.image.y} width={c.image.w} height={c.image.h} preserveAspectRatio="xMidYMid meet" />}
      {c.task && <TaskBox {...c.task} status={n.topic.task!.status} />}
      {c.markers.map((m) => (
        <Marker key={m.id} {...m} />
      ))}
      {!editing && (
        <text
          x={c.textCX}
          y={c.textY}
          textAnchor="middle"
          fontSize={fs}
          fontWeight={fontWeight}
          fontStyle={s.italic ? 'italic' : undefined}
          textDecoration={s.strike || n.topic.task?.status === 'done' ? 'line-through' : undefined}
          fill={s.textColor}
          fontFamily={FONT_FAMILY}
          opacity={n.topic.task?.status === 'done' ? 0.6 : 1}
        >
          {n.lines.map((l, i) => (
            <tspan key={i} x={c.textCX} dy={i === 0 ? 0 : c.lineH}>
              {l || ' '}
            </tspan>
          ))}
        </text>
      )}
      {c.icons.map((ic) =>
        ic.kind === 'note' ? <NoteIcon key="n" {...ic} color={s.textColor} /> : <LinkIcon key="l" {...ic} />,
      )}
      {c.labels.map((l, i) => {
        const [bg, fg] = labelColor(l.text);
        return (
          <g key={i}>
            <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={l.h / 2} fill={bg} />
            <text x={l.x + l.w / 2} y={l.y + l.h * 0.7} textAnchor="middle" fontSize={fs * 0.72} fontWeight={700} fill={fg} fontFamily={FONT_FAMILY}>
              {l.text}
            </text>
          </g>
        );
      })}
      {c.meta && (
        <g>
          {c.meta.due && (
            <text x={c.meta.x} y={c.meta.y + c.meta.h * 0.75} fontSize={fs * 0.72} fontWeight={600} fill={dueColor(c.meta.due, n.topic.task?.status)} fontFamily={FONT_FAMILY}>
              {'⏰ ' + formatDue(c.meta.due)}
            </text>
          )}
          {(c.meta.progress ?? 0) > 0 && (
            <g transform={`translate(${c.meta.x + c.meta.w * 0.5},${c.meta.y + c.meta.h * 0.4})`}>
              <rect width={c.meta.w * 0.5} height={4} rx={2} fill="rgba(148,163,184,.35)" />
              <rect width={(c.meta.w * 0.5 * (c.meta.progress ?? 0)) / 100} height={4} rx={2} fill="#16a34a" />
            </g>
          )}
        </g>
      )}
      {dropHint && (
        <g className="no-export">
          {dropHint === 'child' && <rect x={-3} y={-3} width={n.w + 6} height={n.h + 6} rx={10} fill="rgba(255,74,43,.12)" stroke={ACCENT} strokeWidth={2} strokeDasharray="5 4" />}
          {dropHint === 'before' && <rect x={0} y={-8} width={n.w} height={4} rx={2} fill={ACCENT} />}
          {dropHint === 'after' && <rect x={0} y={n.h + 4} width={n.w} height={4} rx={2} fill={ACCENT} />}
        </g>
      )}
    </g>
  );
});

function dueColor(due: string, status?: string) {
  if (status === 'done') return '#16a34a';
  const today = new Date();
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (due < t) return '#e11d48';
  if (due === t) return '#f97316';
  return '#64748b';
}

export function Toggle({ n, visible }: { n: LNode; visible: boolean }) {
  if (!n.toggle) return null;
  const { x, y } = n.toggle;
  if (n.topic.collapsed) {
    const label = n.hidden > 99 ? '99+' : String(n.hidden);
    const w = Math.max(18, label.length * 7 + 8);
    return (
      <g data-toggle={n.id} transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }}>
        <rect x={-w / 2} y={-9} width={w} height={18} rx={9} fill="#fff" stroke={n.color} strokeWidth={1.5} />
        <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill={n.color} fontFamily={FONT_FAMILY}>
          {label}
        </text>
      </g>
    );
  }
  if (!visible) return null;
  return (
    <g className="no-export" data-toggle={n.id} transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }}>
      <circle r={8} fill="#fff" stroke={n.color} strokeWidth={1.5} />
      <path d="M-4 0 H4" stroke={n.color} strokeWidth={1.8} strokeLinecap="round" />
    </g>
  );
}

// ---------- Связи ----------

export function relGeometry(lay: LayoutResult, r: Relationship) {
  const a = lay.nodes.get(r.from);
  const b = lay.nodes.get(r.to);
  if (!a || !b) return null;
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const p0 = rectEdge(a, bc);
  const p1 = rectEdge(b, ac);
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = r.bend ?? Math.min(140, len * 0.35);
  const nx = -dy / len;
  const ny = dx / len;
  const c1 = { x: p0.x + dx * 0.25 + nx * bend, y: p0.y + dy * 0.25 + ny * bend };
  const c2 = { x: p0.x + dx * 0.75 + nx * bend, y: p0.y + dy * 0.75 + ny * bend };
  const mid = {
    x: 0.125 * p0.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p1.x,
    y: 0.125 * p0.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p1.y,
  };
  return { d: `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p1.x},${p1.y}`, mid, p1, c2 };
}

function rectEdge(n: LNode, toward: { x: number; y: number }) {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = n.w / 2 / Math.abs(dx || 1e-9);
  const sy = n.h / 2 / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function RelationshipView({ lay, r, selected, color }: { lay: LayoutResult; r: Relationship; selected: boolean; color: string }) {
  const g = relGeometry(lay, r);
  if (!g) return null;
  const col = r.color ?? color;
  const ang = Math.atan2(g.p1.y - g.c2.y, g.p1.x - g.c2.x);
  const ah = 10;
  const arrow = `M${g.p1.x},${g.p1.y} L${g.p1.x - ah * Math.cos(ang - 0.42)},${g.p1.y - ah * Math.sin(ang - 0.42)} L${g.p1.x - ah * Math.cos(ang + 0.42)},${g.p1.y - ah * Math.sin(ang + 0.42)} Z`;
  const label = r.label?.trim();
  const lw = label ? Math.min(220, label.length * 7.2 + 16) : 0;
  return (
    <g data-rel={r.id} style={{ cursor: 'pointer' }}>
      <path d={g.d} fill="none" stroke="transparent" strokeWidth={14} className="no-export" />
      {selected && <path className="no-export" d={g.d} fill="none" stroke={ACCENT} strokeOpacity={0.35} strokeWidth={7} />}
      <path d={g.d} fill="none" stroke={col} strokeWidth={1.8} strokeDasharray={r.dashed === false ? undefined : '6 5'} />
      <path d={arrow} fill={col} />
      {label && (
        <g transform={`translate(${g.mid.x},${g.mid.y})`}>
          <rect x={-lw / 2} y={-11} width={lw} height={22} rx={6} fill="#fff" stroke={col} strokeOpacity={0.4} />
          <text y={4.5} textAnchor="middle" fontSize={12.5} fill={col} fontFamily={FONT_FAMILY} fontWeight={600}>
            {label.length > 30 ? label.slice(0, 29) + '…' : label}
          </text>
        </g>
      )}
    </g>
  );
}

// ---------- Границы и итоги ----------

export function BoundaryView({ lay, b }: { lay: LayoutResult; b: Boundary }) {
  const bb = subtreeBounds(lay, b.topicId);
  const n = lay.nodes.get(b.topicId);
  if (!bb || !n) return null;
  const pad = 10;
  const col = b.color ?? n.color;
  const label = b.label?.trim();
  return (
    <g data-boundary={b.id}>
      <rect x={bb.x - pad} y={bb.y - pad} width={bb.w + pad * 2} height={bb.h + pad * 2} rx={14} fill={col} fillOpacity={0.07} stroke={col} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="7 5" />
      {label && (
        <g transform={`translate(${bb.x - pad},${bb.y - pad - 24})`}>
          <rect width={Math.min(240, label.length * 7.5 + 18)} height={22} rx={6} fill={col} />
          <text x={9} y={15.5} fontSize={12.5} fontWeight={700} fill="#fff" fontFamily={FONT_FAMILY}>
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

export function SummaryView({ lay, s, vertical }: { lay: LayoutResult; s: Summary; vertical: boolean }) {
  const bb = subtreeBounds(lay, s.topicId);
  const n = lay.nodes.get(s.topicId);
  if (!bb || !n) return null;
  const col = s.color ?? n.color;
  const text = s.text || 'Итог';
  const tw = Math.min(260, text.length * 8 + 24);
  if (vertical) {
    const y = bb.y + bb.h + 10;
    const d = `M${bb.x},${y} Q${bb.x},${y + 10} ${bb.x + 10},${y + 10} H${bb.x + bb.w / 2 - 8} Q${bb.x + bb.w / 2},${y + 10} ${bb.x + bb.w / 2},${y + 18} Q${bb.x + bb.w / 2},${y + 10} ${bb.x + bb.w / 2 + 8},${y + 10} H${bb.x + bb.w - 10} Q${bb.x + bb.w},${y + 10} ${bb.x + bb.w},${y}`;
    return (
      <g data-summary={s.id}>
        <path d={d} fill="none" stroke={col} strokeWidth={1.8} />
        <g transform={`translate(${bb.x + bb.w / 2 - tw / 2},${y + 26})`}>
          <rect width={tw} height={28} rx={8} fill="#fff" stroke={col} strokeWidth={1.5} />
          <text x={tw / 2} y={18.5} textAnchor="middle" fontSize={13.5} fontWeight={600} fill={col} fontFamily={FONT_FAMILY}>{text}</text>
        </g>
      </g>
    );
  }
  const dir = n.side;
  const x = dir > 0 ? bb.x + bb.w + 12 : bb.x - 12;
  const d = bracePath(x, bb.y, bb.y + bb.h, bb.y + bb.h / 2, dir === 1 ? -1 : 1, 10);
  const tx = dir > 0 ? x + 18 : x - 18 - tw;
  return (
    <g data-summary={s.id}>
      <path d={d} fill="none" stroke={col} strokeWidth={1.8} />
      <g transform={`translate(${tx},${bb.y + bb.h / 2 - 14})`}>
        <rect width={tw} height={28} rx={8} fill="#fff" stroke={col} strokeWidth={1.5} />
        <text x={tw / 2} y={18.5} textAnchor="middle" fontSize={13.5} fontWeight={600} fill={col} fontFamily={FONT_FAMILY}>{text}</text>
      </g>
    </g>
  );
}
