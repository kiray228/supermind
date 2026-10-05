import type { StructureType } from '../types';

export function StructureIcon({ id, size = 44 }: { id: StructureType; size?: number }) {
  const c = 'var(--accent)';
  const l = { stroke: 'currentColor', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' as const };
  const box = (x: number, y: number, w = 10, h = 5, main = false) => (
    <rect x={x} y={y} width={w} height={h} rx={1.5} fill={main ? c : 'currentColor'} opacity={main ? 1 : 0.55} />
  );
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 64 40">
      {id === 'map' && (
        <>
          <path d="M32 20 C40 20 40 8 48 8 M32 20 H48 M32 20 C40 20 40 32 48 32 M32 20 C24 20 24 8 16 8 M32 20 C24 20 24 32 16 32" {...l} />
          {box(48, 5.5)} {box(48, 17.5)} {box(48, 29.5)} {box(6, 5.5)} {box(6, 29.5)} {box(24, 16.5, 16, 7, true)}
        </>
      )}
      {id === 'logic-right' && (
        <>
          <path d="M18 20 H24 V8 H34 M24 20 H34 M24 20 V32 H34" {...l} />
          {box(4, 16.5, 14, 7, true)} {box(34, 5.5)} {box(34, 17.5)} {box(34, 29.5)} {box(50, 5.5, 10)}
        </>
      )}
      {id === 'logic-left' && (
        <>
          <path d="M46 20 H40 V8 H30 M40 20 H30 M40 20 V32 H30" {...l} />
          {box(46, 16.5, 14, 7, true)} {box(20, 5.5)} {box(20, 17.5)} {box(20, 29.5)} {box(4, 5.5, 10)}
        </>
      )}
      {id === 'org' && (
        <>
          <path d="M32 11 V17 M12 17 H52 M12 17 V23 M32 17 V23 M52 17 V23" {...l} />
          {box(24, 3, 16, 8, true)} {box(6, 23, 12)} {box(26, 23, 12)} {box(46, 23, 12)}
        </>
      )}
      {id === 'tree' && (
        <>
          <path d="M14 10 V30 H20 M14 20 H20 M44 10 V20 H50" {...l} />
          {box(8, 3, 14, 7, true)} {box(20, 17.5)} {box(20, 27.5)} {box(38, 3, 14, 7, true)} {box(50, 17.5, 10)}
        </>
      )}
      {id === 'timeline' && (
        <>
          <path d="M8 20 H58 M22 20 V30 M38 20 V10 M52 20 V30" {...l} />
          {box(2, 16.5, 10, 7, true)} {box(17, 29)} {box(33, 5)} {box(47, 29)}
        </>
      )}
      {id === 'fishbone' && (
        <>
          <path d="M6 20 H50 M18 20 L12 8 M18 20 L12 32 M34 20 L28 8 M34 20 L28 32" {...l} />
          {box(50, 16.5, 12, 7, true)} {box(6, 3)} {box(6, 32)} {box(22, 3)} {box(22, 32)}
        </>
      )}
      {id === 'brace' && (
        <>
          <path d="M26 6 Q22 6 22 10 V17 Q22 20 19 20 Q22 20 22 23 V30 Q22 34 26 34" {...l} />
          {box(4, 16.5, 14, 7, true)} {box(28, 5.5, 14)} {box(28, 17.5, 14)} {box(28, 29.5, 14)}
        </>
      )}
    </svg>
  );
}
