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
      // accepts. jsdom's `document` has no `<meta name="parachute-mount">`
      // injected (the test environment leaves the document bare), so the
      // canonical tier returns null and we fall through to the legacy
      // default.
      expect(detectMountBase(undefined as unknown as string | undefined)).toBe("/notes");
    });
  });

  describe("meta-tag canonical contract", () => {
    // Tier 1 of detection: when parachute-app injects
    // `<meta name="parachute-mount" content="/app/<name>">`, notes-ui reads it
    // directly. No regex, no guessing. The host explicitly declared the mount;
    // we believe it. Injection side: parachute-app#25 (merged).
    const stubWith = (content: string | null | undefined, name = "parachute-mount") =>
      ({
        querySelector: (selector: string) => {
          if (selector === `meta[name="${name}"]`) {
            return content === null ? null : { content };
          }
          return null;
        },
      }) as unknown as Document;

    it('reads from <meta name="parachute-mount" content="/app/notes"> when present', () => {
      const doc = stubWith("/app/notes");
      // Pathname says /notes (would trigger regex fallback), but meta wins.
      expect(detectMountBase("/notes/anything", doc)).toBe("/app/notes");
    });

    it("ignores meta tag when content is empty", () => {
      const doc = stubWith("");
      expect(detectMountBase("/notes/x", doc)).toBe("/notes");
    });

    it("ignores meta tag when content doesn't start with /", () => {
      const doc = stubWith("app/notes");
      expect(detectMountBase("/notes/x", doc)).toBe("/notes");
    });

    it("ignores meta tag when name is not exactly parachute-mount", () => {
      // Stub a doc where only `parachute-mount-other` matches; the real
      // selector returns null and we fall through to regex.
      const doc = stubWith("/app/wrong", "parachute-mount-other");
      expect(detectMountBase("/notes/x", doc)).toBe("/notes");
    });

    it("strips trailing slash from meta tag content (/app/notes/ → /app/notes)", () => {
      const doc = stubWith("/app/notes/");
      expect(detectMountBase("/", doc)).toBe("/app/notes");
    });

    it("falls back to regex when meta tag is absent", () => {
      const doc = stubWith(null);
      expect(detectMountBase("/app/my-notes/x", doc)).toBe("/app/my-notes");
    });

    it("falls back to /notes when meta tag absent AND no pathname match", () => {
      const doc = stubWith(null);
      expect(detectMountBase("/", doc)).toBe("/notes");
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
