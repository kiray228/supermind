/** iPhone: свои плагины (распознавание речи) регистрирует MainViewController — окно должно создаваться им */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../ios/App/App/${p}`, import.meta.url), 'utf8');

test('SceneDelegate создаёт MainViewController, а не голый CAPBridgeViewController', () => {
  const scene = read('SceneDelegate.swift');
  assert.match(scene, /rootViewController\s*=\s*MainViewController\(\)/);
  assert.doesNotMatch(scene, /rootViewController\s*=\s*CAPBridgeViewController\(\)/);
});

test('MainViewController регистрирует плагин распознавания речи', () => {
  assert.match(read('MainViewController.swift'), /registerPluginInstance\(SpeechRecognitionPlugin\(\)\)/);
});
