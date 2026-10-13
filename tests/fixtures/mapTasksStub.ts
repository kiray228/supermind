// Даты из utils/mapTasks без зависимостей от браузера (store/db) — для тестов под node
const pad = (n: number) => String(n).padStart(2, '0');
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fromYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function todayYmd(): string {
  return toYmd(new Date());
}
export function addDaysYmd(s: string, n: number): string {
  const d = fromYmd(s);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}
