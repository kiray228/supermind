/** Обновление без переустановки: сравнение версий, релиз GitHub для Android, version.json сайта */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './tsResolve.ts';

const { newer, apkUpdate, webUpdate } = await import('../src/ui/updateCheck.ts');

const apk = (tag: string, extra: object = {}) => ({
  tag_name: tag,
  assets: [
    { name: 'SuperMind-Setup.exe', browser_download_url: `https://github.com/kiray228/supermind/releases/download/${tag}/SuperMind-Setup.exe` },
    { name: 'SuperMind.apk', browser_download_url: `https://github.com/kiray228/supermind/releases/download/${tag}/SuperMind.apk` },
  ],
  ...extra,
});

describe('сравнение версий', () => {
  test('по числам, а не по строкам', () => {
    assert.ok(newer('1.50', '1.49'));
    assert.ok(newer('1.100', '1.99'));
    assert.ok(newer('2.0', '1.99'));
    assert.ok(newer('1.50.1', '1.50'));
    assert.ok(newer('1.50', '1.49.0'));
  });
  test('та же или старее — не новее', () => {
    assert.ok(!newer('1.49', '1.49.0'));
    assert.ok(!newer('1.49.0', '1.49'));
    assert.ok(!newer('1.48', '1.49'));
  });
});

describe('Android: релиз на GitHub', () => {
  test('новее — ссылка на APK этого релиза', () => {
    const u = apkUpdate(apk('v1.50'), '1.49.0');
    assert.deepEqual(u, { kind: 'apk', version: '1.50', url: 'https://github.com/kiray228/supermind/releases/download/v1.50/SuperMind.apk' });
  });
  test('та же версия или старее — ничего', () => {
    assert.equal(apkUpdate(apk('v1.49'), '1.49.0'), null);
    assert.equal(apkUpdate(apk('v1.48'), '1.49.0'), null);
  });
  test('APK ещё не загружен (релиз только создан) — ничего', () => {
    assert.equal(apkUpdate({ tag_name: 'v1.50', assets: [] }, '1.49.0'), null);
  });
  test('постоянный релиз «windows», черновик и пре-релиз — ничего', () => {
    assert.equal(apkUpdate(apk('windows'), '1.49.0'), null);
    assert.equal(apkUpdate(apk('v1.50', { draft: true }), '1.49.0'), null);
    assert.equal(apkUpdate(apk('v1.50', { prerelease: true }), '1.49.0'), null);
  });
  test('ссылка не https — ничего', () => {
    assert.equal(apkUpdate({ tag_name: 'v1.50', assets: [{ name: 'a.apk', browser_download_url: 'http://x/a.apk' }] }, '1.49.0'), null);
  });
});

describe('сайт: version.json', () => {
  test('другая сборка — обновление', () => {
    assert.deepEqual(webUpdate({ version: '1.50.0', build: 'b2' }, 'b1', '1.49.0'), { kind: 'reload', version: '1.50' });
    // пересборка без смены номера версии
    assert.deepEqual(webUpdate({ version: '1.49.0', build: 'b2' }, 'b1', '1.49.0'), { kind: 'reload', version: '1.49' });
  });
  test('та же сборка или откат на старую версию — ничего', () => {
    assert.equal(webUpdate({ version: '1.49.0', build: 'b1' }, 'b1', '1.49.0'), null);
    assert.equal(webUpdate({ version: '1.48.0', build: 'b0' }, 'b1', '1.49.0'), null);
    assert.equal(webUpdate({}, 'b1', '1.49.0'), null);
  });
});

describe('сборка', () => {
  const vite = readFileSync('vite.config.ts', 'utf8');
  test('version.json выпускается и мимо офлайн-кэша', () => {
    assert.match(vite, /fileName: 'version\.json'/);
    assert.match(vite, /endsWith\('\/version\.json'\)\) return;/);
  });
  test('программа для Windows обновляется с подписанного latest.json', () => {
    const conf = JSON.parse(readFileSync('desktop/src-tauri/tauri.conf.json', 'utf8'));
    assert.equal(conf.bundle.createUpdaterArtifacts, true);
    assert.ok(conf.plugins.updater.pubkey.length > 40);
    assert.deepEqual(conf.plugins.updater.endpoints, ['https://github.com/kiray228/supermind/releases/download/windows/latest.json']);
    const ci = readFileSync('.github/workflows/desktop.yml', 'utf8');
    assert.match(ci, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
    assert.match(ci, /gh release upload windows latest\.json/);
  });
});
