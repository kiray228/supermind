/** Кнопки голосовой команды: пункт в боковой панели (компьютер) и круглая кнопка рядом с вкладками (телефон) */
import { Microphone } from '@phosphor-icons/react';
import { openVoice } from './state';
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

export function VoiceFab() {
  return (
    <button className="vc-fab" onClick={openVoice} aria-label="Голосовая команда">
      <Microphone size={28} weight="fill" />
    </button>
  );
}
