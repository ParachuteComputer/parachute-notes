import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_RECENTS, clearRecents, loadRecents, pushRecent } from "./recents";

describe("recents storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns an empty array when nothing is stored", () => {
    expect(loadRecents("v1")).toEqual([]);
  });

  it("pushes ids most-recent first", () => {
    pushRecent("v1", "a", 100);
    pushRecent("v1", "b", 200);
    expect(loadRecents("v1").map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("deduplicates by id — revisiting an id moves it to the front", () => {
    pushRecent("v1", "a", 100);
    pushRecent("v1", "b", 200);
    pushRecent("v1", "a", 300);
    expect(loadRecents("v1").map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("caps at MAX_RECENTS entries", () => {
    for (let i = 0; i < MAX_RECENTS + 5; i += 1) {
      pushRecent("v1", `n${i}`, i);
    }
    const got = loadRecents("v1");
    expect(got).toHaveLength(MAX_RECENTS);
    expect(got[0]?.id).toBe(`n${MAX_RECENTS + 4}`);
  });

  it("scopes per vaultId", () => {
    pushRecent("v1", "a");
    pushRecent("v2", "b");
    expect(loadRecents("v1").map((e) => e.id)).toEqual(["a"]);
    expect(loadRecents("v2").map((e) => e.id)).toEqual(["b"]);
  });

  it("tolerates malformed stored JSON", () => {
    localStorage.setItem("lens:recents:v1", "not-json{");
    expect(loadRecents("v1")).toEqual([]);
  });

  it("ignores stored entries that don't match the shape", () => {
    localStorage.setItem(
      "lens:recents:v1",
      JSON.stringify([{ id: "a", viewedAt: 1 }, "bad", { id: 42 }, { id: "b", viewedAt: 2 }]),
    );
    expect(loadRecents("v1").map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("clearRecents removes the entry", () => {
    pushRecent("v1", "a");
    clearRecents("v1");
    expect(loadRecents("v1")).toEqual([]);
  });
});
