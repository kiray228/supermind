import { useState } from 'react';
import { ChartPie, Smiley } from '@phosphor-icons/react';
import { assistantPrivacy, setAssistantPrivacy } from '../assistant/privacy';
import { IconTile } from './icons';
import { ListSection, SwitchRow } from './list';

/** Настройки → «Что видит ассистент»: куда уходят данные и что можно не показывать */
export function AiPrivacySettings() {
  const [p, setP] = useState(assistantPrivacy);
  const flip = (k: 'finance' | 'mood', v: boolean) => {
    setAssistantPrivacy({ [k]: v });
    setP(assistantPrivacy());
  };
  return (
    <ListSection
      header="Что видит ассистент"
      footer="Чтобы отвечать про ваш день, ассистент получает сводку: задачи, привычки, цели, названия последних заметок — и то, что включено выше. Со своим ключом Claude она уходит прямо в Anthropic. Без ключа — через сервер SuperMind в Google Gemini; сервер текст не сохраняет, только считает запросы для дневного лимита."
    >
      <SwitchRow icon={<IconTile icon={ChartPie} tone="green" size="list" />} title="Финансы" subtitle="Траты, доходы, счета, подписки" checked={p.finance} onChange={(v) => flip('finance', v)} />
      <SwitchRow icon={<IconTile icon={Smiley} tone="yellow" size="list" />} title="Настроение" subtitle="Из дневника за последние дни" checked={p.mood} onChange={(v) => flip('mood', v)} />
    </ListSection>
  );
}
