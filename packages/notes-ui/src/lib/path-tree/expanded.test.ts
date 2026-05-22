import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExpanded, saveExpanded } from "./expanded";

describe("path-tree expanded storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips a Set of expanded paths", () => {
    saveExpanded("v1", new Set(["Canon", "Canon/Aaron", "Corpus"]));
    const out = loadExpanded("v1");
    expect(out.has("Canon")).toBe(true);
    expect(out.has("Canon/Aaron")).toBe(true);
    expect(out.has("Corpus")).toBe(true);
    expect(out.size).toBe(3);
  });

  it("returns an empty Set when nothing is stored", () => {
    expect(loadExpanded("v1").size).toBe(0);
  });

  it("returns an empty Set for malformed JSON", () => {
    localStorage.setItem("lens:path-tree-expanded:v1", "{not");
    expect(loadExpanded("v1").size).toBe(0);
  });

  it("ignores non-string entries", () => {
    localStorage.setItem("lens:path-tree-expanded:v1", JSON.stringify(["ok", 42, null, "also-ok"]));
    const out = loadExpanded("v1");
    expect([...out].sort()).toEqual(["also-ok", "ok"]);
  });

  it("scopes per vault", () => {
    saveExpanded("a", new Set(["X"]));
    saveExpanded("b", new Set(["Y"]));
    expect(loadExpanded("a").has("X")).toBe(true);
    expect(loadExpanded("a").has("Y")).toBe(false);
    expect(loadExpanded("b").has("Y")).toBe(true);
  });
});
