/**
 * Системное на телефоне: вход по Face ID / Touch ID (iPhone — плагин SmSystem, Android — отпечаток через WidgetBridge)
 * и событие iPhone «в очереди новое действие» (Siri, Spotlight, кнопки Пункта управления при открытом приложении).
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** face / touch / optic — iPhone; fingerprint — Android (отпечаток или лицо — система решает сама) */
export type BioKind = 'face' | 'touch' | 'optic' | 'fingerprint';

interface SmSystemPlugin {
  biometricAvailable(): Promise<{ available: boolean; kind?: string }>;
  biometricVerify(o: { title: string; subtitle?: string; negative?: string }): Promise<{ ok: boolean; error?: string }>;
  addListener(event: 'pending', fn: () => void): Promise<PluginListenerHandle>;
}

const SmSystem = registerPlugin<SmSystemPlugin>('SmSystem');
const ios = () => Capacitor.getPlatform() === 'ios';

let kind: BioKind | null = null;

/** Есть ли вход по лицу или отпечатку; заодно запоминает, что именно (для подписей) */
export async function nativeBiometricAvailable(): Promise<boolean> {
  if (ios()) {
    const r = await SmSystem.biometricAvailable().catch(() => ({ available: false, kind: '' }));
    kind = r.kind === 'face' || r.kind === 'touch' || r.kind === 'optic' ? r.kind : null;
    return r.available;
  }
  const { nativeBiometricAvailable: android } = await import('./widget');
  kind = 'fingerprint';
  return android();
}

/** Что стоит на телефоне: Face ID, Touch ID или отпечаток (после nativeBiometricAvailable) */
export const nativeBiometricKind = (): BioKind => kind ?? (ios() ? 'face' : 'fingerprint');
export const nativeBiometricKnown = () => kind !== null;

/** Системное окно Face ID / Touch ID / отпечатка; true — подтверждено */
export async function nativeBiometricVerify(o: { title: string; subtitle?: string; negative?: string }): Promise<boolean> {
  if (ios())
    return SmSystem.biometricVerify(o)
      .then((r) => r.ok)
      .catch(() => false);
  const { nativeBiometricVerify: android } = await import('./widget');
  return android(o);
}

/** iPhone: действие легло в очередь, пока приложение открыто */
export function onSystemPending(fn: () => void) {
  if (!ios()) return;
  void SmSystem.addListener('pending', fn).catch(() => {});
}
