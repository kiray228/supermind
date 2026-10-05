export const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Arial, sans-serif";

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

function getCtx() {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  return ctx!;
}

export function fontString(size: number, bold: boolean, italic = false) {
  return `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px ${FONT_FAMILY}`;
}

export function textWidth(text: string, font: string): number {
  const key = font + '|' + text;
  let w = cache.get(key);
  if (w === undefined) {
    const c = getCtx();
    c.font = font;
    w = c.measureText(text).width;
    if (cache.size > 20000) cache.clear();
    cache.set(key, w);
  }
  return w;
}

/** Перенос текста по словам с ограничением ширины */
export function wrapText(text: string, font: string, maxWidth: number): string[] {
  const out: string[] = [];
  const paragraphs = (text || '').split('\n');
  for (const p of paragraphs) {
    if (!p) {
      out.push('');
      continue;
    }
    const words = p.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const cand = line + w;
      if (textWidth(cand, font) <= maxWidth || !line.trim()) {
        if (textWidth(cand, font) > maxWidth && !line.trim()) {
          // слишком длинное слово — режем по символам
          let chunk = '';
          for (const ch of cand) {
            if (textWidth(chunk + ch, font) > maxWidth && chunk) {
              out.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = cand;
      } else {
        out.push(line.trimEnd());
        line = w.trimStart();
      }
    }
    out.push(line.trimEnd());
  }
  return out.length ? out : [''];
}
