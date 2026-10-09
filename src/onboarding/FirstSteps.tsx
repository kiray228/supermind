/** Карточка «Первые шаги» (экран ассистента): чек-лист первой недели, отметки — из данных */
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';
import { isNative } from '../platform';
import { toast, useApp } from '../store/appStore';
import { useTasks } from '../tasks/store';
import { notifyPermission, requestNotifyPermission } from '../tasks/sync';
import { enablePush, pushActive, pushSupported } from '../store/push';
import { ensureProgressSources, useProgressExtra } from '../progress/hooks';
import { checklistWindowOpen, firstSteps, hideChecklist, type Step } from './checklist';
import './onboarding.css';

/** Уведомления действительно дойдут: в вебе с push — только при активной подписке */
async function notificationsReady(): Promise<boolean> {
  if (!isNative() && pushSupported()) return pushActive();
  return (await notifyPermission().catch(() => 'unsupported')) === 'granted';
}

export function FirstSteps() {
  const [open, setOpen] = useState(() => checklistWindowOpen());
  const [notify, setNotify] = useState(false);
  const tasks = useTasks((s) => s.data);
  const planner = useProgressExtra((s) => s.planner);
  const docs = useProgressExtra((s) => s.docs);
  const go = useApp((s) => s.go);

  useEffect(() => {
    if (!open) return;
    ensureProgressSources();
    void notificationsReady().then(setNotify);
  }, [open]);

  const steps = useMemo(() => firstSteps({ tasks, planner, docs, notifications: notify }), [tasks, planner, docs, notify]);
  const done = steps.filter((s) => s.done).length;
  // данные ещё читаются — не мигать карточкой
  if (!open || !tasks || !planner || !docs || done === steps.length) return null;

  const dismiss = () => {
    hideChecklist();
    setOpen(false);
  };

  const pick = async (s: Step) => {
    if (s.to !== 'notify') return go(s.to);
    if (isNative()) {
      const r = await requestNotifyPermission();
      if (r === 'denied') toast('Уведомления запрещены — разрешите их в настройках телефона');
    } else if (pushSupported()) {
      const r = await enablePush().catch(() => ({ ok: false, message: 'Не удалось включить уведомления' }));
      toast(r.message);
    } else {
      // iPhone в Safari (не с экрана «Домой») — там подсказка, как включить
      return go('settings');
    }
    setNotify(await notificationsReady());
  };

  return (
    <section className="card fs-card" aria-label="Первые шаги">
      <div className="fs-head">
        <div className="grow">
          <div className="fs-title">Первые шаги</div>
          <div className="fs-sub">
            {done} из {steps.length} — освоитесь за пару минут
          </div>
        </div>
        <button className="icon-btn fs-close" onClick={dismiss} aria-label="Скрыть «Первые шаги»" title="Скрыть">
          <X size={18} />
        </button>
      </div>
      <div className="fs-bar" aria-hidden>
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ul className="fs-list">
        {steps.map((s) => (
          <li key={s.id}>
            <button className={`fs-step${s.done ? ' done' : ''}`} onClick={() => void pick(s)} disabled={s.done}>
              <span className="fs-check" aria-hidden>
                {s.done && <Check size={13} strokeWidth={3} />}
              </span>
              <span className="fs-text">
                <b>{s.title}</b>
                {!s.done && <small>{s.hint}</small>}
              </span>
              {!s.done && <ChevronRight size={16} className="fs-chev" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
