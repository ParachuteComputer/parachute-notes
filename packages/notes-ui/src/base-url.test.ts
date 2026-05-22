import { describe, expect, it } from "vitest";

// Guards the production default. If you change vite.config's `VITE_BASE_PATH`
// default or vitest.config's `base`, this should fail until both move
// together — the SPA's BrowserRouter basename, OAuth redirect URI, and PWA
// manifest start_url all derive from import.meta.env.BASE_URL.
//
// BASE_URL is the external mount prefix for the whole app bundle: it governs
// (a) Vite's asset URL resolution at build time and (b) the Router basename
// at runtime. Internal route paths (`/`, `/n/:id`, `/pinned`…) are written
// as if the app were mounted at the origin root; BrowserRouter's basename
// strips the external prefix on read and prepends it on write. Moving the
// mount is a one-line change here — not a route-by-route search-and-replace.
describe("import.meta.env.BASE_URL", () => {
  it("defaults to /notes/ — Notes is mounted under /notes by the hub", () => {
    expect(import.meta.env.BASE_URL).toBe("/notes/");
  });
});
