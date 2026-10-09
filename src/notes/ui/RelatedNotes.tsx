import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Sparkles, Waypoints } from 'lucide-react';
import type { ID } from '../../types';
import { pairKey } from '../links';
import { showInGraph, useLinks, useRelatedNotes } from '../related';
import { openLinkedNote, useNotes } from '../store';
import { AiReviewPanel } from './AiReviewPanel';

/** Сила связи: 1–3 деления */
const level = (score: number) => (score >= 0.3 ? 3 : score >= 0.16 ? 2 : 1);
const LEVEL_LABEL = ['', 'слабая связь', 'заметная связь', 'сильная связь'];

/** Связанные заметки внизу открытой заметки: связи находятся сами — по общим важным словам и упоминаниям */
export function RelatedNotes({ id }: { id: ID }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const { list, keywords, loading } = useRelatedNotes(id, visible);
  const progress = useLinks((s) => s.progress);
  const notes = useNotes((s) => s.data?.notes);
  const folders = useNotes((s) => s.data?.folders);
  const aiLinks = useNotes((s) => s.data?.aiLinks);
  const added = useNotes((s) => s.data?.aiTerms?.find((r) => r.id === id)?.add);
  const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е');
  const isAdded = (k: string) => !!added?.some((a) => norm(a) === norm(k));
  const verdict = (other: ID) => aiLinks?.find((r) => r.id === pairKey(id, other));

  const empty = !loading && !progress && !list.length;
  return (
    <section ref={ref} className={`nt-rel${empty && !keywords.length ? ' is-blank' : ''}`} aria-label="Связанные заметки">
      {keywords.length > 0 && (
        <div className="nt-rel-kw" title="Важные слова заметки — по ним находятся связи">
          <span className="nt-rel-kw-label">Темы</span>
          {keywords.map((k) => (
            <span key={k} className={`nt-rel-chip${isAdded(k) ? ' is-ai' : ''}`} title={isAdded(k) ? 'Тему добавил ИИ' : undefined}>
              {isAdded(k) && <Sparkles size={11} />}
              {k}
            </span>
          ))}
        </div>
      )}
      <div className="nt-rel-head">
        <Waypoints size={16} />
        <span>Связанные заметки</span>
        {list.length > 0 && <span className="nt-rel-count">{list.length}</span>}
        <div className="grow" />
        {list.length > 0 && (
          <button className="nt-rel-graph" onClick={() => showInGraph(id)}>
            На графе
          </button>
        )}
      </div>
      {progress && (
        <div className="nt-rel-progress">
          <div className="nt-rel-bar">
            <span style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <span className="faint tiny">
            Анализирую заметки… {progress.done} из {progress.total}
          </span>
        </div>
      )}
      {list.length > 0 && (
        <div className="nt-rel-list">
          {list.map((r) => {
            const m = notes?.find((n) => n.id === r.id);
            if (!m) return null;
            const f = folders?.find((x) => x.id === m.folderId);
            const lv = level(r.score);
            const v = r.confirmed ? verdict(r.id) : undefined;
            return (
              <button key={r.id} className="nt-rel-item" onClick={() => openLinkedNote(r.id)} style={f ? ({ '--fc': f.color } as CSSProperties) : undefined}>
                <span className="nt-rel-str" data-l={lv} title={LEVEL_LABEL[lv]} aria-label={LEVEL_LABEL[lv]}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="nt-rel-body">
                  <span className={`nt-rel-title${m.title ? '' : ' is-empty'}`}>{m.title || m.preview || 'Без названия'}</span>
                  <span className="nt-rel-why">
                    {r.confirmed && (
                      <span className="nt-rel-ok" title={v?.by === 'user' ? 'Связь подтвердили вы' : 'Связь подтвердил ИИ'}>
                        <Check size={11} />
                        {v?.by === 'user' ? 'вы' : 'ИИ'}
                      </span>
                    )}
                    {r.mention && <span className="nt-rel-mention">упоминание</span>}
                    {v?.why || r.terms.join(' · ')}
                  </span>
                </span>
                {f && <span className="nt-rel-folder" title={f.name} />}
                <ChevronRight size={16} className="nt-rel-go" />
              </button>
            );
          })}
        </div>
      )}
      {empty && keywords.length > 0 && <div className="nt-rel-empty">Похожих заметок пока нет. Связь появится сама, когда эти темы встретятся в другой заметке.</div>}
      {keywords.length > 0 && <AiReviewPanel id={id} />}
    </section>
  );
}
