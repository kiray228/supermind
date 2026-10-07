/**
 * Сгруппированные списки в стиле iOS («Настройки»): группы со скруглением на сером фоне,
 * строки 44–52 pt, тонкие разделители с отступом, цветная плитка слева, значение/шеврон справа,
 * заголовки и подписи секций. Плюс переключатель (UISwitch) и строка-выбор (меню iOS).
 */
import type { ChangeEvent, ReactNode } from 'react';
import { CaretRight, CaretUpDown } from '@phosphor-icons/react';
import './list.css';

interface SectionProps {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Секция: заголовок, группа строк, подпись снизу */
export function ListSection({ header, footer, children, className }: SectionProps) {
  return (
    <section className={`ls-section${className ? ' ' + className : ''}`}>
      {header && <h3 className="ls-header">{header}</h3>}
      <div className="ls-group">{children}</div>
      {footer && <div className="ls-footer">{footer}</div>}
    </section>
  );
}

type Tone = 'default' | 'accent' | 'danger';

interface RowProps {
  /** плитка слева (обычно <IconTile size="list" />) */
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** значение справа серым */
  value?: ReactNode;
  /** свои элементы справа (кнопка, переключатель) */
  trailing?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  /** accent — строка-кнопка цвета акцента, danger — красная */
  tone?: Tone;
  disabled?: boolean;
  className?: string;
}

function rowClass(icon: unknown, tone: Tone, extra?: string, tap?: boolean) {
  return `ls-row${icon ? ' has-icon' : ''}${tap ? ' ls-tap' : ''}${tone !== 'default' ? ' ls-' + tone : ''}${extra ? ' ' + extra : ''}`;
}

function RowInner({ icon, title, subtitle, value, trailing, chevron }: RowProps) {
  return (
    <>
      {icon && <span className="ls-icon">{icon}</span>}
      <span className="ls-body">
        <span className="ls-title">{title}</span>
        {subtitle && <span className="ls-sub">{subtitle}</span>}
      </span>
      {value !== undefined && value !== null && value !== false && <span className="ls-value">{value}</span>}
      {trailing}
      {chevron && <CaretRight className="ls-chev" size={15} weight="bold" />}
    </>
  );
}

/** Строка списка. С onClick — нажимается целиком */
export function ListRow(p: RowProps) {
  const tone = p.tone ?? 'default';
  if (p.onClick)
    return (
      <button type="button" className={rowClass(p.icon, tone, p.className, true)} onClick={p.onClick} disabled={p.disabled}>
        <RowInner {...p} />
      </button>
    );
  return (
    <div className={rowClass(p.icon, tone, p.className)}>
      <RowInner {...p} />
    </div>
  );
}

/** Переключатель iOS (UISwitch) */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="switch"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
    />
  );
}

/** Строка с переключателем справа */
export function SwitchRow({
  icon,
  title,
  subtitle,
  checked,
  onChange,
  disabled,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={rowClass(icon, 'default', 'ls-switch-row')}>
      {icon && <span className="ls-icon">{icon}</span>}
      <span className="ls-body">
        <span className="ls-title">{title}</span>
        {subtitle && <span className="ls-sub">{subtitle}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Строка-выбор: значение справа с двойной стрелкой, по нажатию — системное меню/колесо */
export function SelectRow({
  icon,
  title,
  subtitle,
  value,
  options,
  onChange,
  disabled,
  display,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value: string;
  options: SelectOption[];
  /** короткая подпись значения справа (по умолчанию — подпись выбранного пункта) */
  display?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const cur = display ?? options.find((o) => o.value === value)?.label ?? '—';
  return (
    <label className={rowClass(icon, 'default', 'ls-select-row', true)}>
      {icon && <span className="ls-icon">{icon}</span>}
      <span className="ls-body">
        <span className="ls-title">{title}</span>
        {subtitle && <span className="ls-sub">{subtitle}</span>}
      </span>
      <span className="ls-value ls-value-pick">
        <span className="ellipsis">{cur}</span>
        <CaretUpDown size={14} weight="bold" />
      </span>
      <select className="ls-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Произвольное содержимое внутри группы (поле ввода, сетка цветов, сегменты) */
export function ListCell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`ls-cell${className ? ' ' + className : ''}`}>{children}</div>;
}
