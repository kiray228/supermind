/** Какая задача открыта в окне «Сделать с ИИ» (лёгкий модуль: само окно грузится по требованию) */
import { create } from 'zustand';

export const useAiDo = create<{ taskId: string | null }>(() => ({ taskId: null }));
export const openAiDo = (taskId: string) => useAiDo.setState({ taskId });
export const closeAiDo = () => useAiDo.setState({ taskId: null });
