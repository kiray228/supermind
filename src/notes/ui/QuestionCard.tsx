import { useEffect, useState } from 'react';
import { t } from '../../i18n/index';
import { Flag, Loader2, MessageCircleQuestion, RefreshCw, X } from 'lucide-react';
import { reportAI } from '../../ui/ReportAI';
import { toast } from '../../store/appStore';
import { todayYmd } from '../../utils/mapTasks';
import { answerQuestion, dismissQuestion, ensureQuestion, nextQuestion, useQuestion } from '../question';
import { openNote } from '../store';

/** Вопрос дня: по давней заметке — ответ уходит в заметку дня (и, если хочется, в саму заметку) */
export function QuestionCard() {
  const { q, busy } = useQuestion();
  const [text, setText] = useState('');
  const [toNote, setToNote] = useState(true);
  const [saving, setSaving] = useState(false);

  // готовить вопрос — не сразу: не мешать первому показу списка
  useEffect(() => {
    const t = setTimeout(() => void ensureQuestion().catch(() => undefined), 2500);
    return () => clearTimeout(t);
  }, []);

  if (!q || q.day !== todayYmd() || q.state !== 'open') return null;

  const send = async () => {
    setSaving(true);
    try {
      if (await answerQuestion(text, toNote)) {
        toast(toNote ? t('Ответ — в заметке дня и в заметке') : t('Ответ — в заметке дня'));
        setText('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="nt-q">
      <div className="nt-q-head">
        <MessageCircleQuestion size={17} />
        <span className="grow">
          {t('Вопрос дня · по заметке')}{' '}
          <button className="nt-q-src" onClick={() => void openNote(q.noteId)}>
            «{q.title}»
          </button>
        </span>
        <button className="icon-btn" onClick={() => void nextQuestion()} disabled={busy} aria-label={t('Другой вопрос')} title={t('Другой вопрос')}>
          {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
        </button>
        <button className="icon-btn" onClick={() => reportAI(q.question, 'Вопрос дня')} aria-label={t('Пожаловаться на вопрос ИИ')} title={t('Пожаловаться на вопрос ИИ')}>
          <Flag size={15} />
        </button>
        <button className="icon-btn" onClick={dismissQuestion} aria-label={t('Не сегодня')} title={t('Не сегодня')}>
          <X size={16} />
        </button>
      </div>
      <div className="nt-q-text">{q.question}</div>
      <textarea className="nt-syn-input nt-q-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Пара слов — что думаешь сейчас')} aria-label={t('Ответ')} />
      <div className="nt-q-actions">
        <label className="nt-q-check">
          <input type="checkbox" checked={toNote} onChange={(e) => setToNote(e.target.checked)} /> {t('дописать в заметку')}
        </label>
        <button className="nt-ai-btn" disabled={!text.trim() || saving} onClick={() => void send()}>
          {t('Ответить')}
        </button>
      </div>
    </div>
  );
}
