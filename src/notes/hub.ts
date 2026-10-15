/** Страница «Второй мозг: что умеет»: показывали ли её на этом устройстве */
const HUB_KEY = 'sm-brain-hub-seen';

/** Показывали ли страницу «Второй мозг» (на этом устройстве) */
export function hubSeen(): boolean {
  try {
    return !!localStorage.getItem(HUB_KEY);
  } catch {
    return true;
  }
}

export function markHubSeen() {
  try {
    localStorage.setItem(HUB_KEY, String(Date.now()));
  } catch {
    /* покажется ещё раз — не страшно */
  }
}
