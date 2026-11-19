/** Ссылки из виджетов iPhone (supermind://…) → действие из очереди виджета (без зависимостей — проверяется тестами) */
import type { PendingAction } from './widget';

export function actionFromUrl(raw: string): PendingAction | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'supermind:') return null;
  // supermind://open_task?id=… — тип в «хосте»; на случай supermind:open_task — в пути
  const type = u.hostname || u.pathname.replace(/^\/+/, '');
  const q = u.searchParams;
  switch (type) {
    case 'open_task':
      return q.get('id') ? { type, id: q.get('id')! } : null;
    case 'quick_add':
      return { type };
    case 'open_view':
      return q.get('view') ? { type, view: q.get('view')! } : null;
    default:
      return null;
  }
}
