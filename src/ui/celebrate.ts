/**
 * Маленький праздник: конфетти на ~1 секунду + тактильный отклик.
 * Без библиотек (canvas), не перехватывает нажатия. При «уменьшить движение» — без анимации.
 * Отключается в Настройках («Анимации успехов») — флаг хранится на устройстве.
 */
import { haptic } from '../editor/touch';

const KEY = 'sm-celebrate';
const COLORS = ['#ff9f0a', '#ff375f', '#30d158', '#0a84ff', '#bf5af2', '#ffd60a', '#64d2ff'];
const DURATION = 1100;

export function celebrationsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setCelebrations(on: boolean) {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, '0');
  } catch {
    /* хранилище недоступно */
  }
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  w: number;
  h: number;
  c: string;
}

let canvas: HTMLCanvasElement | null = null;
let bits: Bit[] = [];
let t0 = 0;
let raf = 0;
let endAt = 0;

function frame(now: number) {
  const cv = canvas;
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return;
  const dt = Math.min(0.05, (now - (t0 || now)) / 1000) || 0.016;
  t0 = now;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  const h = window.innerHeight;
  let alive = 0;
  for (const b of bits) {
    b.vy += 900 * dt;
    b.vx *= 0.985;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.r += b.vr * dt;
    if (b.y > h + 20) continue;
    alive++;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.r);
    ctx.globalAlpha = Math.max(0, Math.min(1, endAt > now ? 1 : 1 - (now - endAt) / 300));
    ctx.fillStyle = b.c;
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2)) + 1);
    ctx.restore();
  }
  if (alive && now < endAt + 300) raf = requestAnimationFrame(frame);
  else stopBurst();
}

function stopBurst() {
  cancelAnimationFrame(raf);
  canvas?.remove();
  canvas = null;
  bits = [];
  t0 = 0;
}

/** Конфетти из точки (по умолчанию — верхняя треть экрана по центру) */
function burst(x: number, y: number, count: number) {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    document.body.appendChild(canvas);
    raf = requestAnimationFrame(frame);
  }
  endAt = performance.now() + DURATION;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const v = 380 + Math.random() * 420;
    bits.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 14,
      w: 6 + Math.random() * 5,
      h: 8 + Math.random() * 6,
      c: COLORS[i % COLORS.length],
    });
  }
}

/** Отпраздновать успех. big — для уровня и вех серии */
export function celebrate(opts: { x?: number; y?: number; big?: boolean } = {}) {
  if (typeof window === 'undefined' || !celebrationsOn()) return;
  haptic(opts.big ? 24 : 14);
  if (reducedMotion() || document.visibilityState !== 'visible') return;
  const x = opts.x ?? window.innerWidth / 2;
  const y = opts.y ?? window.innerHeight * 0.38;
  burst(x, y, opts.big ? 110 : 60);
}

/** Выполнена задача: праздник изредка (≈ 1 из 6) и всегда — если задача ждала больше недели */
export function celebrateTask(overdueDays: number) {
  if (overdueDays > 7 || Math.random() < 1 / 6) celebrate();
}
