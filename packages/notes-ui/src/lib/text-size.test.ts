// @vitest-environment jsdom
// Tests touch `localStorage` + `document.documentElement` — the vitest config
// already defaults to jsdom for the whole project, but this pragma makes the
// dependency explicit so a stray `bun test` invocation (which bypasses
// vitest) or a per-test env override doesn't silently break with
// "localStorage is not defined".
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TEXT_SIZE_STORAGE_KEY,
  applyTextSize,
  nextTextSize,
  previousTextSize,
  readStoredTextSize,
  textSizeLabel,
  writeStoredTextSize,
} from "./text-size";

describe("text-size", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });

  it("readStoredTextSize defaults to 'default' when unset or invalid", () => {
    expect(readStoredTextSize()).toBe("default");
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "huge");
    expect(readStoredTextSize()).toBe("default");
  });

  it("writeStoredTextSize round-trips and removes the key for 'default'", () => {
    writeStoredTextSize("larger");
    expect(readStoredTextSize()).toBe("larger");
    writeStoredTextSize("largest");
    expect(readStoredTextSize()).toBe("largest");
    writeStoredTextSize("default");
    expect(localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBeNull();
    expect(readStoredTextSize()).toBe("default");
  });

  it("applyTextSize sets or removes the data-text-size attribute", () => {
    applyTextSize("larger");
    expect(document.documentElement.getAttribute("data-text-size")).toBe("larger");
    applyTextSize("largest");
    expect(document.documentElement.getAttribute("data-text-size")).toBe("largest");
    applyTextSize("default");
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
  });

  it("textSizeLabel returns a display-friendly label", () => {
    expect(textSizeLabel("default")).toBe("Default");
    expect(textSizeLabel("larger")).toBe("Larger");
    expect(textSizeLabel("largest")).toBe("Largest");
  });

  it("nextTextSize cycles default → larger → largest → default", () => {
    expect(nextTextSize("default")).toBe("larger");
    expect(nextTextSize("larger")).toBe("largest");
    expect(nextTextSize("largest")).toBe("default");
  });

  it("previousTextSize cycles default → largest → larger → default", () => {
    expect(previousTextSize("default")).toBe("largest");
    expect(previousTextSize("largest")).toBe("larger");
    expect(previousTextSize("larger")).toBe("default");
  });
});
