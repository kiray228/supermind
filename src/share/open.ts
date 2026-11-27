/**
 * Открыть карту по ссылке: свою — как обычно, чужую — с сервера (правки уходят владельцу).
 * Пока чужая карта открыта, раз в несколько секунд забираем правки других людей.
 */
import { useApp, toast } from '../store/appStore';
import { useCloud } from '../store/cloud';
import { useDoc, flushSave, hasPendingSave } from '../store/docStore';
import { findInSheet } from '../utils/tree';
import { t } from '../i18n/index';
import { askText } from '../ui/dialogs';
import { openShare, parseShareToken, sharedWithMe, cacheShared, type OpenResult } from './api';

const PENDING = 'sm-open-map';

const status = (e: unknown) => (e as { status?: number })?.status ?? 0;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Открыть по коду ссылки. Без входа — запомнить и открыть сразу после входа */
export async function openSharedMap(token: string): Promise<boolean> {
  if (!useCloud.getState().account) {
    try {
      sessionStorage.setItem(PENDING, token);
    } catch {
      /* без хранилища — откроют ссылку ещё раз */
    }
    toast(t('Войдите в аккаунт — карта откроется сразу после входа'));
    return false;
  }
  let r: OpenResult;
  try {
    r = await openShare(token);
  } catch (e) {
    toast(message(e));
    // ссылку отозвали или карту удалили — убрать её из «Доступных мне»
    if (status(e) === 404 || status(e) === 403) void refreshSharedList();
    return false;
  }
  await flushSave();
  if (r.own) {
    const { openDoc } = await import('../actions');
    await openDoc(r.docId);
    return true;
  }
  useDoc.getState().openShared(r.doc, { token: r.token, role: r.role, owner: r.owner, seq: r.seq });
  useApp.getState().go('editor');
  void refreshSharedList();
  return true;
}

/** Ссылка, вставленная в приложении */
export async function openFromText(text: string): Promise<boolean> {
  const token = parseShareToken(text);
  if (!token) {
    toast(t('Это не ссылка на карту SuperMind'));
    return false;
  }
  return openSharedMap(token);
}

/** «По ссылке»: вставить ссылку на карту, присланную в мессенджере */
export async function askOpenLink() {
  const text = await askText(t('Открыть карту по ссылке'), { placeholder: 'https://supermind.kz/app/#map=…' });
  if (text) await openFromText(text);
}

/** Обновить «Доступные мне» (и запомнить на случай без сети) */
export async function refreshSharedList() {
  try {
    const list = await sharedWithMe();
    cacheShared(list);
    useApp.setState({ docsVersion: Date.now() });
    return list;
  } catch {
    return null;
  }
}

const POLL_MS = 6000;
let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;

/** Свежая версия чужой карты с сервера — если здесь сейчас ничего не правят */
async function pull() {
  const st = useDoc.getState();
  const sh = st.shared;
  if (!sh || !st.doc || polling || document.hidden) return;
  if (st.editingId || st.saving || hasPendingSave()) return;
  polling = true;
  try {
    const r = await openShare(sh.token);
    const cur = useDoc.getState();
    if (r.own || cur.shared?.token !== sh.token || !cur.doc) return;
    if (r.seq === cur.shared.seq || cur.editingId || cur.saving || hasPendingSave()) return;
    const doc = r.doc;
    const sheet = doc.sheets.find((s) => s.id === doc.activeSheet) ?? doc.sheets[0];
    const selection = sheet ? cur.selection.filter((id) => findInSheet(sheet, id)) : [];
    useDoc.setState({ doc, shared: { ...cur.shared, seq: r.seq, role: r.role, owner: r.owner }, selection, past: [], future: [] });
  } catch (e) {
    if (status(e) === 404 || status(e) === 403) {
      const cur = useDoc.getState();
      if (cur.shared?.token !== sh.token) return;
      toast(message(e));
      cur.close();
      useApp.getState().go('home');
      void refreshSharedList();
    }
  } finally {
    polling = false;
  }
}

let started = false;

/** Ссылка в адресе при запуске (#map=…), отложенная до входа, и обновление открытой чужой карты */
export function initShare() {
  if (started) return;
  started = true;
  /** ссылка в адресе: убрать её оттуда (обновление страницы не откроет карту второй раз) и открыть после входа */
  const takeHash = () => {
    const token = parseShareToken(location.hash);
    if (!token) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    try {
      sessionStorage.setItem(PENDING, token);
    } catch {
      void openSharedMap(token);
    }
  };
  takeHash();
  // ссылку открыли во вкладке, где приложение уже запущено: меняется только #…, страница не перезагружается
  window.addEventListener('hashchange', () => {
    takeHash();
    tryPending();
  });
  const tryPending = () => {
    if (!useCloud.getState().account) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING);
      sessionStorage.removeItem(PENDING);
    } catch {
      /* нет хранилища */
    }
    if (pending) void openSharedMap(pending);
  };
  tryPending();
  useCloud.subscribe((s, prev) => {
    if (s.account && !prev.account) tryPending();
  });
  useDoc.subscribe((s, prev) => {
    if (!!s.shared === !!prev.shared) return;
    if (timer) clearInterval(timer);
    timer = s.shared ? setInterval(() => void pull(), POLL_MS) : null;
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void pull();
  });
}
