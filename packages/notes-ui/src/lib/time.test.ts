import { describe, expect, it } from "vitest";
import { relativeTime } from "./time";

const NOW = new Date("2026-04-18T12:00:00.000Z");

describe("relativeTime", () => {
  it("returns empty string for undefined or invalid dates", () => {
    expect(relativeTime(undefined, NOW)).toBe("");
    expect(relativeTime("not a date", NOW)).toBe("");
  });

  it("says 'just now' under one minute", () => {
    expect(relativeTime("2026-04-18T11:59:30.000Z", NOW)).toBe("just now");
  });

  it("formats minutes, hours, days, weeks, months, years", () => {
    expect(relativeTime("2026-04-18T11:55:00.000Z", NOW)).toBe("5m ago");
    expect(relativeTime("2026-04-18T09:00:00.000Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-04-16T12:00:00.000Z", NOW)).toBe("2d ago");
    expect(relativeTime("2026-04-04T12:00:00.000Z", NOW)).toBe("2w ago");
    expect(relativeTime("2026-01-18T12:00:00.000Z", NOW)).toBe("3mo ago");
    expect(relativeTime("2024-04-18T12:00:00.000Z", NOW)).toBe("2y ago");
  });

  it("handles future dates with 'in' prefix", () => {
    expect(relativeTime("2026-04-20T12:00:00.000Z", NOW)).toBe("in 2d");
  });
});
