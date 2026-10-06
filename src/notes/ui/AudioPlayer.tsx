import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import { fmtDuration } from '../model';
import { dataUrlToBlob } from '../media';

const SPEEDS = [1, 1.5, 2];

/** Плеер голосовой записи: data URL → blob (надёжнее на iPhone), своя шкала и скорость */
export function AudioPlayer({ src, duration }: { src: string; duration?: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(duration ?? 0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let u: string | null = null;
    try {
      u = URL.createObjectURL(dataUrlToBlob(src));
    } catch {
      u = null;
    }
    setUrl(u ?? src);
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [src]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  };

  const total = Number.isFinite(dur) && dur > 0 ? dur : duration ?? 0;
  const pct = total ? Math.min(100, (time / total) * 100) : 0;

  return (
    <div className="nt-player">
      <button className={`nt-play${playing ? ' on' : ''}`} onClick={toggle} aria-label={playing ? 'Пауза' : 'Слушать'}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <input
        type="range"
        className="nt-seek"
        min={0}
        max={1000}
        value={Math.round(pct * 10)}
        style={{ '--p': pct + '%' } as CSSProperties}
        onChange={(e) => {
          const a = audio.current;
          if (!a || !total) return;
          a.currentTime = (Number(e.target.value) / 1000) * total;
          setTime(a.currentTime);
        }}
        aria-label="Позиция"
      />
      <span className="nt-ptime">{fmtDuration(playing || time ? time : total)}</span>
      <button className="nt-speed" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}>
        {speed}×
      </button>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setTime(0);
          }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDur(d);
            e.currentTarget.playbackRate = speed;
          }}
        />
      )}
    </div>
  );
}
