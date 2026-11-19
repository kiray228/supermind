import { useEffect, useState } from 'react';
import { ChartPie, PaperPlaneTilt, Smiley } from '@phosphor-icons/react';
import { hasOwnKey } from '../ai/claude';
import { aiConsentGiven, setAiConsent } from '../ai/consent';
import { assistantPrivacy, setAssistantPrivacy } from '../assistant/privacy';
import { IconTile } from './icons';
import { ListSection, SwitchRow } from './list';
import { t } from '../i18n/index';

/** Настройки → «Что видит ассистент»: куда уходят данные и что можно не показывать */
export function AiPrivacySettings() {
  const [p, setP] = useState(assistantPrivacy);
  // согласие — на того, кто сейчас отвечает: свой ключ Claude или бесплатный ИИ на сервере
  const provider = hasOwnKey() ? 'claude' : 'server';
  const [consent, setConsent] = useState(() => aiConsentGiven(provider));
  // изменили на другом устройстве
  useEffect(() => {
    const on = () => setP(assistantPrivacy());
    window.addEventListener('sm-prefs-changed', on);
    return () => window.removeEventListener('sm-prefs-changed', on);
  }, []);
  const flip = (k: 'finance' | 'mood', v: boolean) => {
    setAssistantPrivacy({ [k]: v });
    setP(assistantPrivacy());
  };
  return (
    <ListSection
      header={t('Что видит ассистент')}
      footer={t('Чтобы отвечать про ваш день, ассистент получает сводку: задачи, привычки, цели, названия последних заметок — и то, что включено выше. Со своим ключом Claude она уходит прямо в Anthropic. Без ключа — через сервер SuperMind в Google Gemini или Groq (они могут использовать запросы для улучшения моделей); сервер текст не сохраняет, только считает запросы для дневного лимита. Без разрешения на отправку функции ИИ не работают.')}
    >
      <SwitchRow
        icon={<IconTile icon={PaperPlaneTilt} tone="blue" size="list" />}
        title={t('Отправлять данные ИИ')}
        subtitle={provider === 'claude' ? t('В Anthropic (Claude) по вашему ключу') : t('Бесплатной модели Google Gemini или Groq')}
        checked={consent}
        onChange={(v) => {
          setAiConsent(provider, v);
          setConsent(v);
        }}
      />
      <SwitchRow icon={<IconTile icon={ChartPie} tone="green" size="list" />} title={t('Финансы')} subtitle={t('Траты, доходы, счета, подписки')} checked={p.finance} onChange={(v) => flip('finance', v)} />
      <SwitchRow icon={<IconTile icon={Smiley} tone="yellow" size="list" />} title={t('Настроение')} subtitle={t('Из дневника за последние дни')} checked={p.mood} onChange={(v) => flip('mood', v)} />
    </ListSection>
  );
}
