/**
 * Логотип SuperMind «Рост» — дерево мыслей на изумрудном градиенте.
 * Генерирует все иконки (веб, PWA, Android) и заставки:  node scripts/brand.mjs
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
void require;

const GRAD = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#34D399"/><stop offset=".55" stop-color="#10B981"/><stop offset="1" stop-color="#0E7490"/>
</linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/>
</linearGradient>`;

/** Дерево мыслей (белое) в квадрате 512 */
const TREE = `<g fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">
  <path d="M256 392 L256 236"/>
  <path d="M256 304 C256 262 214 252 180 218"/>
  <path d="M256 264 C256 224 296 214 332 182"/>
  <path d="M256 236 C256 196 244 168 256 132"/>
</g>
<g fill="#fff">
  <circle cx="174" cy="210" r="30"/>
  <circle cx="338" cy="174" r="30"/>
  <circle cx="256" cy="122" r="34"/>
</g>
<rect x="198" y="384" width="116" height="22" rx="11" fill="#fff" opacity=".9"/>`;

const svg = (body, defs = GRAD) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${defs}</defs>${body}</svg>`;

/** Полная иконка: скруглённый квадрат */
export const ICON = svg(`<rect width="512" height="512" rx="114" fill="url(#g)"/><rect width="512" height="512" rx="114" fill="url(#sheen)"/>${TREE}`);
/** Без скругления (iOS скругляет сам, PWA maskable) — дерево меньше, в безопасной зоне */
const FULL = svg(`<rect width="512" height="512" fill="url(#g)"/><rect width="512" height="512" fill="url(#sheen)"/><g transform="translate(256 262) scale(.78) translate(-256 -262)">${TREE}</g>`);
const MASKABLE = svg(`<rect width="512" height="512" fill="url(#g)"/><g transform="translate(256 262) scale(.66) translate(-256 -262)">${TREE}</g>`);
const ROUND = svg(`<circle cx="256" cy="256" r="256" fill="url(#g)"/><circle cx="256" cy="256" r="256" fill="url(#sheen)"/><g transform="translate(256 262) scale(.82) translate(-256 -262)">${TREE}</g>`);
const BG = svg(`<rect width="512" height="512" fill="url(#g)"/><rect width="512" height="512" fill="url(#sheen)"/>`);
/** Передний слой адаптивной иконки Android: в xml есть отступ 16.7%, поэтому дерево почти во весь слой */
const FG = svg(`<g transform="translate(256 262) scale(.92) translate(-256 -262)">${TREE}</g>`);

const png = (s, w, h = w) => new Resvg(s, { fitTo: { mode: 'width', value: w }, background: 'rgba(0,0,0,0)' }).render().asPng();
function pngCanvas(inner, w, h, bg) {
  // заставка: иконка по центру на фоне
  const size = Math.round(Math.min(w, h) * 0.28);
  const x = (w - size) / 2;
  const y = (h - size) / 2;
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/><svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 512 512">${inner}</svg></svg>`;
  return new Resvg(s, { fitTo: { mode: 'width', value: w } }).render().asPng();
}
const inner = (s) => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

const root = process.cwd();
const pub = join(root, 'public');
writeFileSync(join(pub, 'icon.svg'), ICON + '\n');
writeFileSync(join(pub, 'icon-192.png'), png(ICON, 192));
writeFileSync(join(pub, 'icon-512.png'), png(ICON, 512));
writeFileSync(join(pub, 'icon-maskable-512.png'), png(MASKABLE, 512));
writeFileSync(join(pub, 'apple-touch-icon.png'), png(FULL, 180));

// исходники для @capacitor/assets (на будущее)
mkdirSync(join(root, 'assets'), { recursive: true });
writeFileSync(join(root, 'assets', 'icon-only.png'), png(FULL, 1024));
writeFileSync(join(root, 'assets', 'icon-foreground.png'), png(FG, 1024));
writeFileSync(join(root, 'assets', 'icon-background.png'), png(BG, 1024));
writeFileSync(join(root, 'assets', 'splash.png'), pngCanvas(inner(ICON), 2732, 2732, '#F2F2F7'));
writeFileSync(join(root, 'assets', 'splash-dark.png'), pngCanvas(inner(ICON), 2732, 2732, '#000000'));

// Android
const res = join(root, 'android', 'app', 'src', 'main', 'res');
const dens = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, n] of Object.entries(dens)) {
  const dir = join(res, `mipmap-${d}`);
  if (!existsSync(dir)) continue;
  writeFileSync(join(dir, 'ic_launcher.png'), png(ICON, n));
  writeFileSync(join(dir, 'ic_launcher_round.png'), png(ROUND, n));
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), png(FG, n));
  writeFileSync(join(dir, 'ic_launcher_background.png'), png(BG, n));
}
// заставки старых Android: тот же размер, что был
import { readFileSync } from 'node:fs';
for (const d of readdirSync(res).filter((x) => x.startsWith('drawable'))) {
  const f = join(res, d, 'splash.png');
  if (!existsSync(f)) continue;
  const b = readFileSync(f);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  writeFileSync(f, pngCanvas(inner(ICON), w, h, d.includes('night') ? '#000000' : '#F2F2F7'));
}
console.log('готово');
