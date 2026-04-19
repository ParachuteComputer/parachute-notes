import { describe, expect, it } from "vitest";
import {
  currentMonthKey,
  formatLongMonth,
  monthGrid,
  pad2,
  parseDateKey,
  parseMonthKey,
  shiftMonth,
  toDateKey,
  todayKey,
} from "./dates";

describe("pad2", () => {
  it("zero-pads single digits", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(9)).toBe("09");
  });
  it("leaves double digits alone", () => {
    expect(pad2(10)).toBe("10");
    expect(pad2(99)).toBe("99");
  });
});

describe("todayKey", () => {
  it("formats a Date as YYYY-MM-DD in local time", () => {
    // Local-time Jan 5, 2026 — regardless of host TZ, both sides use local.
    const d = new Date(2026, 0, 5);
    expect(todayKey(d)).toBe("2026-01-05");
  });
  it("zero-pads month and day", () => {
    expect(todayKey(new Date(2026, 2, 9))).toBe("2026-03-09");
  });
});

describe("toDateKey", () => {
  it("returns null for null/undefined/invalid input", () => {
    expect(toDateKey(null)).toBeNull();
    expect(toDateKey(undefined)).toBeNull();
    expect(toDateKey("not-a-date")).toBeNull();
  });
  it("converts an ISO string to the local date key", () => {
    // Build an ISO that matches a known local moment so the assertion is
    // stable across timezones.
    const local = new Date(2026, 3, 18, 12, 0, 0);
    expect(toDateKey(local.toISOString())).toBe("2026-04-18");
  });
});

describe("parseDateKey", () => {
  it("returns null for malformed keys", () => {
    expect(parseDateKey(null)).toBeNull();
    expect(parseDateKey("")).toBeNull();
    expect(parseDateKey("2026/04/18")).toBeNull();
    expect(parseDateKey("2026-4-18")).toBeNull();
  });
  it("parses a valid key into a Date in local time", () => {
    const d = parseDateKey("2026-04-18");
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(3);
    expect(d?.getDate()).toBe(18);
  });
});

describe("currentMonthKey", () => {
  it("formats YYYY-MM from a Date", () => {
    expect(currentMonthKey(new Date(2026, 0, 15))).toBe("2026-01");
    expect(currentMonthKey(new Date(2026, 11, 1))).toBe("2026-12");
  });
});

describe("parseMonthKey", () => {
  it("rejects invalid months and malformed input", () => {
    expect(parseMonthKey(null)).toBeNull();
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("2026-00")).toBeNull();
    expect(parseMonthKey("26-04")).toBeNull();
  });
  it("parses valid YYYY-MM", () => {
    expect(parseMonthKey("2026-04")).toEqual({ year: 2026, month: 4 });
  });
});

describe("shiftMonth", () => {
  it("shifts forward across a year boundary", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
  it("shifts backward across a year boundary", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
  it("handles multi-month shifts", () => {
    expect(shiftMonth(2026, 4, 14)).toEqual({ year: 2027, month: 6 });
    expect(shiftMonth(2026, 4, -16)).toEqual({ year: 2024, month: 12 });
  });
});

describe("monthGrid", () => {
  it("returns 42 cells (6 weeks of 7 days)", () => {
    expect(monthGrid(2026, 4).length).toBe(42);
  });
  it("starts on the Sunday on or before the 1st", () => {
    // April 2026: 1st is a Wednesday (getDay() === 3), so grid starts Sun Mar 29.
    const grid = monthGrid(2026, 4);
    expect(grid[0]?.getDay()).toBe(0);
    expect(grid[0]?.getFullYear()).toBe(2026);
    expect(grid[0]?.getMonth()).toBe(2); // March
    expect(grid[0]?.getDate()).toBe(29);
  });
  it("includes trailing days from the next month when needed", () => {
    const grid = monthGrid(2026, 4);
    const last = grid[grid.length - 1]!;
    // 29 + 41 days after Mar 29 lands in early May.
    expect(last.getMonth()).toBe(4);
  });
});

describe("formatLongMonth", () => {
  it("returns a human-readable year+month string", () => {
    const s = formatLongMonth(2026, 4);
    expect(s).toMatch(/2026/);
    expect(s).toMatch(/April/i);
  });
});
