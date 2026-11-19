/** Неброская кнопка «Пожаловаться» рядом с ответом ИИ — открывает поддержку с заготовкой жалобы */
import { Flag } from '@phosphor-icons/react';
import { aiReportText } from '../ai/report';
import { openSupport } from './Support';
import { t } from '../i18n/index';

export const reportAI = (answer: string, where: string) => openSupport('problem', aiReportText(answer, where));

export function ReportAI({ text, where, className = 'ai-report' }: { text: string; where: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => reportAI(text, where)} title={t('Пожаловаться на ответ ИИ')} aria-label={t('Пожаловаться на ответ ИИ')}>
      <Flag size={13} /> {t('Пожаловаться')}
    </button>
  );
}
