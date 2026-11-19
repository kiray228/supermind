import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LayoutTemplate, ListChecks, Pencil, Trash2, X } from 'lucide-react';
import { onBack, askText } from '../../ui/dialogs';
import { toast } from '../../store/appStore';
import type { TaskItem } from '../model';
import { useTasks } from '../store';
import { t } from '../../i18n/index';
import { deleteTaskTemplate, renameTaskTemplate, taskFromTemplate } from '../templates';

/** Список шаблонов задач: нажатие — новая задача по шаблону (с датой и списком текущего раздела) */
export function TaskTemplatesSheet({ preset, onClose }: { preset: Partial<TaskItem>; onClose: () => void }) {
  const templates = useTasks((s) => s.data?.templates ?? []);
  const sorted = [...templates].sort((a, b) => b.createdAt - a.createdAt);
  useEffect(() => onBack(() => (onClose(), true)), [onClose]);

  const use = (id: string) => {
    const task = taskFromTemplate(id, preset);
    onClose();
    if (task) toast(t('Задача «{title}» создана по шаблону', { title: task.title }));
  };

  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tk-tpl-sheet" role="dialog" aria-label={t('Шаблоны задач')}>
        <div className="tk-tpl-head">
          <LayoutTemplate size={18} />
          <h3 className="grow">{t('Шаблоны задач')}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('Закрыть')}>
            <X size={18} />
          </button>
        </div>
        {sorted.length === 0 ? (
          <p className="muted small tk-tpl-empty">
            {t('Шаблонов пока нет. Откройте задачу, которую делаете снова и снова (сборы в поездку, отчёт, уборка), и в меню «⋯» выберите «Сохранить как шаблон» — название, описание, чек-лист, теги и время сохранятся.')}
          </p>
        ) : (
          <div className="tk-tpl-list">
            {sorted.map((tpl) => (
              <div key={tpl.id} className="tk-tpl-row">
                <button className="tk-tpl-use" onClick={() => use(tpl.id)}>
                  <span className="tk-tpl-name ellipsis">{tpl.name}</span>
                  <span className="tk-tpl-sub ellipsis">
                    {tpl.checklist.length > 0 && (
                      <>
                        <ListChecks size={12} /> {tpl.checklist.length} ·{' '}
                      </>
                    )}
                    {[tpl.time, ...tpl.tags.map((g) => '#' + g)].filter(Boolean).join(' · ') || (tpl.title !== tpl.name ? tpl.title : t('Задача'))}
                  </span>
                </button>
                <button
                  className="icon-btn"
                  aria-label={t('Переименовать шаблон')}
                  onClick={async () => {
                    const n = await askText(t('Название шаблона'), { value: tpl.name });
                    if (n?.trim()) renameTaskTemplate(tpl.id, n);
                  }}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={t('Удалить шаблон')}
                  onClick={() => {
                    deleteTaskTemplate(tpl.id);
                    toast(t('Шаблон «{name}» удалён', { name: tpl.name }));
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
