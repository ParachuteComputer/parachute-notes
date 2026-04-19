import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TAG_ROLES, deleteTagRoles, loadTagRoles, saveTagRoles } from "./tag-roles";

describe("tag roles storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadTagRoles("v1")).toEqual(DEFAULT_TAG_ROLES);
  });

  it("round-trips every role", () => {
    saveTagRoles("v1", {
      pinned: "favs",
      archived: "done",
      captureVoice: "memo",
      captureText: "inbox",
    });
    expect(loadTagRoles("v1")).toEqual({
      pinned: "favs",
      archived: "done",
      captureVoice: "memo",
      captureText: "inbox",
    });
  });

  it("scopes storage by vaultId", () => {
    saveTagRoles("v1", { ...DEFAULT_TAG_ROLES, pinned: "starred" });
    saveTagRoles("v2", { ...DEFAULT_TAG_ROLES, pinned: "important" });
    expect(loadTagRoles("v1").pinned).toBe("starred");
    expect(loadTagRoles("v2").pinned).toBe("important");
  });

  it("strips leading # and trims whitespace on save", () => {
    saveTagRoles("v1", {
      pinned: "  #starred  ",
      archived: "#done",
      captureVoice: " voice ",
      captureText: "#quick",
    });
    expect(loadTagRoles("v1")).toEqual({
      pinned: "starred",
      archived: "done",
      captureVoice: "voice",
      captureText: "quick",
    });
  });

  it("falls back to defaults for blank or missing entries", () => {
    saveTagRoles("v1", {
      pinned: "   ",
      archived: "",
      captureVoice: "#",
      captureText: "keep",
    });
    const out = loadTagRoles("v1");
    expect(out.pinned).toBe(DEFAULT_TAG_ROLES.pinned);
    expect(out.archived).toBe(DEFAULT_TAG_ROLES.archived);
    expect(out.captureVoice).toBe(DEFAULT_TAG_ROLES.captureVoice);
    expect(out.captureText).toBe("keep");
  });

  it("tolerates partial stored JSON by filling defaults", () => {
    localStorage.setItem("lens:tag-roles:v1", JSON.stringify({ pinned: "starred" }));
    const out = loadTagRoles("v1");
    expect(out.pinned).toBe("starred");
    expect(out.archived).toBe(DEFAULT_TAG_ROLES.archived);
    expect(out.captureVoice).toBe(DEFAULT_TAG_ROLES.captureVoice);
    expect(out.captureText).toBe(DEFAULT_TAG_ROLES.captureText);
  });

  it("returns defaults on malformed JSON", () => {
    localStorage.setItem("lens:tag-roles:v1", "not-json{");
    expect(loadTagRoles("v1")).toEqual(DEFAULT_TAG_ROLES);
  });

  it("deleteTagRoles removes the entry and load falls back to defaults", () => {
    saveTagRoles("v1", { ...DEFAULT_TAG_ROLES, pinned: "starred" });
    deleteTagRoles("v1");
    expect(loadTagRoles("v1")).toEqual(DEFAULT_TAG_ROLES);
  });
});
