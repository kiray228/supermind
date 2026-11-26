/** Настройки → «ИИ-помощник»: черновики заранее для задач со сроком («Сделать с ИИ» — в самой задаче) */
import { Sparkle } from '@phosphor-icons/react';
import { hasOwnKey } from '../ai/claude';
import { askAiConsent } from '../ai/consent';
import { useApp } from '../store/appStore';
import { IconTile } from './icons';
import { ListSection, SwitchRow } from './list';
import { t } from '../i18n/index';

export function AiHelperSettings() {
  const drafts = useApp((s) => !!s.settings.aiDrafts);
  return (
    <ListSection
      header={t('ИИ-помощник')}
      footer={t('«Сделать с ИИ» есть в каждой задаче: встроенный ИИ сразу делает презентацию, текст или письмо и сохраняет результат в заметки.')}
    >
      <SwitchRow
        icon={<IconTile icon={Sparkle} tone="violet" size="list" />}
        title={t('Черновики заранее')}
        subtitle={t('Когда срок близко, ИИ сам готовит черновик задачи — до двух в день')}
        checked={drafts}
        onChange={(v) =>
          void (async () => {
            if (v && !(await askAiConsent(hasOwnKey() ? 'claude' : 'server'))) return;
            useApp.getState().setSettings({ aiDrafts: v || undefined });
          })()
        }
      />
    </ListSection>
  );
}
