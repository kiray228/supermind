/**
 * Открыть окно «Текст с фото» откуда угодно (список заметок, меню «создать», редактор, «Поделиться»).
 * Окно рисуется в своём корне React поверх приложения — разделам не нужно его монтировать.
 */
import type { Root } from 'react-dom/client';
import type { OcrSheetProps } from './ui/OcrSheet';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

export function closePhotoText() {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
}

export async function openPhotoText(opts: Omit<OcrSheetProps, 'onClose'> = {}) {
  const [{ createRoot }, { default: OcrSheet }] = await Promise.all([import('react-dom/client'), import('./ui/OcrSheet')]);
  closePhotoText();
  host = document.createElement('div');
  host.className = 'ocr-host';
  document.body.appendChild(host);
  root = createRoot(host);
  const mine = root;
  // закрытие приходит из обработчика внутри этого же корня — размонтировать после него
  root.render(<OcrSheet {...opts} onClose={() => setTimeout(() => root === mine && closePhotoText(), 0)} />);
}
