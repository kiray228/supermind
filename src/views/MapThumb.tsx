/** Миниатюра карты в списке: настоящая центральная тема и основные ветви (из DocMeta.preview). */
import type { DocPreview } from '../types';


/** Обрезать подпись под ширину плашки (примерно, без измерения шрифта) */
const fit = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function MapThumb({ preview, accent, big }: { preview?: DocPreview; accent: string; big?: boolean }) {
  if (!preview) return <Placeholder accent={accent} />;
  // крупная миниатюра — шире: подписи ветвей помещаются целиком
  const W = big ? 330 : 240;
  const H = big ? 170 : 140;
  const kids = preview.k;
  const horizontal = preview.s === 'org' || preview.s === 'timeline';
  const root = fit(preview.r, big ? 22 : 16);
  const rw = Math.min(W * 0.36, 22 + root.length * 6.6);
  const rh = 26;

  if (horizontal) {
    // орг-структура и шкала: корень сверху, ветви рядом внизу
    const row = kids.slice(0, 4);
    const cw = row.length ? Math.min(70, (W - 16 - (row.length - 1) * 6) / row.length) : 0;
    const total = row.length * cw + (row.length - 1) * 6;
    const x0 = (W - total) / 2;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="map-thumb" aria-hidden>
        {row.map((k, i) => {
          const cx = x0 + i * (cw + 6) + cw / 2;
          return <path key={`l${i}`} d={`M${W / 2} ${44} V${66} H${cx} V${86}`} stroke={k.c} strokeOpacity=".55" strokeWidth="2" fill="none" />;
        })}
        <Pill x={(W - rw) / 2} y={18} w={rw} h={rh} fill={accent} text={root} strong />
        {row.map((k, i) => (
          <Pill key={i} x={x0 + i * (cw + 6)} y={86} w={cw} h={22} fill={k.c} text={fit(k.t, Math.max(4, Math.floor(cw / 6)))} />
        ))}
      </svg>
    );
  }

  const two = preview.s === 'map';
  const right = kids.filter((k) => !k.l);
  const left = two ? kids.filter((k) => k.l) : [];
  const leftRoot = preview.s === 'logic-left';
  // корень: по центру (карта) или у края (логическая схема, дерево и т. п.)
  const rx = two ? (W - rw) / 2 : leftRoot ? W - rw - 8 : 8;
  const ry = H / 2 - rh / 2;
  const kw = two ? Math.min(big ? 100 : 80, (W - rw) / 2 - 14) : Math.min(140, W - rw - 40);
  const side = (list: typeof kids, toLeft: boolean) => {
    const n = list.length;
    const step = n > 1 ? Math.min(30, (H - 26) / (n - 1)) : 0;
    return list.map((k, i) => {
      const cy = H / 2 + (i - (n - 1) / 2) * step;
      const kx = toLeft ? 6 : W - kw - 6;
      const sx = toLeft ? rx : rx + rw;
      const ex = toLeft ? kx + kw : kx;
      const mx = (sx + ex) / 2;
      return { k, cy, kx, d: `M${sx} ${H / 2} C${mx} ${H / 2} ${mx} ${cy} ${ex} ${cy}` };
    });
  };
  const items = [...side(leftRoot ? kids : right, leftRoot), ...side(left, true)];
  const chars = Math.max(5, Math.floor((kw - 10) / 5.6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="map-thumb" aria-hidden>
      {items.map((it, i) => (
        <path key={`l${i}`} d={it.d} stroke={it.k.c} strokeOpacity=".6" strokeWidth="2" fill="none" />
      ))}
      <Pill x={rx} y={ry} w={rw} h={rh} fill={accent} text={root} strong />
      {items.map((it, i) => (
        <Pill key={i} x={it.kx} y={it.cy - 10} w={kw} h={20} fill={it.k.c} text={fit(it.k.t, chars)} />
      ))}
      {preview.more ? (
        <text x={W - 8} y={H - 4} textAnchor="end" className="map-thumb-more">
          +{preview.more}
        </text>
      ) : null}
    </svg>
  );
}

function Pill({ x, y, w, h, fill, text, strong }: { x: number; y: number; w: number; h: number; fill: string; text: string; strong?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} fillOpacity={strong ? 1 : 0.16} stroke={strong ? 'none' : fill} strokeOpacity=".55" strokeWidth="1" />
      <text x={x + w / 2} y={y + h / 2} dy=".35em" textAnchor="middle" className={strong ? 'map-thumb-root' : 'map-thumb-kid'}>
        {text}
      </text>
    </g>
  );
}

/** Карта без миниатюры (зашифрованная или ещё не построена) */
function Placeholder({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 120 70" className="map-thumb map-thumb-ph" aria-hidden style={{ color: accent }}>
      <path d="M60 35 C75 35 75 15 92 15 M60 35 H95 M60 35 C75 35 75 55 92 55 M60 35 C45 35 45 15 28 15 M60 35 C45 35 45 55 28 55" stroke="currentColor" strokeOpacity=".5" strokeWidth="2" fill="none" />
      <rect x="44" y="28" width="32" height="14" rx="5" fill="currentColor" />
      {[[92, 10], [95, 30], [92, 50], [8, 10], [8, 50]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="20" height="9" rx="3" fill="currentColor" opacity=".25" />
      ))}
    </svg>
  );
}
