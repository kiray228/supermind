import './polyfills';
import { isEn, registerDict } from './i18n/index';

// Сначала словарь (если интерфейс английский), потом приложение: строки разделов переводятся при загрузке модулей
document.documentElement.lang = isEn ? 'en' : 'ru';
if (isEn) document.title = 'SuperMind — mind maps, tasks and planner';
const dict = isEn ? import('./i18n/en/index').then((m) => registerDict(m.default)).catch(() => undefined) : Promise.resolve();
void dict.then(() => import('./boot'));
