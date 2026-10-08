/** Открыто ли окно голосовой команды (лёгкий модуль: кнопки грузятся сразу, само окно — по требованию) */
import { create } from 'zustand';

export const useVoice = create<{ open: boolean }>(() => ({ open: false }));
export const openVoice = () => useVoice.setState({ open: true });
export const closeVoice = () => useVoice.setState({ open: false });
