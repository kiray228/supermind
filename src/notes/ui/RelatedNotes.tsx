import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Link2, Sparkles, Waypoints } from 'lucide-react';
import type { ID } from '../../types';
import { pairKey } from '../links';
import { KIND_LABEL, parseItemId } from '../brainDocs';
import { KIND_ICON } from './kindIcons';
import { openItem } from '../brain';
import { brainItem, isWikiLink, showInGraph, useLinks, useRelatedNotes } from '../related';
import { useNotes } from '../store';
import { AiReviewPanel } from './AiReviewPanel';
import { Backlinks, DuplicateBanner } from './Backlinks';
import './related.css';

/** Сила связи: 1–3 деления */
const level = (score: number) => (score >= 0.3 ? 3 : score >= 0.16 ? 2 : 1);
const LEVEL_LABEL = ['', 'слабая связь', 'заметная связь', 'сильная связь'];

/**
 * Связанное с единицей мозга: заметки, карты, задачи и цели — связи находятся сами (по общим важным словам,
 * упоминаниям и [[ссылкам]]). В заметке — с темами и проверкой ИИ; в задаче и цели — компактно (compact).
 */
export function RelatedNotes({ id, compact = false }: { id: ID; compact?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const { list, keywords, loading } = useRelatedNotes(id, visible, compact ? 6 : 8);
  const progress = useLinks((s) => s.progress);
  const folders = useNotes((s) => s.data?.folders);
  const notes = useNotes((s) => s.data?.notes);
  const aiLinks = useNotes((s) => s.data?.aiLinks);
  const added = useNotes((s) => s.data?.aiTerms?.find((r) => r.id === id)?.add);
  const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е');
  const isAdded = (k: string) => !!added?.some((a) => norm(a) === norm(k));
  const verdict = (other: ID) => aiLinks?.find((r) => r.id === pairKey(id, other));
  const isNote = parseItemId(id).kind === 'note';

  const empty = !loading && !progress && !list.length;
  // в задаче и цели пустую панель не показываем вовсе
  if (compact && empty) return <section ref={ref} className="nt-rel is-blank" aria-hidden />;
  // у пустой заметки своих связей нет, но на неё могут ссылаться другие — только «Упоминается в»
  if (empty && !keywords.length)
    return (
      <section ref={ref} className="nt-rel is-quiet" aria-label="Упоминается в">
        <Backlinks id={id} />
      </section>
    );
  return (
    <section ref={ref} className={`nt-rel${compact ? ' is-compact' : ''}${empty && !keywords.length ? ' is-blank' : ''}`} aria-label="Связи">
      {!compact && isNote && <DuplicateBanner id={id} />}
      {!compact && keywords.length > 0 && (
        <div className="nt-rel-kw" title="Важные слова — по ним находятся связи">
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
        <span>Связи</span>
        {list.length > 0 && <span className="nt-rel-count">{list.length}</span>}
        <div className="grow" />
        {list.length > 0 && !compact && (
          <button className="nt-rel-graph" onClick={() => showInGraph(id)}>
            На графе
          </button>
        )}
      </div>
      {progress && !compact && (
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
            const m = brainItem(r.id);
            if (!m) return null;
            const meta = m.kind === 'note' ? notes?.find((n) => n.id === r.id) : undefined;
            const f = meta?.folderId ? folders?.find((x) => x.id === meta.folderId) : undefined;
            const lv = level(r.score);
            const wiki = isWikiLink(id, r.id);
            const v = r.confirmed && !wiki ? verdict(r.id) : undefined;
            const Icon = KIND_ICON[m.kind];
            return (
              <button
                key={r.id}
                className={`nt-rel-item${m.done ? ' is-done' : ''}`}
                onClick={() => void openItem(r.id, { fromNote: isNote })}
                style={f ? ({ '--fc': f.color } as CSSProperties) : undefined}
              >
                <span className="nt-rel-str" data-l={wiki ? 3 : lv} title={wiki ? 'Явная ссылка' : LEVEL_LABEL[lv]} aria-label={wiki ? 'Явная ссылка' : LEVEL_LABEL[lv]}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="nt-rel-body">
                  <span className={`nt-rel-title${m.title ? '' : ' is-empty'}`}>
                    {m.kind !== 'note' && <Icon size={14} className="nt-rel-kind" aria-label={KIND_LABEL[m.kind]} />}
                    {m.title || m.preview || 'Без названия'}
                  </span>
                  <span className="nt-rel-why">
                    {wiki && (
                      <span className="nt-rel-wiki" title="Связаны [[ссылкой]]">
                        <Link2 size={11} />
                        ссылка
                      </span>
                    )}
                    {r.confirmed && !wiki && (
                      <span className="nt-rel-ok" title={v?.by === 'user' ? 'Связь подтвердили вы' : 'Связь подтвердил ИИ'}>
                        <Check size={11} />
                        {v?.by === 'user' ? 'вы' : 'ИИ'}
                      </span>
                    )}
                    {r.mention && !wiki && <span className="nt-rel-mention">упоминание</span>}
                    {v?.why || r.terms.join(' · ') || KIND_LABEL[m.kind]}
                  </span>
                </span>
                {f && <span className="nt-rel-folder" title={f.name} />}
                <ChevronRight size={16} className="nt-rel-go" />
              </button>
            );
          })}
        </div>
      )}
      {!compact && empty && keywords.length > 0 && <div className="nt-rel-empty">Связей пока нет. Они появятся сами, когда эти темы встретятся в другой заметке, карте или задаче.</div>}
      {!compact && <Backlinks id={id} />}
      {!compact && isNote && keywords.length > 0 && <AiReviewPanel id={id} />}
    </section>
  );
}
