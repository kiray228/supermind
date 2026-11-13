/** Значки вкладок нижней панели: у блоков — свои (солнце, граф, мозг), у остальных — значок раздела */
import { Brain, DotsThreeCircle, Graph, SunHorizon, type Icon } from '@phosphor-icons/react';
import type { PhoneTab } from '../store/phoneNav';
import { SECTION_ICONS, type SectionId } from './sections';

const TAB_ICON: Partial<Record<PhoneTab, Icon>> = { today: SunHorizon, home: Graph, notes: Brain, more: DotsThreeCircle };
export const tabIcon = (id: PhoneTab): Icon => TAB_ICON[id] ?? SECTION_ICONS[id as SectionId];
