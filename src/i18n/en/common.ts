// Английский словарь: русский текст из кода → перевод. Формы числа: 'задача|задачи|задач': 'task|tasks'.
// Здесь — общие слова и настройки языка; разделы — в своих файлах.
const d: Record<string, string> = {
  Оформление: 'Appearance',
  Язык: 'Language',
  'Как в системе': 'System default',
  'Нижняя панель': 'Bottom bar',
  'Какие разделы стоят внизу на телефоне': 'Which sections sit at the bottom on a phone',
  // таймер фокуса на экране блокировки (src/native/focusLive.ts)
  Секундомер: 'Stopwatch',
  Фокус: 'Focus',
  'Короткий перерыв': 'Short break',
  'Длинный перерыв': 'Long break',
  Пауза: 'Pause',
  Продолжить: 'Resume',
  Стоп: 'Stop',
  'На паузе': 'Paused',
  'Таймер фокуса': 'Focus timer',
  'Помодоро завершён': 'Pomodoro complete',
  'Перерыв окончен': 'Break is over',
  'Время отдохнуть': 'Time for a break',
  'Пора вернуться к фокусу': 'Time to get back to focus',
};
export default d;
