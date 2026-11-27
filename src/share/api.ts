/**
 * Ссылки на карты (как в Canva): владелец даёт ссылку «только смотреть» или «можно править».
 * Карта остаётся у владельца: по ссылке её открывают с сервера, правки по ссылке сервер записывает владельцу.
 */
import type { MindDoc } from '../types';
import { API, api, authHeader } from '../store/cloud';
import { t } from '../i18n/index';
export { SHARE_BASE, shareUrl, parseShareToken } from './link';

export type ShareRole = 'view' | 'edit';

export interface ShareLink {
  token: string;
  role: ShareRole;
  createdAt: string;
  /** сколько человек открывали карту по ссылке */
  people: number;
}

/** Чужая карта, открытая по ссылке, — в «Моих картах» с подписью владельца */
export interface SharedMap {
  token: string;
  docId: string;
  role: ShareRole;
  owner: { name: string };
  title: string;
  updatedAt: number;
}

export type OpenResult =
  | { own: true; docId: string; role: ShareRole }
  | { own: false; token: string; docId: string; role: ShareRole; owner: { name: string }; doc: MindDoc; seq: number };

export const createShare = (docId: string, role: ShareRole) =>
  api<{ token: string; role: ShareRole }>('/shares', { method: 'POST', body: JSON.stringify({ docId, role }) });

export const listShares = async (docId: string) => (await api<{ links: ShareLink[] }>(`/shares?docId=${encodeURIComponent(docId)}`)).links;

export const revokeShare = (token: string) => api(`/shares/${token}`, { method: 'DELETE' });

export const openShare = (token: string) => api<OpenResult>(`/s/${token}`);

export const sharedWithMe = async () => (await api<{ maps: SharedMap[] }>('/shared')).maps;

export const leaveShare = (token: string) => api(`/shared/${token}`, { method: 'DELETE' });

/** Записать правку владельцу. Карту тем временем изменили — ok: false и номер свежей версии */
export async function saveShared(token: string, doc: MindDoc, baseSeq: number): Promise<{ ok: true; seq: number } | { ok: false; seq: number; doc: MindDoc | null }> {
  let res: Response;
  try {
    res = await fetch(`${API}/s/${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ doc, baseSeq }),
    });
  } catch {
    throw new Error(t('Нет соединения с сервером — проверьте интернет'));
  }
  const data = (await res.json().catch(() => ({}))) as { seq?: number; doc?: MindDoc | null; error?: string };
  if (res.status === 409) return { ok: false, seq: Number(data.seq) || 0, doc: data.doc ?? null };
  if (!res.ok) throw new Error(data.error ?? t('Ошибка сервера ({status})', { status: res.status }));
  return { ok: true, seq: Number(data.seq) };
}

/** Список «Доступные мне» на случай без сети: последний полученный */
const CACHE = 'sm-shared-maps';
export function cachedShared(): SharedMap[] {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as SharedMap[]) : [];
  } catch {
    return [];
  }
}
export function cacheShared(list: SharedMap[]) {
  try {
    localStorage.setItem(CACHE, JSON.stringify(list));
  } catch {
    /* без хранилища — просто не кешируем */
  }
}
