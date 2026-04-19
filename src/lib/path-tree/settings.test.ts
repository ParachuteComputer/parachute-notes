import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PATH_TREE_MODE,
  deletePathTreeMode,
  loadPathTreeMode,
  savePathTreeMode,
} from "./settings";

describe("path-tree mode storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips a mode value", () => {
    savePathTreeMode("v1", "always");
    expect(loadPathTreeMode("v1")).toBe("always");
  });

  it("returns the default when nothing is stored", () => {
    expect(loadPathTreeMode("nope")).toBe(DEFAULT_PATH_TREE_MODE);
  });

  it("falls back to the default for an unknown stored value", () => {
    localStorage.setItem("lens:path-tree:v1", JSON.stringify({ mode: "weird" }));
    expect(loadPathTreeMode("v1")).toBe(DEFAULT_PATH_TREE_MODE);
  });

  it("falls back to the default when stored JSON is malformed", () => {
    localStorage.setItem("lens:path-tree:v1", "{not json");
    expect(loadPathTreeMode("v1")).toBe(DEFAULT_PATH_TREE_MODE);
  });

  it("delete removes the entry", () => {
    savePathTreeMode("v1", "never");
    deletePathTreeMode("v1");
    expect(loadPathTreeMode("v1")).toBe(DEFAULT_PATH_TREE_MODE);
  });

  it("scopes per vault", () => {
    savePathTreeMode("a", "always");
    savePathTreeMode("b", "never");
    expect(loadPathTreeMode("a")).toBe("always");
    expect(loadPathTreeMode("b")).toBe("never");
  });
});
