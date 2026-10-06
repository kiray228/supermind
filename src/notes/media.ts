/** Фото, голосовые записи и распознавание речи для заметок */
import { MAX_AUDIO_SEC } from './model';

// ---------- Изображения ----------

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось открыть изображение'));
    img.src = url;
  });
}

/** Уменьшить фото до max px по большей стороне и сжать в JPEG */
export async function imageFileToDataUrl(file: Blob, max = 1600, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error('Пустое изображение');
    const k = Math.min(1, max / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas недоступен');
    // прозрачный фон PNG в JPEG стал бы чёрным
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- data URL ----------

export function dataUrlToBlob(dataUrl: string): Blob {
  const i = dataUrl.indexOf(',');
  const head = dataUrl.slice(5, i);
  const mime = head.split(';')[0] || 'application/octet-stream';
  const data = dataUrl.slice(i + 1);
  if (!head.includes('base64')) return new Blob([decodeURIComponent(data)], { type: mime });
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

// ---------- Запись голоса ----------

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** mp4 (AAC) играется везде, включая iPhone; иначе webm/opus */
export function pickAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac', 'audio/ogg;codecs=opus'])
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}

export interface Recording {
  /** закончить и получить запись */
  stop(): Promise<{ src: string; duration: number }>;
  cancel(): void;
}

export async function startRecording(opts: { onTick?: (sec: number) => void; onLimit?: () => void } = {}): Promise<Recording> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    throw new Error(name === 'NotAllowedError' ? 'Нет доступа к микрофону. Разрешите его в настройках браузера.' : name === 'NotFoundError' ? 'Микрофон не найден.' : 'Не удалось включить микрофон.');
  }
  const mimeType = pickAudioMime();
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const started = performance.now();
  const elapsed = () => (performance.now() - started) / 1000;
  const tick = setInterval(() => {
    const s = elapsed();
    opts.onTick?.(s);
    if (s >= MAX_AUDIO_SEC) {
      clearInterval(tick);
      opts.onLimit?.();
    }
  }, 250);
  const release = () => {
    clearInterval(tick);
    stream.getTracks().forEach((t) => t.stop());
  };
  rec.start(1000);
  return {
    stop: () =>
      new Promise((resolve, reject) => {
        const duration = Math.min(MAX_AUDIO_SEC, elapsed());
        rec.onstop = async () => {
          release();
          try {
            const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
            if (!blob.size) throw new Error('Запись пустая');
            resolve({ src: await blobToDataUrl(blob), duration });
          } catch (e) {
            reject(e);
          }
        };
        if (rec.state === 'inactive') rec.onstop(new Event('stop'));
        else rec.stop();
      }),
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      release();
    },
  };
}

// ---------- Распознавание речи ----------

interface SRAlt {
  transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  [i: number]: SRAlt;
}
interface SREvent {
  results: { readonly length: number; [i: number]: SRResult };
}
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SR;

function ctor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => typeof window !== 'undefined' && !!ctor();

export interface Recognizer {
  stop(): void;
  abort(): void;
}

/** Непрерывное распознавание (ru-RU): onText получает весь окончательный текст и промежуточный хвост */
export function startRecognition(opts: { onText: (final: string, interim: string) => void; onEnd?: () => void; onError?: (msg: string) => void }): Recognizer | null {
  const C = ctor();
  if (!C) return null;
  const r = new C();
  r.lang = 'ru-RU';
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e) => {
    let fin = '';
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      const t = res[0]?.transcript ?? '';
      if (res.isFinal) fin += (fin && !/^\s/.test(t) ? ' ' : '') + t;
      else interim += t;
    }
    opts.onText(fin.replace(/\s+/g, ' ').trim(), interim.trim());
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    opts.onError?.(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Нет доступа к распознаванию речи' : e.error === 'network' ? 'Распознаванию речи нужен интернет' : 'Ошибка распознавания: ' + e.error);
  };
  r.onend = () => opts.onEnd?.();
  try {
    r.start();
  } catch {
    return null;
  }
  return {
    stop: () => {
      try {
        r.stop();
      } catch {
        /* уже остановлено */
      }
    },
    abort: () => {
      r.onend = null;
      try {
        r.abort();
      } catch {
        /* уже остановлено */
      }
    },
  };
}
