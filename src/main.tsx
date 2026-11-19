import './polyfills';
import { isEn, registerDict } from './i18n';

// Сначала словарь (если интерфейс английский), потом приложение: строки разделов переводятся при загрузке модулей
document.documentElement.lang = isEn ? 'en' : 'ru';
if (isEn) document.title = 'SuperMind — mind maps, tasks and planner';
const dict = isEn ? import('./i18n/en').then((m) => registerDict(m.default)).catch(() => undefined) : Promise.resolve();
void dict.then(() => import('./boot'));
