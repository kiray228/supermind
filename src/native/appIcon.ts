/**
 * Иконка приложения на экране «Домой»: iPhone — альтернативные иконки (UIApplication.setAlternateIconName),
 * Android — activity-alias на каждую иконку (включена ровно одна). Нативные плагины: AppIconPlugin.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNative } from '../platform';
import { t } from '../i18n/index';

export type AppIconId = 'default' | 'dark' | 'light' | 'green' | 'sunset' | 'purple';

export const APP_ICONS: { id: AppIconId; name: string }[] = [
  { id: 'default', name: t('Синяя') },
  { id: 'dark', name: t('Тёмная') },
  { id: 'light', name: t('Светлая') },
  { id: 'green', name: t('Зелёная') },
  { id: 'sunset', name: t('Закат') },
  { id: 'purple', name: t('Фиолетовая') },
];

interface AppIconPlugin {
  get(): Promise<{ name: string; supported: boolean }>;
  set(o: { name: AppIconId }): Promise<{ name: string }>;
}
const AppIcon = registerPlugin<AppIconPlugin>('AppIcon');

/** Смена иконки есть только в приложениях для iPhone и Android */
export const appIconSupported = () => isNative() && ['ios', 'android'].includes(Capacitor.getPlatform());

export async function currentAppIcon(): Promise<{ id: AppIconId; supported: boolean }> {
  try {
    const r = await AppIcon.get();
    const id = APP_ICONS.some((x) => x.id === r.name) ? (r.name as AppIconId) : 'default';
    return { id, supported: r.supported !== false };
  } catch {
    return { id: 'default', supported: false };
  }
}

export const setAppIcon = (id: AppIconId) => AppIcon.set({ name: id });

/** Картинка для выбора (public/app-icons, делает scripts/app-icons.mjs) */
export const appIconPreview = (id: AppIconId) => `${import.meta.env.BASE_URL}app-icons/${id}.png`;
