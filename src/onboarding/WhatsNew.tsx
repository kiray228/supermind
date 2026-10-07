/** Окно «Что нового» */
import { Gift, X } from 'lucide-react';
import { APP_VERSION } from '../store/safety';
import { entriesFor } from './changelog';
import { useWhatsNew } from './state';

export default function WhatsNew({ onClose }: { onClose: () => void }) {
  const open = useWhatsNew((s) => s.open);
  const since = useWhatsNew((s) => s.since);
  const entries = entriesFor(APP_VERSION, since, open === 'all');
  if (!entries.length) return null;
  const [head, ...rest] = entries;

  return (
    <div className="modal-backdrop wn-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wn-sheet" role="dialog" aria-modal="true" aria-labelledby="wn-title">
        <button className="icon-btn wn-close" onClick={onClose} aria-label="Закрыть">
          <X size={18} />
        </button>
        <div className="wn-head">
          <span className="wn-badge">
            <Gift size={22} />
          </span>
          <div>
            <h2 id="wn-title">Что нового</h2>
            <p className="wn-sub">
              SuperMind {head.version} · {head.title}
            </p>
          </div>
        </div>
        <div className="wn-body">
          <ul className="wn-items">
            {head.items.map((it) => (
              <li key={it.title}>
                <span className="wn-ico">
                  <it.icon size={18} />
                </span>
                <span>
                  <b>{it.title}</b>
                  <small>{it.text}</small>
                </span>
              </li>
            ))}
          </ul>
          {rest.map((e) => (
            <details key={e.version} className="wn-older" open={open === 'auto'}>
              <summary>
                <span className="wn-ver">{e.version}</span> {e.title}
              </summary>
              <ul className="wn-items wn-items-sm">
                {e.items.map((it) => (
                  <li key={it.title}>
                    <span className="wn-ico">
                      <it.icon size={16} />
                    </span>
                    <span>
                      <b>{it.title}</b>
                      <small>{it.text}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
        <button className="btn btn-primary btn-block wn-ok" onClick={onClose}>
          Отлично
        </button>
      </div>
    </div>
  );
}
