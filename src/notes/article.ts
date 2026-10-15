/**
 * «Сохранить статью по ссылке»: страница → главное от ИИ → заметка со ссылкой на источник.
 * На Android страницу читает сам телефон (без ограничений браузера), в веб-версии и программе для Windows — сервер.
 * Разбор и запрос к ИИ — articleCore.ts.
 */
import { Capacitor } from '@capacitor/core';
import { streamText } from '../ai/claude';
import type { ID } from '../types';
import { type Article, ARTICLE_SYSTEM, articleMarkdown, buildArticlePrompt, decodePage, extractArticle } from './articleCore';
import { markdownToBlocks } from './model';
import { createNote, ensureNotes, flushNotes, useNotes } from './store';

export class ArticleError extends Error {
  override name = 'ArticleError';
}

const b64bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Скачать страницу: на Android — напрямую, иначе — через сервер */
export async function fetchPage(url: string, signal?: AbortSignal): Promise<{ url: string; html: string }> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      const { CapacitorHttp } = await import('@capacitor/core');
      const r = await CapacitorHttp.get({ url, responseType: 'arraybuffer', headers: { 'Accept-Language': 'ru,en;q=0.8' }, connectTimeout: 10000, readTimeout: 15000 });
      if (r.status >= 200 && r.status < 300 && typeof r.data === 'string') {
        const type = Object.entries(r.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
        if (type && !/text\/|xhtml|xml/i.test(type)) throw new ArticleError('По ссылке не страница, а файл');
        return { url: r.url || url, html: decodePage(b64bytes(r.data), type) };
      }
    } catch (e) {
      if (e instanceof ArticleError) throw e;
      /* не вышло напрямую — через сервер */
    }
  }
  if (signal?.aborted) throw new ArticleError('Остановлено');
  const { api, useCloud } = await import('../store/cloud');
  if (!useCloud.getState().account) throw new ArticleError('Войдите в аккаунт — страницу читает сервер SuperMind');
  try {
    const r = await api<{ url: string; contentType: string; base64: string }>('/web/page', { method: 'POST', body: JSON.stringify({ url }), signal });
    return { url: r.url, html: decodePage(b64bytes(r.base64), r.contentType) };
  } catch (e) {
    throw new ArticleError(e instanceof Error ? e.message : 'Не удалось открыть страницу');
  }
}

export type ArticleStage = 'fetch' | 'summary' | 'save';

/** Такая статья уже сохранена — её заметка */
export function savedArticle(url: string): ID | undefined {
  const d = useNotes.getState().data;
  const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/$/, '');
  return d?.notes.find((n) => !n.trashed && n.source && norm(n.source) === norm(url))?.id;
}

/**
 * Сохранить статью: заметка с пересказом от ИИ (без ИИ — описание и начало статьи).
 * Возвращает id заметки и была ли сводка ИИ.
 */
export async function saveArticle(url: string, opts: { signal?: AbortSignal; onStage?: (s: ArticleStage) => void; folderId?: ID } = {}): Promise<{ id: ID; summary: boolean; article: Article }> {
  await ensureNotes();
  opts.onStage?.('fetch');
  const page = await fetchPage(url, opts.signal);
  const a = extractArticle(page.html, page.url);
  if (!a.text && !a.description) throw new ArticleError('На странице не нашлось текста статьи');
  let summary = '';
  if (a.text.length > 200) {
    opts.onStage?.('summary');
    try {
      summary = await streamText({ system: ARTICLE_SYSTEM, messages: [{ role: 'user', content: buildArticlePrompt(a) }], signal: opts.signal, effort: 'low' });
    } catch (e) {
      if (opts.signal?.aborted) throw new ArticleError('Остановлено');
      void e; // ИИ недоступен — сохраним без пересказа
    }
  }
  opts.onStage?.('save');
  const m = createNote({ title: a.title, blocks: markdownToBlocks(articleMarkdown(a, summary)), source: a.url, ...(opts.folderId ? { folderId: opts.folderId } : {}) });
  if (!m) throw new ArticleError('Не удалось сохранить заметку');
  await flushNotes();
  return { id: m.id, summary: !!summary.trim(), article: a };
}

/** Сохранить статью и открыть её заметку — с подсказками о ходе дела (для меню, поиска и «Поделиться») */
export async function saveArticleAndOpen(url: string, opts: { signal?: AbortSignal; onStage?: (s: ArticleStage) => void } = {}): Promise<boolean> {
  const { toast, useApp } = await import('../store/appStore');
  const { openNote } = await import('./store');
  const open = (id: ID) => {
    useApp.getState().go('notes');
    setTimeout(() => void openNote(id), 50);
  };
  await ensureNotes();
  const have = savedArticle(url);
  if (have) {
    toast('Эта статья уже сохранена', { label: 'Открыть', run: () => open(have) });
    return true;
  }
  try {
    const r = await saveArticle(url, opts);
    toast(r.summary ? 'Статья сохранена — с главными мыслями' : 'Статья сохранена (без пересказа — ИИ недоступен)');
    open(r.id);
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Не удалось сохранить статью');
    return false;
  }
}

/** Спросить ссылку и сохранить статью */
export async function askArticle(): Promise<void> {
  const { askText } = await import('../ui/dialogs');
  const { toast } = await import('../store/appStore');
  const { firstUrl } = await import('./articleCore');
  const v = await askText('Статья по ссылке', { placeholder: 'https://…', message: 'ИИ прочитает статью и сохранит заметкой главные мысли со ссылкой на источник.', okText: 'Сохранить' });
  if (v === null) return;
  const url = firstUrl(v.trim()) ?? (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v.trim()) ? 'https://' + v.trim() : null);
  if (!url) return toast('Это не похоже на ссылку');
  toast('Читаю статью…');
  await saveArticleAndOpen(url);
}
