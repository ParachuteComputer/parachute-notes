import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deletePinnedTags, loadPinnedTags, savePinnedTags } from "./pinned-tags";

describe("pinned tags storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("returns empty list when nothing is stored", () => {
    expect(loadPinnedTags("v1")).toEqual([]);
  });

  it("round-trips an array of tag names", () => {
    savePinnedTags("v1", ["captured", "project", "person"]);
    expect(loadPinnedTags("v1")).toEqual(["captured", "project", "person"]);
  });

  it("scopes storage by vaultId", () => {
    savePinnedTags("v1", ["one"]);
    savePinnedTags("v2", ["two"]);
    expect(loadPinnedTags("v1")).toEqual(["one"]);
    expect(loadPinnedTags("v2")).toEqual(["two"]);
  });

  it("strips leading # and trims whitespace on save", () => {
    savePinnedTags("v1", ["  #captured  ", "#project", " people "]);
    expect(loadPinnedTags("v1")).toEqual(["captured", "project", "people"]);
  });

  it("dedupes case-insensitively, preserving first form", () => {
    savePinnedTags("v1", ["Project", "project", "PROJECT"]);
    expect(loadPinnedTags("v1")).toEqual(["Project"]);
  });

  it("drops blank entries", () => {
    savePinnedTags("v1", ["", "  ", "#", "ok"]);
    expect(loadPinnedTags("v1")).toEqual(["ok"]);
  });

  it("returns empty on malformed JSON", () => {
    localStorage.setItem("lens:pinned-tags:v1", "not-json{");
    expect(loadPinnedTags("v1")).toEqual([]);
  });

  it("returns empty on non-array stored value", () => {
    localStorage.setItem("lens:pinned-tags:v1", JSON.stringify({ tag: "x" }));
    expect(loadPinnedTags("v1")).toEqual([]);
  });

  it("deletePinnedTags removes the entry", () => {
    savePinnedTags("v1", ["captured"]);
    deletePinnedTags("v1");
    expect(loadPinnedTags("v1")).toEqual([]);
  });
});
