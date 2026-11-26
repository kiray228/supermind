/** Объёмная переливающаяся сфера голосового помощника: кнопка в панели вкладок и в окне голосовой команды */
export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

export function Orb({ size = 56, state = 'idle', className = '' }: { size?: number; state?: OrbState; className?: string }) {
  return (
    <span className={`orb is-${state} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="orb-swirl" />
      <span className="orb-swirl orb-s2" />
      <span className="orb-core" />
      <span className="orb-shine" />
    </span>
  );
}
