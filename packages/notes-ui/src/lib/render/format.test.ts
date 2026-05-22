import { describe, expect, it } from "vitest";
import { extensionOf, formatForPath } from "./format";

describe("formatForPath", () => {
  it("treats no path as markdown", () => {
    expect(formatForPath(undefined)).toBe("markdown");
    expect(formatForPath("")).toBe("markdown");
  });

  it("treats no extension as markdown", () => {
    expect(formatForPath("Daily/2026-05-18")).toBe("markdown");
    expect(formatForPath("Inbox/idea")).toBe("markdown");
  });

  it("treats .md / .mdx / .markdown as markdown", () => {
    expect(formatForPath("readme.md")).toBe("markdown");
    expect(formatForPath("docs/Readme.MDX")).toBe("markdown");
    expect(formatForPath("post.markdown")).toBe("markdown");
  });

  it("dispatches CSV / JSON / YAML", () => {
    expect(formatForPath("ledger.csv")).toBe("csv");
    expect(formatForPath("config.json")).toBe("json");
    expect(formatForPath("config.yaml")).toBe("yaml");
    expect(formatForPath("config.yml")).toBe("yaml");
  });

  it("dispatches recognized code extensions", () => {
    expect(formatForPath("foo.ts")).toBe("code");
    expect(formatForPath("foo.tsx")).toBe("code");
    expect(formatForPath("foo.js")).toBe("code");
    expect(formatForPath("foo.py")).toBe("code");
    expect(formatForPath("foo.rs")).toBe("code");
    expect(formatForPath("foo.go")).toBe("code");
    expect(formatForPath("foo.sh")).toBe("code");
  });

  it("falls back to plain for unknown extensions", () => {
    expect(formatForPath("blob.bin")).toBe("plain");
    expect(formatForPath("snap.png")).toBe("plain");
  });

  // Pin the documented intent for hidden-file paths (no body before the
  // dot). The dispatch is purely extension-driven, so `.gitignore` reads
  // as ext="gitignore" → "plain", and `.ts` reads as ext="ts" → "code".
  // This isn't a deliberate hidden-file rule — it falls out of the
  // extension model — but the behavior is the right one to keep, so pin
  // it.
  it("treats hidden-file paths by extension (no special-case)", () => {
    expect(formatForPath(".gitignore")).toBe("plain");
    expect(formatForPath(".ts")).toBe("code");
  });
});

describe("extensionOf", () => {
  it("returns the lowercase extension", () => {
    expect(extensionOf("foo.TS")).toBe("ts");
    expect(extensionOf("dir/sub/file.yaml")).toBe("yaml");
  });

  it("returns empty for no-extension paths", () => {
    expect(extensionOf("foo")).toBe("");
    expect(extensionOf("dir.with.dots/foo")).toBe("");
    expect(extensionOf(undefined)).toBe("");
    expect(extensionOf("trailing.")).toBe("");
  });
});
