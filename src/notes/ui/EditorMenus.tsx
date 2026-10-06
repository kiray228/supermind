import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Code,
  Copy,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Lightbulb,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Maximize2,
  Mic,
  Minus,
  Quote,
  SquareCheck,
  Strikethrough,
  Trash2,
  Type,
} from 'lucide-react';
import { type Block, BLOCK_LABELS, type BlockType, isTextBlock } from '../model';
import { MenuItem, MenuLabel, MenuSep } from './Menu';

export const BLOCK_ICONS: Record<BlockType, ReactNode> = {
  p: <Type size={17} />,
  h1: <Heading1 size={17} />,
  h2: <Heading2 size={17} />,
  h3: <Heading3 size={17} />,
  bullet: <List size={17} />,
  number: <ListOrdered size={17} />,
  todo: <SquareCheck size={17} />,
  quote: <Quote size={17} />,
  code: <Code size={17} />,
  callout: <Lightbulb size={17} />,
  divider: <Minus size={17} />,
  image: <ImageIcon size={17} />,
  audio: <Mic size={17} />,
};

const HINTS: Partial<Record<BlockType, string>> = { h1: '#', h2: '##', h3: '###', bullet: '-', number: '1.', todo: '[]', quote: '>', code: '```', divider: '---' };

const TEXT_ORDER: BlockType[] = ['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'quote', 'callout', 'code'];

/** Меню «+» / «/»: выбор типа блока */
export function TypeMenuItems({ current, onPick, withMedia }: { current?: BlockType; onPick: (t: BlockType) => void; withMedia: boolean }) {
  return (
    <>
      <MenuLabel>Блоки</MenuLabel>
      {TEXT_ORDER.map((t) => (
        <MenuItem key={t} icon={BLOCK_ICONS[t]} label={BLOCK_LABELS[t]} hint={HINTS[t]} active={current === t} onClick={() => onPick(t)} />
      ))}
      <MenuItem icon={BLOCK_ICONS.divider} label={BLOCK_LABELS.divider} hint={HINTS.divider} onClick={() => onPick('divider')} />
      {withMedia && (
        <>
          <MenuSep />
          <MenuItem icon={BLOCK_ICONS.image} label="Фото или картинка" onClick={() => onPick('image')} />
          <MenuItem icon={BLOCK_ICONS.audio} label="Голосовая запись" onClick={() => onPick('audio')} />
        </>
      )}
    </>
  );
}

export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'mark' | 'link';
export const FORMAT_MARKS: Record<FormatKind, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
  mark: ['==', '=='],
  link: ['[', ')'],
};

export function FormatMenuItems({ onPick }: { onPick: (k: FormatKind) => void }) {
  return (
    <>
      <MenuLabel>Оформление выделенного</MenuLabel>
      <MenuItem icon={<Bold size={17} />} label="Жирный" hint="**" onClick={() => onPick('bold')} />
      <MenuItem icon={<Italic size={17} />} label="Курсив" hint="*" onClick={() => onPick('italic')} />
      <MenuItem icon={<Strikethrough size={17} />} label="Зачёркнутый" hint="~~" onClick={() => onPick('strike')} />
      <MenuItem icon={<Highlighter size={17} />} label="Выделение цветом" hint="==" onClick={() => onPick('mark')} />
      <MenuItem icon={<Code size={17} />} label="Код" hint="`" onClick={() => onPick('code')} />
      <MenuItem icon={<Link size={17} />} label="Ссылка" onClick={() => onPick('link')} />
    </>
  );
}

export interface BlockMenuActions {
  convert(t: BlockType): void;
  move(dir: -1 | 1): void;
  duplicate(): void;
  remove(): void;
  makeTask(): void;
  toText(): void;
  view(): void;
}

/** Действия с блоком */
export function BlockMenuItems({ b, a, first, last }: { b: Block; a: BlockMenuActions; first: boolean; last: boolean }) {
  return (
    <>
      {isTextBlock(b) && (
        <>
          <MenuLabel>Превратить в</MenuLabel>
          <div className="nt-type-grid">
            {TEXT_ORDER.map((t) => (
              <button key={t} className={`nt-type-btn${b.type === t ? ' active' : ''}`} onClick={() => a.convert(t)} title={BLOCK_LABELS[t]} aria-label={BLOCK_LABELS[t]}>
                {BLOCK_ICONS[t]}
              </button>
            ))}
          </div>
          <MenuSep />
        </>
      )}
      {b.type === 'todo' && <MenuItem icon={<ListTodo size={17} />} label="Создать задачу из пункта" onClick={a.makeTask} />}
      {b.type === 'audio' && !!b.transcript?.trim() && <MenuItem icon={<FileText size={17} />} label="Расшифровку — в текст" onClick={a.toText} />}
      {b.type === 'image' && <MenuItem icon={<Maximize2 size={17} />} label="Открыть" onClick={a.view} />}
      {!first && <MenuItem icon={<ArrowUp size={17} />} label="Выше" onClick={() => a.move(-1)} />}
      {!last && <MenuItem icon={<ArrowDown size={17} />} label="Ниже" onClick={() => a.move(1)} />}
      <MenuItem icon={<Copy size={17} />} label="Дублировать" onClick={a.duplicate} />
      <MenuItem icon={<Trash2 size={17} />} label="Удалить блок" danger onClick={a.remove} />
    </>
  );
}
