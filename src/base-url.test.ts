import { describe, expect, it } from "vitest";

// Guards the production default. If you change vite.config's `VITE_BASE_PATH`
// default or vitest.config's `base`, this should fail until both move
// together — the SPA's BrowserRouter basename, OAuth redirect URI, and PWA
// manifest start_url all derive from import.meta.env.BASE_URL.
describe("import.meta.env.BASE_URL", () => {
  it("defaults to /notes/ — Notes is mounted under /notes by the hub", () => {
    expect(import.meta.env.BASE_URL).toBe("/notes/");
  });
});
