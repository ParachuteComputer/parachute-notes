import { describe, expect, it } from "vitest";
import { isIOS, isStandalone } from "./pwa";

// `reloadAfterServiceWorkerUpdate` + `SW_RELOAD_FALLBACK_MS` were lifted
// into `@openparachute/app-client/sw-reload` during Phase 2 (parachute-
// app#6). Their behavior tests now live in app-client's own suite —
// re-running them here would be redundant. Notes keeps the platform
// sniffers (`isStandalone`, `isIOS`) covered locally because they're
// Notes-only UX wiring (the install banner).

describe("isIOS", () => {
  it("is true for iPhone UA", () => {
    expect(isIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit")).toBe(true);
  });
  it("is true for iPad UA", () => {
    expect(isIOS("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)")).toBe(true);
  });
  it("is true for iPadOS 13+ which reports a Mac UA but has touch", () => {
    expect(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", true)).toBe(true);
  });
  it("is false for desktop Chrome on macOS (no touch)", () => {
    expect(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/120", false)).toBe(false);
  });
  it("is false for Android UA", () => {
    expect(isIOS("Mozilla/5.0 (Linux; Android 13; Pixel 7)", true)).toBe(false);
  });
});

describe("isStandalone", () => {
  it("is true when display-mode: standalone matches", () => {
    const nav = { userAgent: "x" } as Navigator;
    const win = {
      matchMedia: (q: string) => ({ matches: q === "(display-mode: standalone)" }),
    } as unknown as Window;
    expect(isStandalone(nav, win)).toBe(true);
  });
  it("is true when navigator.standalone is true (iOS installed)", () => {
    const nav = { userAgent: "x", standalone: true } as Navigator & { standalone: boolean };
    const win = { matchMedia: () => ({ matches: false }) } as unknown as Window;
    expect(isStandalone(nav, win)).toBe(true);
  });
  it("is false in a regular browser tab", () => {
    const nav = { userAgent: "x" } as Navigator;
    const win = { matchMedia: () => ({ matches: false }) } as unknown as Window;
    expect(isStandalone(nav, win)).toBe(false);
  });
});
