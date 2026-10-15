import { Network, SquareCheck, StickyNote, Target } from 'lucide-react';
import type { BrainKind } from '../brainDocs';

/** Значок типа единицы мозга: заметка, карта, задача, цель */
export const KIND_ICON: Record<BrainKind, typeof StickyNote> = { note: StickyNote, map: Network, task: SquareCheck, goal: Target };
