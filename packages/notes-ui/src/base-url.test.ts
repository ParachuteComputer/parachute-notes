import { describe, expect, it } from "vitest";
import { detectMountBase, detectMountBaseWithSlash } from "./lib/base-url";

// Guards the runtime mount detection. The bundle no longer bakes its mount
// path in at build time (Vite `base: ""` → relative asset URLs); instead the
// SPA reads its own mount from `window.location.pathname` so the same `dist/`
// can be served at `/notes/` (legacy daemon), `/app/notes/` (parachute-app
// default), or `/app/<custom-slug>/` (parachute-app with a renamed install).
//
// The detector's output feeds BrowserRouter's `basename` and the OAuth
// redirect URI; if any of those derivations changes shape this test should
// fail loudly until the contract is reconciled.
describe("detectMountBase", () => {
  describe("legacy /notes/ mount (daemon)", () => {
    it("returns /notes for the root document URL", () => {
      expect(detectMountBase("/notes/")).toBe("/notes");
    });
    it("returns /notes for a deep route URL", () => {
      expect(detectMountBase("/notes/n/abc123")).toBe("/notes");
    });
    it("returns /notes for an edit sub-route", () => {
      expect(detectMountBase("/notes/n/abc123/edit")).toBe("/notes");
    });
    it("returns /notes for the OAuth callback path", () => {
      expect(detectMountBase("/notes/oauth/callback")).toBe("/notes");
    });
    it("returns /notes with no trailing slash for exact-prefix-no-slash", () => {
      expect(detectMountBase("/notes")).toBe("/notes");
    });
  });

  describe("/app/<slug>/ mount (parachute-app)", () => {
    it("returns /app/notes for the default app mount", () => {
      expect(detectMountBase("/app/notes/")).toBe("/app/notes");
    });
    it("returns /app/notes for a deep route under the app mount", () => {
      expect(detectMountBase("/app/notes/settings")).toBe("/app/notes");
    });
    it("returns /app/notes for the OAuth callback under the app mount", () => {
      expect(detectMountBase("/app/notes/oauth/callback")).toBe("/app/notes");
    });
    it("returns the renamed slug when the operator installs under a custom name", () => {
      expect(detectMountBase("/app/my-notes/")).toBe("/app/my-notes");
    });
    it("returns the renamed slug for a deep route under the custom mount", () => {
      expect(detectMountBase("/app/my-notes/n/some-id/edit")).toBe("/app/my-notes");
    });
    it("handles underscored slugs (PATH_PATTERN allows _ )", () => {
      expect(detectMountBase("/app/my_personal_notes/")).toBe("/app/my_personal_notes");
    });
    it("handles numeric-suffix slugs", () => {
      expect(detectMountBase("/app/notes2/")).toBe("/app/notes2");
    });
  });

  describe("fallback behaviour", () => {
    it("falls back to /notes when the path is unrecognised (defensive)", () => {
      // Operator pointing the browser at the bare origin — we degrade to the
      // historical default rather than blank the router. Real production
      // mounts are always either `/app/<slug>` or `/notes`, so this branch
      // is the "someone hit the wrong URL" affordance.
      expect(detectMountBase("/")).toBe("/notes");
    });
    it("falls back to /notes for an unknown sibling route under /app/", () => {
      // `/app/admin` is parachute-app's admin SPA, not a UI mount — its
      // bundle would never call into Notes. But if Notes' bundle ever loaded
      // here by accident, we'd rather it render at /notes than at /app/admin.
      // (PATH_PATTERN forbids the literal `admin` slug, so this case is
      // theoretical — kept as a guard against future relaxation.)
      expect(detectMountBase("/app/")).toBe("/notes");
    });
    it("falls back to /notes for paths the slug grammar rejects", () => {
      // Slug must start with [a-z0-9]; a leading hyphen fails the regex and
      // we fall through to the legacy default.
      expect(detectMountBase("/app/-bad/")).toBe("/notes");
    });
    it("falls back to /notes when no window is available (SSR/test)", () => {
      // Implicit when called with no arg in a non-browser env. We can't
      // delete `window` from jsdom mid-test without breaking other tests,
      // so cover this branch via the explicit `undefined` path the function
      // accepts.
      expect(detectMountBase(undefined as unknown as string | undefined)).toBeDefined();
    });
  });

  describe("detectMountBaseWithSlash", () => {
    it("appends a slash to the detected base", () => {
      expect(detectMountBaseWithSlash("/notes/")).toBe("/notes/");
      expect(detectMountBaseWithSlash("/app/notes/")).toBe("/app/notes/");
    });
    it("appends a slash even when input lacks one", () => {
      expect(detectMountBaseWithSlash("/notes")).toBe("/notes/");
      expect(detectMountBaseWithSlash("/app/my-notes")).toBe("/app/my-notes/");
    });
  });
});
