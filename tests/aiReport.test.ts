/** Жалоба на ответ ИИ (Google Play, генеративный ИИ): заготовка обращения и кнопка у каждого ответа */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './tsResolve.ts';

const { aiReportText, AI_REPORT_MARK } = await import('../src/ai/report.ts');

describe('заготовка жалобы', () => {
  test('пометка, место и сам ответ — в тексте обращения', () => {
    const t = aiReportText('  Плохой ответ  ', 'Ассистент');
    assert.ok(t.startsWith(`${AI_REPORT_MARK} · Ассистент`));
    assert.match(t, /«Плохой ответ»/);
    assert.ok(t.endsWith('Что не так: '), 'курсор встаёт после «Что не так»');
  });

  test('без ответа (общая жалоба из настроек) — только пометка', () => {
    const t = aiReportText('', '');
    assert.equal(t, `${AI_REPORT_MARK}\n\nЧто не так: `);
  });

  test('длинный ответ обрезается и влезает в поле поддержки (5000)', () => {
    const t = aiReportText('а'.repeat(10000), 'Финансы · ИИ-разбор');
    assert.ok(t.length < 5000);
    assert.match(t, /а…»/);
  });
});

describe('кнопка «Пожаловаться» у ответов ИИ', () => {
  const places = [
    'src/assistant/ChatParts.tsx',
    'src/assistant/BriefingCard.tsx',
    'src/views/HomeAI.tsx',
    'src/editor/AIPanel.tsx',
    'src/finance/ui/Analytics.tsx',
    'src/notes/ui/BrainAsk.tsx',
    'src/notes/ui/TopicDigest.tsx',
    'src/notes/ui/QuestionCard.tsx',
    'src/views/Settings.tsx',
  ];
  for (const f of places)
    test(f, () => {
      assert.match(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /\b(ReportAI|reportAI)\b/);
    });

  test('окно поддержки открывается из любого раздела, а не только из настроек', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.match(app, /<SupportHost \/>/);
    const settings = readFileSync(new URL('../src/views/Settings.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(settings, /<SupportHost \/>/, 'второе окно поверх первого');
  });
});
