/** Окно «Создать карту с ИИ» — отдельным модулем: SDK Claude и список структур не нужны при запуске */
import { useState } from 'react';
import { Sparkles, X, Square } from 'lucide-react';
import type { StructureType } from '../types';
import { createAndOpen } from '../actions';
import { docFromMarkdown } from '../templates';
import { PROMPTS, streamText, AIError } from '../ai/claude';
import { STRUCTURES } from '../editor/Inspector';

export default function AICreate({ onClose }: { onClose(): void }) {
  const [idea, setIdea] = useState('');
  const [depth, setDepth] = useState<'brief' | 'normal' | 'deep'>('normal');
  const [structure, setStructure] = useState<StructureType>('map');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ac, setAc] = useState<AbortController | null>(null);

  const run = async () => {
    const c = new AbortController();
    setAc(c);
    setBusy(true);
    setErr('');
    setOut('');
    try {
      const p = idea.trim().length > 400 ? PROMPTS.textToMap(idea) : PROMPTS.generate(idea, depth);
      const text = await streamText({ system: p.system, messages: [{ role: 'user', content: p.user }], onText: setOut, signal: c.signal });
      const doc = docFromMarkdown(text.replace(/^```[a-z]*\n?/im, '').replace(/```\s*$/m, ''), undefined, structure);
      doc.sheets[0].themeId = ['classic', 'fire', 'ocean', 'candy', 'forest'][Math.floor(Math.random() * 5)];
      onClose();
      await createAndOpen(doc);
    } catch (e) {
      setErr(e instanceof AIError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ width: 'min(560px,100%)' }}>
        <div className="row">
          <div className="ai-badge-lg"><Sparkles size={18} /></div>
          <h2 className="grow">Создать карту с ИИ</h2>
          <button className="icon-btn" onClick={() => { ac?.abort(); onClose(); }}><X /></button>
        </div>
        {(
          <>
            <p className="muted small" style={{ margin: '8px 0 0' }}>Опишите идею одной фразой или вставьте целый текст — статью, конспект, заметки.</p>
            <textarea className="textarea" rows={4} style={{ marginTop: 12 }} autoFocus placeholder="Например: «Как подготовиться к марафону за 6 месяцев»" value={idea} onChange={(e) => setIdea(e.target.value)} disabled={busy} />
            <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
              <div className="segmented">
                {(['brief', 'normal', 'deep'] as const).map((d) => (
                  <button key={d} className={depth === d ? 'active' : ''} onClick={() => setDepth(d)}>{d === 'brief' ? 'Кратко' : d === 'normal' ? 'Стандарт' : 'Подробно'}</button>
                ))}
              </div>
              <select className="select" style={{ width: 'auto', flex: 1 }} value={structure} onChange={(e) => setStructure(e.target.value as StructureType)}>
                {STRUCTURES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {(busy || out) && <pre className="ai-preview">{out || 'Думаю…'}</pre>}
            {err && <div className="ai-err">{err}</div>}
            <div className="modal-actions">
              {busy ? (
                <button className="btn" onClick={() => ac?.abort()}><Square size={14} /> Остановить</button>
              ) : (
                <button className="btn btn-primary" disabled={!idea.trim()} onClick={run}><Sparkles size={16} /> Сгенерировать</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
