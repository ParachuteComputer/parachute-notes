// All date keys are local-time "YYYY-MM-DD" strings. Calendar and /today are
// user-facing chronological surfaces — UTC dates would show "today" from the
// vault's clock rather than the user's, which is almost never what they want.
// The cost is that notes authored in a different timezone may land on a
// different day than the author expected, but that's the correct trade for a
// personal-notes app rendered in the user's browser.

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function toDateKey(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return todayKey(d);
}

export function parseDateKey(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

export function parseMonthKey(
  s: string | null | undefined,
): { year: number; month: number } | null {
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return null;
  const [y, m] = s.split("-").map(Number) as [number, number];
  if (m < 1 || m > 12) return null;
  return { year: y, month: m };
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

// Grid of 42 cells (6 weeks) for the given month, starting on Sunday and
// including trailing days from prior/next month so rows are always complete.
export function monthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const startDay = firstOfMonth.getDay(); // 0 = Sunday
  const gridStart = new Date(year, month - 1, 1 - startDay);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return days;
}

export function formatLongDate(key: string): string {
  const d = parseDateKey(key);
  if (!d) return key;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatLongMonth(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}
