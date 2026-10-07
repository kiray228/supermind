/**
 * История чата ассистента: IndexedDB (ключ 'assistant'), синхронизируется между устройствами.
 * Синхронизация сливает массив messages по id (свежее по updatedAt), удалённые id — в gone.
 */
import { create } from 'zustand';
import { get, set } from '../store/kv';
import { mergeValues } from '../store/merge';
import { onBeforeSync, onRemoteChange } from '../store/cloud';
import type { ActionItem } from './actions';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  updatedAt: number;
  actions?: ActionItem[];
  /** ответ не получен (ошибка) — в историю для модели не идёт */
  error?: boolean;
}

interface ChatData {
  messages: ChatMessage[];
  updatedAt: number;
  gone?: Record<string, number>;
}

const KEY = 'assistant';
const MAX = 50;

interface ChatState {
  messages: ChatMessage[];
  loaded: boolean;
}

export const useChat = create<ChatState>(() => ({ messages: [], loaded: false }));

let gone: Record<string, number> = {};
let loading: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** идёт ответ — изменения с других устройств не подхватываем */
let busy = false;
export const setChatBusy = (v: boolean) => void (busy = v);

function normalize(raw: unknown): ChatMessage[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as Partial<ChatData>).messages;
  if (!Array.isArray(list)) return [];
  return list
    .filter((m): m is ChatMessage => !!m && typeof m === 'object' && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map((m) => ({ ...m, at: Number(m.at) || 0, updatedAt: Number(m.updatedAt) || Number(m.at) || 0, actions: Array.isArray(m.actions) ? m.actions : undefined }))
    .sort((a, b) => a.at - b.at);
}

async function read() {
  const raw = await get<ChatData>(KEY);
  gone = raw && typeof raw === 'object' && raw.gone && typeof raw.gone === 'object' ? { ...raw.gone } : {};
  useChat.setState({ messages: normalize(raw).filter((m) => !gone[m.id]), loaded: true });
}

export function ensureChat(): Promise<void> {
  if (useChat.getState().loaded) return Promise.resolve();
  loading ??= read().catch(() => {
    loading = null;
    useChat.setState({ loaded: true });
  });
  return loading;
}

export function flushChat(): Promise<void> {
  if (!saveTimer) return Promise.resolve();
  clearTimeout(saveTimer);
  saveTimer = null;
  const old = Date.now() - 365 * 86400000;
  for (const [k, t] of Object.entries(gone)) if (t < old) delete gone[k];
  const mine: ChatData = { messages: useChat.getState().messages, updatedAt: Date.now(), gone };
  // слить с сохранённым: сообщения с другого устройства не теряются
  return get<ChatData>(KEY)
    .then((disk) => {
      const data = disk ? ({ ...(mergeValues(KEY, mine, disk) as ChatData), updatedAt: mine.updatedAt }) : mine;
      gone = { ...(data.gone ?? {}) };
      data.messages = [...data.messages].sort((a, b) => a.at - b.at);
      if (data.messages.length !== mine.messages.length) useChat.setState({ messages: data.messages });
      return set(KEY, data);
    })
    .catch(() => undefined);
}

function commit(messages: ChatMessage[]) {
  // храним только последние MAX сообщений; старые помечаем удалёнными, чтобы синхронизация их не вернула
  if (messages.length > MAX) {
    const now = Date.now();
    for (const m of messages.slice(0, messages.length - MAX)) gone[m.id] = now;
    messages = messages.slice(-MAX);
  }
  useChat.setState({ messages });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushChat(), 300);
}

export function addMessage(m: ChatMessage) {
  commit([...useChat.getState().messages, m]);
}

export function patchMessage(id: string, patch: Partial<Omit<ChatMessage, 'id'>>) {
  commit(useChat.getState().messages.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m)));
}

export function removeMessage(id: string) {
  gone[id] = Date.now();
  commit(useChat.getState().messages.filter((m) => m.id !== id));
}

export function clearChat() {
  const now = Date.now();
  for (const m of useChat.getState().messages) gone[m.id] = now;
  commit([]);
}

onBeforeSync(flushChat);

// изменения с другого устройства — перечитать
onRemoteChange(
  (k) => k === KEY,
  async () => {
    if (busy) return; // ответ ещё печатается — после него запись сольётся с пришедшим
    await flushChat();
    await read();
  },
);
