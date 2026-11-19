/**
 * Альтернативные иконки приложения («S-ветвь» в других цветах, см. scripts/brand.mjs):
 * iPhone — наборы AppIcon-<Имя>.appiconset (1024×1024 без прозрачности), Android — mipmap ic_launcher_<id>
 * (обычная, круглая, слои адаптивной), превью для настроек — public/app-icons/<id>.png.
 * Запуск: node scripts/app-icons.mjs
 */
import { Resvg } from '@resvg/resvg-js';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** id → имя набора iPhone, фон (3 точки градиента), цвет буквы (белый или градиент) */
const VARIANTS = [
  { id: 'default', ios: null, bg: ['#5AC8FA', '#007AFF', '#3634A3'] },
  { id: 'dark', ios: 'AppIcon-Dark', bg: ['#3A3A3C', '#1C1C1E', '#000000'], glyph: ['#5AC8FA', '#0A84FF'], sheen: 0.1 },
  { id: 'light', ios: 'AppIcon-Light', bg: ['#FFFFFF', '#F2F2F7', '#D8DCE6'], glyph: ['#5AC8FA', '#007AFF'], sheen: 0 },
  { id: 'green', ios: 'AppIcon-Green', bg: ['#A3F0A8', '#34C759', '#0F766E'] },
  { id: 'sunset', ios: 'AppIcon-Sunset', bg: ['#FFD60A', '#FF9500', '#FF2D55'] },
  { id: 'purple', ios: 'AppIcon-Purple', bg: ['#E3A8FF', '#AF52DE', '#4B2A9E'] },
];

const PATH = 'M342 166 C330 126 286 112 250 116 C196 122 170 164 184 200 C200 240 256 246 290 262 C336 284 346 330 318 366 C292 398 228 400 186 366';

function defs(v) {
  const [a, b, c] = v.bg;
  const g = v.glyph
    ? `<linearGradient id="gl" gradientUnits="userSpaceOnUse" x1="170" y1="110" x2="350" y2="400"><stop offset="0" stop-color="${v.glyph[0]}"/><stop offset="1" stop-color="${v.glyph[1]}"/></linearGradient>`
    : '';
  return `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${v.sheen ?? 0.24}"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>${g}`;
}
const glyph = (v) => {
  const ink = v.glyph ? 'url(#gl)' : '#fff';
  return `<path fill="none" stroke="${ink}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" d="${PATH}"/><g fill="${ink}"><circle cx="346" cy="160" r="30"/><circle cx="178" cy="362" r="30"/></g>`;
};
const svg = (v, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${defs(v)}</defs>${body}</svg>`;
const scaled = (v, k) => `<g transform="translate(262 258) scale(${k}) translate(-262 -258)">${glyph(v)}</g>`;

const ICON = (v) => svg(v, `<rect width="512" height="512" rx="114" fill="url(#g)"/><rect width="512" height="512" rx="114" fill="url(#sheen)"/>${glyph(v)}`);
const FULL = (v) => svg(v, `<rect width="512" height="512" fill="url(#g)"/><rect width="512" height="512" fill="url(#sheen)"/>${scaled(v, 0.78)}`);
const ROUND = (v) => svg(v, `<circle cx="256" cy="256" r="256" fill="url(#g)"/><circle cx="256" cy="256" r="256" fill="url(#sheen)"/>${scaled(v, 0.82)}`);
const BG = (v) => svg(v, `<rect width="512" height="512" fill="url(#g)"/><rect width="512" height="512" fill="url(#sheen)"/>`);
const FG = (v) => svg(v, scaled(v, 0.92));

const render = (s, w) => new Resvg(s, { fitTo: { mode: 'width', value: w }, background: 'rgba(0,0,0,0)' }).render();
const png = (s, w) => render(s, w).asPng();

// ---------- PNG без альфа-канала (App Store не принимает иконки с прозрачностью) ----------
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function pngRgb(s, w) {
  const img = render(s, w);
  const { width, height, pixels } = img;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = pixels[i + 3] / 255;
      const o = y * (width * 3 + 1) + 1 + x * 3;
      // на белом (прозрачных точек в полной иконке нет)
      raw[o] = Math.round(pixels[i] * a + 255 * (1 - a));
      raw[o + 1] = Math.round(pixels[i + 1] * a + 255 * (1 - a));
      raw[o + 2] = Math.round(pixels[i + 2] * a + 255 * (1 - a));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const root = process.cwd();
const res = join(root, 'android', 'app', 'src', 'main', 'res');
const assets = join(root, 'ios', 'App', 'App', 'Assets.xcassets');
const previews = join(root, 'public', 'app-icons');
mkdirSync(previews, { recursive: true });
const dens = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const adaptive = (name) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background>
        <inset android:drawable="@mipmap/${name}_background" android:inset="16.7%" />
    </background>
    <foreground>
        <inset android:drawable="@mipmap/${name}_foreground" android:inset="16.7%" />
    </foreground>
</adaptive-icon>
`;

for (const v of VARIANTS) {
  writeFileSync(join(previews, `${v.id}.png`), png(ICON(v), 168));
  if (v.id === 'default') continue; // основная иконка — scripts/brand.mjs
  // iPhone
  const set = join(assets, `${v.ios}.appiconset`);
  mkdirSync(set, { recursive: true });
  writeFileSync(join(set, `${v.ios}.png`), pngRgb(FULL(v), 1024));
  writeFileSync(
    join(set, 'Contents.json'),
    JSON.stringify({ images: [{ idiom: 'universal', size: '1024x1024', filename: `${v.ios}.png`, platform: 'ios' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n',
  );
  // Android
  const name = `ic_launcher_${v.id}`;
  for (const [d, n] of Object.entries(dens)) {
    const dir = join(res, `mipmap-${d}`);
    if (!existsSync(dir)) continue;
    writeFileSync(join(dir, `${name}.png`), png(ICON(v), n));
    writeFileSync(join(dir, `${name}_round.png`), png(ROUND(v), n));
    writeFileSync(join(dir, `${name}_foreground.png`), png(FG(v), n));
    writeFileSync(join(dir, `${name}_background.png`), png(BG(v), n));
  }
  writeFileSync(join(res, 'mipmap-anydpi-v26', `${name}.xml`), adaptive(name));
  writeFileSync(join(res, 'mipmap-anydpi-v26', `${name}_round.xml`), adaptive(name));
}
console.log('иконки готовы:', VARIANTS.map((v) => v.id).join(', '));
