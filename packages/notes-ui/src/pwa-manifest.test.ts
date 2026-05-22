import { describe, expect, it } from "vitest";
import { PWA_MANIFEST, buildPwaManifest } from "./pwa-manifest";

describe("PWA_MANIFEST", () => {
  it("has the fields Chrome requires for installability", () => {
    expect(PWA_MANIFEST.name).toBeTruthy();
    expect(PWA_MANIFEST.short_name).toBeTruthy();
    expect(PWA_MANIFEST.start_url).toBe("/");
    expect(PWA_MANIFEST.display).toBe("standalone");
    expect(PWA_MANIFEST.theme_color).toMatch(/^#[0-9a-f]{3,8}$/i);
    expect(PWA_MANIFEST.background_color).toMatch(/^#[0-9a-f]{3,8}$/i);
  });

  it("ships both 192px and 512px icons", () => {
    const sizes = (PWA_MANIFEST.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("includes a maskable icon for Android adaptive crops", () => {
    const maskable = (PWA_MANIFEST.icons ?? []).filter((i) =>
      (i.purpose ?? "").includes("maskable"),
    );
    expect(maskable.length).toBeGreaterThan(0);
    expect(maskable[0].sizes).toBe("512x512");
  });

  it("serializes to JSON with no circular references", () => {
    expect(() => JSON.stringify(PWA_MANIFEST)).not.toThrow();
    const round = JSON.parse(JSON.stringify(PWA_MANIFEST));
    expect(round.name).toBe(PWA_MANIFEST.name);
  });
});

describe("buildPwaManifest under a sub-path", () => {
  it("threads the base into id, start_url, and scope so installed PWAs land on the right route", () => {
    const m = buildPwaManifest("/notes/");
    expect(m.id).toBe("/notes/");
    expect(m.start_url).toBe("/notes/");
    expect(m.scope).toBe("/notes/");
  });

  it("normalizes a base passed without a trailing slash", () => {
    const m = buildPwaManifest("/notes");
    expect(m.start_url).toBe("/notes/");
  });
});
