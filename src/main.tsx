import './polyfills';
import { isEn, isKk, lang, registerDict } from './i18n/index';

// Сначала словарь (если интерфейс не русский), потом приложение: строки разделов переводятся при загрузке модулей
document.documentElement.lang = lang;
if (isEn) document.title = 'SuperMind — mind maps, tasks and planner';
if (isKk) document.title = 'SuperMind — ой карталары, тапсырмалар және жоспарлағыш';
const load = isEn ? import('./i18n/en/index') : isKk ? import('./i18n/kk/index') : null;
const dict = load ? load.then((m) => registerDict(m.default)).catch(() => undefined) : Promise.resolve();
void dict.then(() => import('./boot'));
