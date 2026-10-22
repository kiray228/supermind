/** Новая ли версия — без зависимостей (проверяется тестами) */

export interface AppUpdate {
  /** reload — новая сборка сайта; apk — новый APK для Android */
  kind: 'reload' | 'apk';
  version: string;
  url?: string;
}

/** a новее b: '1.50' > '1.49', '1.50.1' > '1.50' */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

interface Release {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name: string; browser_download_url: string }[];
}

/** Последний релиз на GitHub → обновление для Android, если он новее и APK уже загружен */
export function apkUpdate(rel: Release, current: string): AppUpdate | null {
  const v = (rel.tag_name ?? '').replace(/^v/, '');
  if (!/^\d+(\.\d+)*$/.test(v) || rel.draft || rel.prerelease || !newer(v, current)) return null;
  const apk = rel.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'));
  // релиз только создан, APK ещё загружается — спросим позже
  if (!apk || !apk.browser_download_url.startsWith('https://')) return null;
  return { kind: 'apk', version: v, url: apk.browser_download_url };
}

/** version.json сайта → обновление, если сборка другая и не старее этой */
export function webUpdate(j: { version?: string; build?: string }, build: string, current: string): AppUpdate | null {
  if (!j.build || j.build === build) return null;
  if (j.version && newer(current, j.version)) return null;
  // «1.50.0» → «1.50», как в названиях релизов
  return { kind: 'reload', version: (j.version ?? '').replace(/\.0$/, '') };
}
