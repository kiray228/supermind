export type ID = string;

/** Структура (раскладка) карты — как в Xmind */
export type StructureType =
  | 'map' // классическая карта: ветви в обе стороны
  | 'logic-right' // логическая схема вправо
  | 'logic-left' // логическая схема влево
  | 'org' // орг-структура вниз
  | 'tree' // дерево (отступами)
  | 'timeline' // горизонтальная временная шкала
  | 'fishbone' // диаграмма Исикавы
  | 'brace'; // скобочная схема

export type ShapeType =
  | 'rounded'
  | 'rect'
  | 'pill'
  | 'ellipse'
  | 'diamond'
  | 'hexagon'
  | 'underline'
  | 'none';

export type LineStyle = 'curve' | 'straight' | 'elbow' | 'rounded-elbow' | 'taper';

export interface TopicStyle {
  fill?: string;
  textColor?: string;
  borderColor?: string;
  borderWidth?: number;
  shape?: ShapeType;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  lineColor?: string;
  lineStyle?: LineStyle;
  lineWidth?: number;
}

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface TaskInfo {
  status: TaskStatus;
  /** 0 — нет, 1 — высокий, 2 — средний, 3 — низкий */
  priority?: number;
  /** YYYY-MM-DD */
  start?: string;
  /** YYYY-MM-DD */
  due?: string;
  assignee?: string;
  /** 0..100 */
  progress?: number;
}

export interface TopicImage {
  src: string; // data URL
  w: number;
  h: number;
}

export interface Topic {
  id: ID;
  text: string;
  /** сторона для основных тем в «Интеллект-карте» */
  side?: 'left' | 'right';
  children: Topic[];
  collapsed?: boolean;
  style?: TopicStyle;
  /** id маркеров из markers.ts */
  markers?: string[];
  labels?: string[];
  note?: string;
  link?: string;
  image?: TopicImage;
  task?: TaskInfo;
}

export interface FloatingTopic extends Topic {
  /** смещение относительно центра центральной темы */
  x: number;
  y: number;
}

export interface Relationship {
  id: ID;
  from: ID;
  to: ID;
  label?: string;
  color?: string;
  dashed?: boolean;
  /** изгиб (смещение контрольной точки от середины) */
  bend?: number;
}

export interface Boundary {
  id: ID;
  /** тема, поддерево которой обводится */
  topicId: ID;
  label?: string;
  color?: string;
}

export interface Summary {
  id: ID;
  /** тема, поддерево которой подытоживается */
  topicId: ID;
  text: string;
  color?: string;
}

export interface Sheet {
  id: ID;
  title: string;
  root: Topic;
  floating: FloatingTopic[];
  relationships: Relationship[];
  boundaries: Boundary[];
  summaries: Summary[];
  structure: StructureType;
  themeId: string;
  /** Радужные ветви */
  rainbow?: boolean;
  lineStyle?: LineStyle;
  /** Формы по умолчанию для уровней (перекрывают тему оформления) */
  shapes?: { main?: ShapeType; sub?: ShapeType };
  /** Плотность: расстояния между темами */
  spacing?: number;
  background?: string;
}

export interface MindDoc {
  id: ID;
  title: string;
  sheets: Sheet[];
  activeSheet: ID;
  createdAt: number;
  updatedAt: number;
}

/** Мета-информация для списка документов (хранится отдельно) */
export interface DocMeta {
  id: ID;
  title: string;
  createdAt: number;
  updatedAt: number;
  starred?: boolean;
  locked?: boolean;
  folder?: string;
  topicCount?: number;
  /** цвет карточки (из темы) */
  accent?: string;
  trashed?: boolean;
}

/** Зашифрованный документ */
export interface LockedDoc {
  id: ID;
  locked: true;
  salt: string;
  iv: string;
  data: string;
}

// ---------- Ежедневник и доска задач ----------

export interface PlannerTask {
  id: ID;
  text: string;
  done: boolean;
  /** HH:MM, необязательно */
  time?: string;
  priority?: number;
}

export interface PlannerDay {
  journal: string;
  mood?: string;
  tasks: PlannerTask[];
  /** id привычек, выполненных в этот день */
  habits?: ID[];
  /** счётчики привычек с целью на день (id → сколько раз), напр. «стакан воды ×8» */
  habitCounts?: Record<ID, number>;
  /** когда день меняли (для синхронизации: свежая версия дня побеждает) */
  updatedAt?: number;
}

/** Часть дня, в которой показывается привычка */
export type HabitPart = 'morning' | 'day' | 'evening' | 'any';

/** Как часто: каждый день, по дням недели или N раз в неделю */
export type HabitFreq = 'daily' | 'weekdays' | 'weekly';

export interface Habit {
  id: ID;
  name: string;
  color: string;
  /** эмодзи */
  icon?: string;
  /** время напоминания HH:MM (если не задано — напоминание во время привычки `time`) */
  remind?: string;
  /** не напоминать, даже если указано время привычки */
  remindOff?: boolean;
  /** частота; нет — каждый день */
  freq?: HabitFreq;
  /** для freq = 'weekdays': дни недели 0..6 (0 — воскресенье) */
  days?: number[];
  /** для freq = 'weekly': сколько раз в неделю */
  perWeek?: number;
  /** время привычки HH:MM */
  time?: string;
  /** длительность, минут */
  duration?: number;
  /** часть дня; нет — по времени или «любое время» */
  part?: HabitPart;
  /** цель на день (раз), для привычек-счётчиков; нет или 1 — простая отметка */
  target?: number;
  /** единица счёта, напр. «стакан» */
  unit?: string;
  /** в архиве: не показывается, история сохранена */
  archived?: boolean;
  /** удалена (отметка для синхронизации, чтобы привычка не вернулась с другого устройства) */
  deleted?: boolean;
  createdAt?: number;
  /** время изменения — при синхронизации побеждает свежее */
  updatedAt?: number;
}

export interface PlannerData {
  days: Record<string, PlannerDay>;
  habits: Habit[];
}

export interface BoardColumn {
  id: ID;
  title: string;
  /** колонки todo/doing/done связаны со статусами задач в картах */
  status?: TaskStatus;
  color?: string;
}

export interface BoardCard {
  id: ID;
  columnId: ID;
  title: string;
  description?: string;
  priority?: number;
  due?: string;
  labels?: string[];
  checklist?: { id: ID; text: string; done: boolean }[];
  order: number;
  createdAt: number;
}

export interface BoardData {
  columns: BoardColumn[];
  cards: BoardCard[];
}

export interface Settings {
  apiKey: string;
  model: string;
  theme: 'system' | 'light' | 'dark';
  language: 'ru';
  /** цвет акцента (ACCENTS в ui/appearance.ts) */
  accent?: string;
  /** «soft» — лёгкое стекло, «liquid» — Liquid Glass */
  glass?: 'soft' | 'liquid';
  /** фон приложения */
  backdrop?: 'gradient' | 'aurora' | 'plain';
}
