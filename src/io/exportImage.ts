/**
 * Экспорт отрисованной карты: SVG, PNG, PDF.
 * Карта — inline <svg> с группой <g data-export-root>; служебные элементы помечены class="no-export".
 */
import { isIOS } from './download';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
export const EXPORT_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'color', 'flood-color', 'lighting-color'] as const;

/** Подставить вычисленные цвета там, где в атрибутах/стилях используются CSS-переменные */
function resolveVars(live: Element, copy: Element) {
  const needs =
    COLOR_ATTRS.some((a) => live.getAttribute(a)?.includes('var(')) || (live.getAttribute('style') ?? '').includes('var(');
  if (needs) {
    const cs = getComputedStyle(live);
    for (const a of COLOR_ATTRS) {
      const v = live.getAttribute(a);
      if (v?.includes('var(')) copy.setAttribute(a, cs.getPropertyValue(a) || 'none');
    }
    const style = live.getAttribute('style') ?? '';
    if (style.includes('var(')) {
      const kept: string[] = [];
      for (const decl of style.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim();
        const val = decl.slice(i + 1).trim();
        if (!prop) continue;
        kept.push(`${prop}: ${val.includes('var(') ? cs.getPropertyValue(prop) : val}`);
      }
      copy.setAttribute('style', kept.join('; '));
    }
  }
  const lc = live.children;
  const cc = copy.children;
  for (let i = 0; i < lc.length && i < cc.length; i++) resolveVars(lc[i], cc[i]);
}

function getExportRoot(svg: SVGSVGElement): SVGGElement {
  const g = svg.querySelector<SVGGElement>('g[data-export-root]');
  if (!g) throw new Error('Не найдена карта для экспорта');
  return g;
}

/** Границы группы в её локальных координатах (без pan/zoom-трансформа), без .no-export */
function measure(g: SVGGElement): DOMRect | { x: number; y: number; width: number; height: number } {
  const hidden = Array.from(g.querySelectorAll<SVGElement>('.no-export'));
  const prev = hidden.map((el) => el.style.display);
  hidden.forEach((el) => (el.style.display = 'none'));
  try {
    return g.getBBox();
  } catch {
    return { x: 0, y: 0, width: 0, height: 0 };
  } finally {
    hidden.forEach((el, i) => (el.style.display = prev[i]));
  }
}

export function buildExportSvg(
  svg: SVGSVGElement,
  background: string,
  padding = 40,
): { svg: string; width: number; height: number } {
  const live = getExportRoot(svg);
  const bb = measure(live);
  const bw = bb.width > 0 ? bb.width : 100;
  const bh = bb.height > 0 ? bb.height : 100;
  const x0 = (bb.width > 0 ? bb.x : 0) - padding;
  const y0 = (bb.height > 0 ? bb.y : 0) - padding;
  const width = Math.ceil(bw + padding * 2);
  const height = Math.ceil(bh + padding * 2);

  const group = live.cloneNode(true) as SVGGElement;
  resolveVars(live, group);
  group.removeAttribute('transform');
  group.removeAttribute('data-export-root');
  group.querySelectorAll('.no-export, foreignObject, script').forEach((el) => el.remove());

  const out = document.createElementNS(SVG_NS, 'svg');
  // xmlns добавит XMLSerializer (элемент создан в SVG-неймспейсе)
  out.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', XLINK_NS);
  out.setAttribute('version', '1.1');
  out.setAttribute('width', String(width));
  out.setAttribute('height', String(height));
  out.setAttribute('viewBox', `${x0} ${y0} ${width} ${height}`);
  out.setAttribute('font-family', EXPORT_FONT);

  // <defs> вне группы (стрелки, градиенты, клипы)
  for (const d of Array.from(svg.querySelectorAll('defs'))) {
    if (live.contains(d)) continue;
    const dc = d.cloneNode(true) as Element;
    dc.querySelectorAll('.no-export').forEach((el) => el.remove());
    out.appendChild(dc);
  }
  const bg = (background ?? '').trim();
  if (bg && bg !== 'transparent' && bg !== 'none') {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x0));
    rect.setAttribute('y', String(y0));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('fill', bg);
    out.appendChild(rect);
  }
  out.appendChild(group);
  const str = new XMLSerializer().serializeToString(out);
  return { svg: str, width, height };
}

export function exportSvgBlob(svg: SVGSVGElement, bg: string): Blob {
  const { svg: s } = buildExportSvg(svg, bg);
  return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', s], { type: 'image/svg+xml;charset=utf-8' });
}

// ---------------------------------------------------------------------
// Растеризация
// ---------------------------------------------------------------------

const MAX_SIDE = 16384;
/** ~268 млн пикселей (desktop); на iOS — 16.7 млн (лимит площади canvas) */
function maxArea(): number {
  return isIOS() ? 16_777_216 : 268_435_456;
}

function fitScale(w: number, h: number, scale: number): number {
  let s = scale;
  s = Math.min(s, MAX_SIDE / w, MAX_SIDE / h);
  s = Math.min(s, Math.sqrt(maxArea() / (w * h)));
  return Math.max(0.05, s);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось отрисовать карту'));
    img.src = url;
  });
}

async function svgToImage(svgText: string): Promise<HTMLImageElement> {
  const blobUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    return await loadImage(blobUrl);
  } catch {
    // запасной путь — data URL
    return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText));
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
}

type Built = ReturnType<typeof buildExportSvg>;

async function renderCanvas(built: Built, bg: string, scale: number): Promise<HTMLCanvasElement> {
  const s = fitScale(built.width, built.height, scale);
  const cw = Math.max(1, Math.floor(built.width * s));
  const ch = Math.max(1, Math.floor(built.height * s));
  const img = await svgToImage(built.svg);
  try {
    await img.decode();
  } catch {
    /* уже загружено */
  }
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Недостаточно памяти для экспорта изображения');
  const draw = () => {
    ctx.clearRect(0, 0, cw, ch);
    const b = (bg ?? '').trim();
    if (b && b !== 'transparent' && b !== 'none') {
      ctx.fillStyle = b;
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.drawImage(img, 0, 0, cw, ch);
  };
  draw();
  // Safari иногда рисует SVG до декодирования вложенных <image> — перерисовываем
  if (built.svg.includes('<image')) {
    await new Promise((r) => setTimeout(r, 150));
    draw();
  }
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось создать изображение'))), type);
  });
}

export async function exportPng(svg: SVGSVGElement, bg: string, scale = 2): Promise<Blob> {
  const canvas = await renderCanvas(buildExportSvg(svg, bg), bg, scale);
  try {
    return await canvasToBlob(canvas);
  } finally {
    canvas.width = canvas.height = 0; // освободить память (важно для iOS)
  }
}

/** Максимальный размер страницы PDF — 14400 pt (200 дюймов) */
const PDF_MAX = 14400;

export async function exportPdf(svg: SVGSVGElement, bg: string, title: string): Promise<Blob> {
  const built = buildExportSvg(svg, bg);
  const { width, height } = built;
  // растр не больше ~4000 px по длинной стороне (но не меньше 2x для мелких карт)
  const scale = Math.max(1, Math.min(2, 4000 / Math.max(width, height)));
  const canvas = await renderCanvas(built, bg, scale);
  try {
    const k = Math.min(1, PDF_MAX / Math.max(width, height));
    const pw = Math.max(72, width * k);
    const ph = Math.max(72, height * k);
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({
      orientation: pw >= ph ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [pw, ph],
      compress: true,
    });
    pdf.setProperties({ title: title || 'Карта', creator: 'SuperMind' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    // вписать с сохранением пропорций
    const fit = Math.min(pageW / width, pageH / height);
    const iw = width * fit;
    const ih = height * fit;
    const b = (bg ?? '').trim();
    if (b && b !== 'transparent' && b !== 'none' && /^#[0-9a-f]{6}$/i.test(b)) {
      pdf.setFillColor(b);
      pdf.rect(0, 0, pageW, pageH, 'F');
    }
    pdf.addImage(canvas, 'PNG', (pageW - iw) / 2, (pageH - ih) / 2, iw, ih, undefined, 'FAST');
    return pdf.output('blob');
  } finally {
    canvas.width = canvas.height = 0;
  }
}
