/** Публикация в Google Play и App Store: разрешения, страницы для магазинов, согласие на отправку данных ИИ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import './fixtures/appHooks.ts';

const consent = await import('../src/ai/consent.ts');

const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

describe('Google Play: разрешения', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  test('без USE_EXACT_ALARM (Play даёт его только будильникам и календарям), точные будильники — по разрешению пользователя', () => {
    assert.doesNotMatch(manifest, /android\.permission\.USE_EXACT_ALARM/);
    assert.match(manifest, /android\.permission\.SCHEDULE_EXACT_ALARM/);
  });
  test('разрешили точные будильники — будильники ставятся заново', () => {
    assert.match(manifest, /SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED/);
  });
  test('сборка AAB для Play', () => {
    assert.match(read('package.json'), /"aab":.*bundleRelease/);
  });
});

describe('App Store: iOS-проект', () => {
  const plist = read('ios/App/App/Info.plist');
  test('объяснения разрешений и шифрование для экспорта', () => {
    for (const k of ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription', 'NSPhotoLibraryAddUsageDescription', 'ITSAppUsesNonExemptEncryption']) assert.match(plist, new RegExp(`<key>${k}</key>`));
  });
  test('свой плагин распознавания речи и манифест конфиденциальности входят в сборку', () => {
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    for (const f of ['SpeechRecognitionPlugin.swift in Sources', 'MainViewController.swift in Sources', 'PrivacyInfo.xcprivacy in Resources']) assert.ok(pbx.includes(f), f);
    assert.match(read('ios/App/App/Base.lproj/Main.storyboard'), /customClass="MainViewController"/);
    assert.match(read('ios/App/App/MainViewController.swift'), /registerPluginInstance\(SpeechRecognitionPlugin\(\)\)/);
    assert.match(read('ios/App/App/SpeechRecognitionPlugin.swift'), /jsName = "SpeechRecognition"/);
  });
});

describe('страницы для магазинов', () => {
  test('политика конфиденциальности, удаление аккаунта и поддержка — в public (уходят на GitHub Pages)', () => {
    for (const f of ['privacy.html', 'delete-account.html', 'support.html', 'legal.css']) assert.ok(existsSync(new URL('../public/' + f, import.meta.url)), f);
    assert.match(read('public/delete-account.html'), /'\/account', 'DELETE'/);
    assert.match(read('public/privacy.html'), /delete-account\.html/);
  });
});

describe('согласие на отправку данных ИИ', () => {
  test('по умолчанию не дано; включается и выключается в настройках', () => {
    localStorage.removeItem('sm-ai-consent');
    assert.equal(consent.aiConsentGiven('server'), false);
    consent.setAiConsent('server', true);
    assert.equal(consent.aiConsentGiven('server'), true);
    assert.equal(consent.aiConsentGiven('claude'), false, 'на каждого поставщика ИИ — своё согласие');
    consent.setAiConsent('server', false);
    assert.equal(consent.aiConsentGiven('server'), false);
  });
  test('данное согласие — запрос уходит без окна', async () => {
    consent.setAiConsent('claude', true);
    assert.equal(await consent.askAiConsent('claude'), true);
    await consent.requireAiConsent('claude');
    consent.setAiConsent('claude', false);
  });
});

describe('App Store 5.1.1: на iPhone можно без аккаунта', () => {
  test('экран входа предлагает «Продолжить без аккаунта» только в приложении для iPhone', () => {
    const gate = read('src/ui/AuthGate.tsx');
    assert.match(gate, /isIOSApp\(\) && \(/);
    assert.match(gate, /Продолжить без аккаунта/);
    assert.match(gate, /if \(account \|\| skipped\) return null;/);
  });
});
