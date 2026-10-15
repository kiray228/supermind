import { useEffect, useState, type ReactNode } from 'react';
import { BookOpenText, Clock, Compass, Copy, Loader2, Scissors, Unlink, X } from 'lucide-react';
import { confirmDialog, onBack } from '../../ui/dialogs';
import { toast } from '../../store/appStore';
import { type BrainReview, collectReview, markReviewSeen, splitNote } from '../brainReview';
import { openDigest } from '../digest';
import { openItem } from '../brain';
import { brainItem } from '../related';
import { useNotes } from '../store';

const days = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? 'день' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'дня' : 'дней';
  return `${n} ${w}`;
};

function Section({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="nt-rv-sec">
      <h3 className="nt-rv-h">
        {icon}
        {title}
      </h3>
      {hint && <p className="nt-rv-hint">{hint}</p>}
      {children}
    </section>
  );
}

/** Обзор мозга: что требует внимания на этой неделе */
export function BrainReviewSheet({ onClose, onDuplicates }: { onClose: () => void; onDuplicates: () => void }) {
  const notes = useNotes((s) => s.data?.notes);
  const [r, setR] = useState<BrainReview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => onBack(() => (onClose(), true)));
  useEffect(() => {
    markReviewSeen();
    let alive = true;
    void collectReview()
      .then((x) => alive && setR(x))
      .catch(() => alive && setR({ orphans: [], forgotten: [], dups: 0, long: [], topics: [] }));
    return () => {
      alive = false;
    };
  }, [rev]);

  const title = (id: string) => notes?.find((n) => n.id === id)?.title || brainItem(id)?.title || 'Без названия';
  const open = (id: string) => {
    onClose();
    void openItem(id);
  };

  const split = async (id: string, parts: number) => {
    const ok = await confirmDialog(`Разбить «${title(id)}»?`, `Разделов: ${parts}. Каждый станет отдельной заметкой, а в этой останутся вступление и ссылки на разделы.`, { okText: 'Разбить' });
    if (!ok) return;
    setBusy(id);
    try {
      const n = await splitNote(id);
      toast(n ? `Создано заметок: ${n}` : 'Разбивать нечего');
      setRev((x) => x + 1);
    } catch {
      toast('Не удалось разбить заметку');
    } finally {
      setBusy(null);
    }
  };

  const empty = r && !r.orphans.length && !r.forgotten.length && !r.dups && !r.long.length;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal nt-dups nt-rv" role="dialog" aria-label="Обзор мозга">
        <div className="nt-ask-head">
          <Compass size={19} className="nt-ask-logo" />
          <h2 className="grow">Обзор мозга</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        {!r ? (
          <div className="nt-ask-status nt-rv-loading">
            <Loader2 size={15} className="spin" /> Просматриваю записи…
          </div>
        ) : (
          <div className="nt-dups-list nt-rv-body">
            {empty && <p className="nt-dups-empty">Всё в порядке: заметки связаны, дублей нет. Можно составить конспект одной из тем.</p>}

            {r.forgotten.length > 0 && (
              <Section icon={<Clock size={16} />} title="Пригодятся сейчас" hint="Давно не открывали, но они связаны с тем, над чем вы работаете на этой неделе.">
                {r.forgotten.map((f) => (
                  <button key={f.id} className="nt-rv-row" onClick={() => open(f.id)}>
                    <span className="nt-rv-title">{title(f.id)}</span>
                    <span className="nt-rv-meta">
                      {days(f.days)} назад · связана с «{title(f.via)}»
                    </span>
                  </button>
                ))}
              </Section>
            )}

            {r.orphans.length > 0 && (
              <Section icon={<Unlink size={16} />} title="Без связей" hint="Ни с чем не связаны. Добавьте пару слов о теме или [[ссылку]] — и заметка встанет в граф.">
                {r.orphans.map((id) => (
                  <button key={id} className="nt-rv-row" onClick={() => open(id)}>
                    <span className="nt-rv-title">{title(id)}</span>
                    <span className="nt-rv-meta">{notes?.find((n) => n.id === id)?.preview.slice(0, 80)}</span>
                  </button>
                ))}
              </Section>
            )}

            {r.dups > 0 && (
              <Section icon={<Copy size={16} />} title="Дубли">
                <div className="nt-rv-line">
                  <span>Почти одинаковых пар: {r.dups}</span>
                  <button className="nt-ai-btn" onClick={onDuplicates}>
                    Разобрать
                  </button>
                </div>
              </Section>
            )}

            {r.long.length > 0 && (
              <Section icon={<Scissors size={16} />} title="Можно разбить" hint="Длинные заметки с разделами: разделы станут отдельными заметками со своими связями.">
                {r.long.map((l) => (
                  <div key={l.id} className={`nt-rv-line${busy === l.id ? ' is-busy' : ''}`}>
                    <button className="nt-rv-row grow" onClick={() => open(l.id)}>
                      <span className="nt-rv-title">{title(l.id)}</span>
                      <span className="nt-rv-meta">
                        {l.words.toLocaleString('ru-RU')} сл. · разделов: {l.parts}
                      </span>
                    </button>
                    <button className="nt-ai-btn" disabled={!!busy} onClick={() => void split(l.id, l.parts)}>
                      Разбить
                    </button>
                  </div>
                ))}
              </Section>
            )}

            {r.topics.length > 0 && (
              <Section icon={<BookOpenText size={16} />} title="Конспект темы" hint="ИИ соберёт записи темы в обзор: главное, решения, открытые вопросы — со ссылками.">
                <div className="nt-rv-topics">
                  {r.topics.map((t) => (
                    <button
                      key={t.c}
                      className="nt-rv-topic"
                      onClick={() => {
                        onClose();
                        openDigest(t.name, t.ids);
                      }}
                    >
                      {t.name}
                      <span className="nt-graph-topic-n">{t.ids.length}</span>
                    </button>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
