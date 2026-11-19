/** Ссылки из виджетов и быстрых действий iPhone (supermind://…) → действие из очереди виджета (без зависимостей — проверяется тестами) */
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
    case 'voice':
    case 'new_note':
    case 'new_map':
    case 'search':
      return { type };
    case 'add_expense':
      return { type };
    // виджет «Фокус» на iPhone: supermind://focus?action=start
    case 'focus': {
      const action = q.get('action') ?? '';
      return ['start', 'pause', 'resume', 'stop'].includes(action) ? { type, action } : null;
    }
    case 'open_view':
      return q.get('view') ? { type, view: q.get('view')! } : null;
    default:
      return null;
  }
}
