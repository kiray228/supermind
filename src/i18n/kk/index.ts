// Казахский словарь целиком: грузится отдельным файлом и только при казахском интерфейсе
import common from './common.ts';
import views from './views.ts';
import notes from './notes.ts';
import finance from './finance.ts';
import tasks from './tasks.ts';
import editor from './editor.ts';
import ui from './ui.ts';

const kk: Record<string, string> = { ...common, ...views, ...notes, ...finance, ...tasks, ...editor, ...ui };
export default kk;
