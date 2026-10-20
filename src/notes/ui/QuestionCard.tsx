import { useEffect, useState } from 'react';
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
        toast(toNote ? 'Ответ — в заметке дня и в заметке' : 'Ответ — в заметке дня');
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
          Вопрос дня · по заметке{' '}
          <button className="nt-q-src" onClick={() => void openNote(q.noteId)}>
            «{q.title}»
          </button>
        </span>
        <button className="icon-btn" onClick={() => void nextQuestion()} disabled={busy} aria-label="Другой вопрос" title="Другой вопрос">
          {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
        </button>
        <button className="icon-btn" onClick={() => reportAI(q.question, 'Вопрос дня')} aria-label="Пожаловаться на вопрос ИИ" title="Пожаловаться на вопрос ИИ">
          <Flag size={15} />
        </button>
        <button className="icon-btn" onClick={dismissQuestion} aria-label="Не сегодня" title="Не сегодня">
          <X size={16} />
        </button>
      </div>
      <div className="nt-q-text">{q.question}</div>
      <textarea className="nt-syn-input nt-q-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Пара слов — что думаешь сейчас" aria-label="Ответ" />
      <div className="nt-q-actions">
        <label className="nt-q-check">
          <input type="checkbox" checked={toNote} onChange={(e) => setToNote(e.target.checked)} /> дописать в заметку
        </label>
        <button className="nt-ai-btn" disabled={!text.trim() || saving} onClick={() => void send()}>
          Ответить
        </button>
      </div>
    </div>
  );
}
