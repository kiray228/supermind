/** Кнопки голосовой команды: пункт в боковой панели (компьютер) и круглая кнопка в центре панели вкладок (телефон) */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Microphone } from '@phosphor-icons/react';
import { openVoice } from './state';
import { IconTile, type SectionId } from '../ui/icons';
import { createThing, type CreateKind } from '../ui/createActions';
import { haptic } from '../editor/touch';
import './button.css';

export function VoiceNavButton() {
  return (
    <button className="nav-item vc-nav" onClick={openVoice} title="Голосовая команда">
      <span className="nav-ico">
        <Microphone size={24} weight="fill" />
      </span>
      <span>Голосом</span>
    </button>
  );
}

const CREATE: { kind: CreateKind; label: string; section: SectionId }[] = [
  { kind: 'task', label: 'Задача', section: 'tasks' },
  { kind: 'note', label: 'Заметка', section: 'notes' },
  { kind: 'map', label: 'Карта', section: 'home' },
  { kind: 'habit', label: 'Привычка', section: 'habits' },
  { kind: 'goal', label: 'Цель', section: 'goals' },
  { kind: 'expense', label: 'Трата', section: 'finance' },
];

/** Сколько держать микрофон, чтобы открылось меню «создать» */
const HOLD_MS = 420;

/** Телефон: нажал — говоришь, держишь — меню «создать» */
export function VoiceFab() {
  const [menu, setMenu] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  const down = () => {
    held.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      held.current = true;
      haptic(12);
      setMenu(true);
    }, HOLD_MS);
  };
  const cancel = () => clearTimeout(timer.current);
  const click = () => {
    cancel();
    // удержание уже открыло меню — отпускание не запускает голос
    if (held.current) {
      held.current = false;
      return;
    }
    openVoice();
  };
  const pick = (kind: CreateKind) => {
    setMenu(false);
    void createThing(kind);
  };

  return (
    <>
      <button
        className="vc-fab"
        onClick={click}
        onPointerDown={down}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Голосовая команда. Удерживайте, чтобы создать задачу, заметку или трату"
      >
        <Microphone size={28} weight="fill" />
      </button>
      {/* в document.body: панель вкладок со стеклом (backdrop-filter) иначе стала бы рамкой для fixed-слоя */}
      {menu &&
        createPortal(
          <div className="menu-layer vc-create-layer" onPointerDown={(e) => e.target === e.currentTarget && setMenu(false)}>
            <div className="vc-create" role="menu" aria-label="Создать">
              {CREATE.map((c) => (
                <button key={c.kind} role="menuitem" className="vc-create-item" onClick={() => pick(c.kind)}>
                  <IconTile section={c.section} size="sm" />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
            <p className="vc-create-hint">Или нажмите на микрофон и скажите, что создать</p>
          </div>,
          document.body,
        )}
    </>
  );
}
