import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteScribeSettings, loadScribeSettings, saveScribeSettings } from "./settings";

describe("scribe settings storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips url, token, cleanup", () => {
    saveScribeSettings("v1", { url: "http://scribe.local", token: "sk-x", cleanup: true });
    const out = loadScribeSettings("v1");
    expect(out).toEqual({ url: "http://scribe.local", token: "sk-x", cleanup: true });
  });

  it("returns null when nothing is stored", () => {
    expect(loadScribeSettings("nope")).toBeNull();
  });

  it("returns null when stored JSON is missing url", () => {
    localStorage.setItem("lens:scribe:v1", JSON.stringify({ token: "x" }));
    expect(loadScribeSettings("v1")).toBeNull();
  });

  it("strips empty token on save", () => {
    saveScribeSettings("v1", { url: "http://scribe.local", token: "", cleanup: false });
    const out = loadScribeSettings("v1");
    expect(out).toEqual({ url: "http://scribe.local", token: undefined, cleanup: false });
  });

  it("trims whitespace on url", () => {
    saveScribeSettings("v1", { url: "   http://scribe.local/   " });
    const out = loadScribeSettings("v1");
    expect(out?.url).toBe("http://scribe.local/");
  });

  it("deleteScribeSettings removes the entry", () => {
    saveScribeSettings("v1", { url: "http://scribe.local" });
    deleteScribeSettings("v1");
    expect(loadScribeSettings("v1")).toBeNull();
  });

  it("treats cleanup !== true as false", () => {
    localStorage.setItem(
      "lens:scribe:v1",
      JSON.stringify({ url: "http://scribe.local", cleanup: "yes" }),
    );
    expect(loadScribeSettings("v1")?.cleanup).toBe(false);
  });
});
