import { useEffect, useState } from 'react';
import { BookOpenText, GraduationCap, Loader2, RotateCcw, Save, Square, X } from 'lucide-react';
import { onBack } from '../../ui/dialogs';
import { toast } from '../../store/appStore';
import { closeDigest, digestCards, runDigest, saveDigest, stopDigest, useDigest } from '../digest';
import { openCardsReview } from '../cards';
import { openItem } from '../brain';
import { parseItemId } from '../brainDocs';
import { CitedText } from './CitedText';
import { KIND_ICON } from './kindIcons';
import { ReportAI } from '../../ui/ReportAI';

function openSource(id: string) {
  closeDigest();
  void openItem(id);
}

/** Конспект темы: ИИ собирает записи темы в обзор со ссылками на источники */
export function TopicDigest() {
  const st = useDigest();
  const [srcOpen, setSrcOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [carding, setCarding] = useState(false);

  useEffect(() => {
    if (!st.open) return;
    return onBack(() => (closeDigest(), true));
  }, [st.open]);

  if (!st.open) return null;
  const busy = st.state === 'collect' || st.state === 'write';

  const save = async () => {
    setSaving(true);
    try {
      const id = await saveDigest();
      if (id) toast('Конспект сохранён заметкой');
    } catch {
      toast('Не удалось сохранить конспект');
    } finally {
      setSaving(false);
    }
  };

  const cards = async () => {
    setCarding(true);
    try {
      const r = await digestCards();
      if (!r) return;
      if (r.added)
        toast(`Карточек по теме: ${r.added}. Конспект сохранён заметкой`, {
          label: 'Повторить',
          run: () => {
            closeDigest();
            openCardsReview();
          },
        });
      else toast('Новых карточек не получилось — всё главное уже есть');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сделать карточки');
    } finally {
      setCarding(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeDigest()}>
      <div className="modal nt-ask nt-digest" role="dialog" aria-label={`Конспект темы «${st.topic}»`}>
        <div className="nt-ask-head">
          <BookOpenText size={19} className="nt-ask-logo" />
          <h2 className="grow ellipsis">Конспект: {st.topic}</h2>
          <button className="icon-btn" onClick={closeDigest} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <div className="nt-ask-body">
          {st.sources.length > 0 && (
            <div className="nt-ask-sources">
              <button className="nt-ask-src-toggle" onClick={() => setSrcOpen(!srcOpen)} aria-expanded={srcOpen}>
                Записей темы: {st.sources.length}
              </button>
              {(srcOpen ? st.sources : st.sources.slice(0, 4)).map((s) => {
                const Icon = KIND_ICON[parseItemId(s.id).kind];
                return (
                  <button key={s.n} className="nt-ask-src" onClick={() => openSource(s.id)} title={`${s.kind} «${s.title}»`}>
                    <span className="nt-ask-src-n">{s.n}</span>
                    <Icon size={13} />
                    <span className="ellipsis">{s.title || 'Без названия'}</span>
                  </button>
                );
              })}
              {!srcOpen && st.sources.length > 4 && (
                <button className="nt-ask-src-more" onClick={() => setSrcOpen(true)}>
                  ещё {st.sources.length - 4}
                </button>
              )}
            </div>
          )}
          {st.state === 'collect' && (
            <div className="nt-ask-status">
              <Loader2 size={15} className="spin" /> Собираю записи темы…
            </div>
          )}
          {st.state === 'write' && !st.text && (
            <div className="nt-ask-status">
              <Loader2 size={15} className="spin" /> Составляю конспект…
            </div>
          )}
          {st.text && <CitedText text={st.text} sources={st.sources} onOpen={openSource} />}
          {st.state === 'done' && st.text && <ReportAI text={st.text} where={`Конспект темы «${st.topic}»`} />}
          {st.state === 'error' && <div className="nt-ask-error">{st.error}</div>}
        </div>
        <div className="nt-digest-actions">
          {busy ? (
            <button className="nt-ai-btn" onClick={stopDigest}>
              <Square size={14} /> Остановить
            </button>
          ) : (
            <>
              <button className="nt-ai-btn nt-digest-save" disabled={st.state !== 'done' || saving} onClick={() => void save()}>
                {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Сохранить заметкой
              </button>
              <button className="nt-ai-btn" disabled={st.state !== 'done' || carding || saving} onClick={() => void cards()} title="ИИ сделает карточки для повторения по конспекту">
                {carding ? <Loader2 size={15} className="spin" /> : <GraduationCap size={15} />} Карточки
              </button>
              <button className="nt-ai-undo" onClick={() => void runDigest()}>
                <RotateCcw size={14} /> Заново
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
