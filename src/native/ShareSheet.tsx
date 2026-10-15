import { useEffect, useRef, useState } from 'react';
import { CheckSquare, Loader2, Network, Newspaper, NotebookPen, PenLine, StickyNote } from 'lucide-react';
import { firstUrl } from '../notes/articleCore';
import type { ArticleStage } from '../notes/article';
import { cleanupSharedImages, loadSharedImages, shareAppend, shareToDaily, shareToMap, shareToNote, shareToTask, suggestNotes, type SharedText } from './share';

/** Окно «Сохранить в SuperMind»: задача / заметка / в заметку дня / дописать в заметку / карта «Входящие» */
export default function ShareSheet({ shared, onClose }: { shared: SharedText; onClose: () => void }) {
  const [text, setText] = useState(shared.text);
  const [busy, setBusy] = useState(false);
  const images = shared.images ?? [];
  const [pics, setPics] = useState<string[] | null>(images.length ? null : []);
  const [suggest, setSuggest] = useState<{ id: string; title: string }[]>([]);
  const [stage, setStage] = useState<ArticleStage | null>(null);
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  const url = images.length ? null : firstUrl(text);

  // статья: окно остаётся открытым, пока страница читается и ИИ выделяет главное
  const article = async () => {
    if (!url || stage) return;
    const c = (ac.current = new AbortController());
    setStage('fetch');
    const { saveArticleAndOpen } = await import('../notes/article');
    const ok = await saveArticleAndOpen(url, { signal: c.signal, onStage: setStage });
    if (c.signal.aborted) return;
    setStage(null);
    if (ok) onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // картинки — прочитать и сжать; копии на диске больше не нужны
  useEffect(() => {
    if (!images.length) return;
    let alive = true;
    void loadSharedImages(images)
      .then((p) => alive && setPics(p))
      .catch(() => alive && setPics([]))
      .finally(() => void cleanupSharedImages(images));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // куда дописать: заметки по словам текста
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void suggestNotes(text)
        .then((s) => alive && setSuggest(s))
        .catch(() => undefined);
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [text]);

  const loading = pics === null;
  const hasText = !!text.trim();
  const hasPics = !!pics?.length;
  const run = (fn: (s: SharedText, pics: string[]) => Promise<void>) => async () => {
    if ((!hasText && !hasPics) || busy || loading) return;
    setBusy(true);
    try {
      await fn({ text: text.trim(), title: shared.title }, pics ?? []);
    } finally {
      onClose();
    }
  };
  const btn = { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: 'auto', padding: '12px 6px', whiteSpace: 'normal', lineHeight: 1.2 } as const;
  const off = busy || loading || (!hasText && !hasPics);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(480px,100%)' }}>
        <h2>Сохранить в SuperMind</h2>
        {shared.title && <p className="muted" style={{ margin: '6px 0 0' }}>{shared.title}</p>}
        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 12 }}>
            {loading ? (
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={15} className="spin" /> Фото: {images.length}
              </span>
            ) : hasPics ? (
              pics!.map((p, i) => <img key={i} src={p} alt="" style={{ height: 72, borderRadius: 10, flexShrink: 0 }} />)
            ) : (
              <span className="muted">Фото не удалось открыть</span>
            )}
          </div>
        )}
        <textarea className="textarea" style={{ marginTop: 12 }} rows={hasPics ? 2 : 4} value={text} placeholder={images.length ? 'Подпись (необязательно)' : ''} onChange={(e) => setText(e.target.value)} />
        {url && (
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 14, gap: 8 }} disabled={busy || !!stage} onClick={() => void article()}>
            {stage ? <Loader2 size={18} className="spin" /> : <Newspaper size={18} />}
            {stage === 'fetch' ? 'Читаю статью…' : stage === 'summary' ? 'ИИ выделяет главное…' : stage === 'save' ? 'Сохраняю…' : 'Статья: главное от ИИ'}
          </button>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className={url ? 'btn' : 'btn btn-primary'} style={btn} disabled={off || !!stage} onClick={run(shareToNote)}>
            <StickyNote size={20} />
            Заметка
          </button>
          <button className="btn" style={btn} disabled={off || !!stage} onClick={run(shareToDaily)}>
            <NotebookPen size={20} />В заметку дня
          </button>
          {!images.length && (
            <>
              <button className="btn" style={btn} disabled={off || !!stage} onClick={run((s) => shareToTask(s))}>
                <CheckSquare size={20} />
                Задача
              </button>
              <button className="btn" style={btn} disabled={off || !!stage} onClick={run((s) => shareToMap(s))}>
                <Network size={20} />В карту
              </button>
            </>
          )}
        </div>
        {suggest.length > 0 && (
          <>
            <div className="muted small" style={{ marginTop: 14 }}>
              Дописать в заметку
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {suggest.map((n) => (
                <button key={n.id} className="btn btn-sm" disabled={off || !!stage} onClick={run((s, p) => shareAppend(n.id, s, p))} style={{ maxWidth: '100%' }}>
                  <PenLine size={14} />
                  <span className="ellipsis">{n.title}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="modal-actions" style={{ marginTop: 10 }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              ac.current?.abort();
              onClose();
            }}
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
