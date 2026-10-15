import { useEffect, useState } from 'react';
import { Copy, Loader2, X } from 'lucide-react';
import { onBack } from '../../ui/dialogs';
import { toast } from '../../store/appStore';
import { allDuplicates, markNotDuplicate, mergeNotes } from '../mentionsRuntime';
import { openNote, useNotes } from '../store';
import { noteDate } from '../model';

type Pair = { a: string; b: string; score: number };

/** Все почти одинаковые заметки: какую оставить, а какую слить в неё */
export function DuplicatesSheet({ onClose }: { onClose: () => void }) {
  const notes = useNotes((s) => s.data?.notes);
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => onBack(() => (onClose(), true)));
  useEffect(() => {
    let alive = true;
    void allDuplicates()
      .then((p) => alive && setPairs(p))
      .catch(() => alive && setPairs([]));
    return () => {
      alive = false;
    };
  }, []);

  const meta = (id: string) => notes?.find((n) => n.id === id);
  const name = (id: string) => meta(id)?.title || meta(id)?.preview.slice(0, 40) || 'Без названия';
  const drop = (p: Pair) => setPairs((all) => all?.filter((x) => x !== p) ?? null);

  const merge = async (p: Pair, keep: string) => {
    const other = keep === p.a ? p.b : p.a;
    setBusy(p.a + p.b);
    await mergeNotes(keep, other);
    setBusy(null);
    // заметки из этой пары в других парах больше не актуальны
    setPairs((all) => all?.filter((x) => x.a !== other && x.b !== other) ?? null);
    toast(`Объединено в «${name(keep)}»`);
  };

  const side = (p: Pair, id: string) => {
    const m = meta(id);
    return (
      <div className="nt-dups-side">
        <button
          className="nt-dups-title"
          onClick={() => {
            onClose();
            void openNote(id);
          }}
        >
          {name(id)}
        </button>
        <div className="nt-dups-meta">
          {m ? noteDate(m.updatedAt) : ''}
          {m?.wordCount ? ` · ${m.wordCount} сл.` : ''}
        </div>
        <button className="nt-ai-btn" disabled={!!busy} onClick={() => void merge(p, id)}>
          Оставить эту
        </button>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal nt-dups" role="dialog" aria-label="Дубли заметок">
        <div className="nt-ask-head">
          <Copy size={19} className="nt-ask-logo" />
          <h2 className="grow">Дубли заметок</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        {!pairs ? (
          <div className="nt-ask-status">
            <Loader2 size={15} className="spin" /> Ищу почти одинаковые заметки…
          </div>
        ) : pairs.length === 0 ? (
          <p className="nt-dups-empty">Дублей нет — все заметки разные.</p>
        ) : (
          <>
            <p className="nt-dups-hint">«Оставить эту» — вторая заметка добавится в её конец и уйдёт в корзину (её можно вернуть).</p>
            <div className="nt-dups-list">
              {pairs.map((p) => (
                <div key={p.a + '|' + p.b} className={`nt-dups-pair${busy === p.a + p.b ? ' is-busy' : ''}`}>
                  <div className="nt-dups-score">{Math.round(p.score * 100)}%</div>
                  <div className="nt-dups-sides">
                    {side(p, p.a)}
                    {side(p, p.b)}
                  </div>
                  <button
                    className="nt-ai-undo"
                    onClick={() => {
                      markNotDuplicate(p.a, p.b);
                      drop(p);
                    }}
                  >
                    Это не дубли
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
