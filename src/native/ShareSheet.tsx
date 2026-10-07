import { useEffect, useState } from 'react';
import { CheckSquare, Network, StickyNote } from 'lucide-react';
import { shareToMap, shareToNote, shareToTask, type SharedText } from './share';

/** Окно «Сохранить в SuperMind» для присланного текста: задача / заметка / карта «Входящие» */
export default function ShareSheet({ shared, onClose }: { shared: SharedText; onClose: () => void }) {
  const [text, setText] = useState(shared.text);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const run = (fn: (s: SharedText) => Promise<void>) => async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await fn({ text: text.trim(), title: shared.title });
    } finally {
      onClose();
    }
  };
  const btn = { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: 'auto', padding: '12px 6px', whiteSpace: 'normal', lineHeight: 1.2 } as const;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(460px,100%)' }}>
        <h2>Сохранить в SuperMind</h2>
        {shared.title && <p className="muted" style={{ margin: '6px 0 0' }}>{shared.title}</p>}
        <textarea className="textarea" style={{ marginTop: 12 }} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary" style={btn} disabled={busy} onClick={run(shareToTask)}>
            <CheckSquare size={20} />
            Задача
          </button>
          <button className="btn" style={btn} disabled={busy} onClick={run(shareToNote)}>
            <StickyNote size={20} />
            Заметка
          </button>
          <button className="btn" style={btn} disabled={busy} onClick={run(shareToMap)}>
            <Network size={20} />В карту (входящие)
          </button>
        </div>
        <div className="modal-actions" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
