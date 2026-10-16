/** Что ассистент видит из данных (общая для устройств — store/sharedPrefs): финансы и настроение можно скрыть */
import { shareLocal } from '../store/sharedPrefs';

export interface AssistantPrivacy {
  /** финансы: траты, доходы, счета, подписки */
  finance: boolean;
  /** настроение из дневника */
  mood: boolean;
}

const KEY = 'sm-ai-privacy';

export function assistantPrivacy(): AssistantPrivacy {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AssistantPrivacy>;
    return { finance: v.finance !== false, mood: v.mood !== false };
  } catch {
    return { finance: true, mood: true };
  }
}

export function setAssistantPrivacy(p: Partial<AssistantPrivacy>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...assistantPrivacy(), ...p }));
  } catch {
    /* не страшно */
  }
  void shareLocal(KEY);
}
