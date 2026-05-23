import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILD_TIME_BASE,
  cleanupStaleServiceWorker,
  shouldRegisterServiceWorker,
} from "./sw-bootstrap";

// Guards the service-worker registration gate.
//
// The contract: notes-ui builds with a fixed mount baked into the PWA
// manifest + service-worker precache (default `/notes/`). When the same
// `dist/` is served at a different runtime mount (e.g. `/app/notes/`
// under parachute-app), we must NOT register the SW — its scope would
// straddle a precache table built for the wrong path, breaking every
// navigation. And we must also unregister any stale SW left behind by a
// pre-0.1.2 install that auto-registered before this gate existed.
//
// The vitest config sets vite's `base` to `/notes/`, so
// `import.meta.env.BASE_URL` resolves to `/notes/` and
// `BUILD_TIME_BASE` evaluates to `/notes`. Tests below assume that.

describe("BUILD_TIME_BASE", () => {
  it("trims the trailing slash from vite's BASE_URL", () => {
    expect(BUILD_TIME_BASE).toBe("/notes");
  });
});

describe("shouldRegisterServiceWorker", () => {
  it("returns true when the runtime mount matches the build-time base (default daemon mount)", () => {
    expect(shouldRegisterServiceWorker("/notes/")).toBe(true);
  });

  it("returns true for a deep route under the matching mount", () => {
    expect(shouldRegisterServiceWorker("/notes/n/abc123")).toBe(true);
  });

  it("returns false when the runtime mount is parachute-app's /app/notes/", () => {
    // The bug: bundle built for /notes/, served at /app/notes/.
    expect(shouldRegisterServiceWorker("/app/notes/")).toBe(false);
  });

  it("returns false for a custom-slug app mount", () => {
    expect(shouldRegisterServiceWorker("/app/my-notes/")).toBe(false);
  });

  it("returns false for an OAuth callback under a mismatched mount (the exact scenario Aaron hit)", () => {
    expect(shouldRegisterServiceWorker("/app/notes/oauth/callback")).toBe(false);
  });
});

describe("cleanupStaleServiceWorker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fakeRegistration(scope: string, unregister = vi.fn().mockResolvedValue(true)) {
    return { scope, unregister } as unknown as ServiceWorkerRegistration & {
      unregister: ReturnType<typeof vi.fn>;
    };
  }

  function fakeNavigator(registrations: ServiceWorkerRegistration[]): Navigator {
    return {
      serviceWorker: {
        getRegistrations: vi.fn().mockResolvedValue(registrations),
      },
    } as unknown as Navigator;
  }

  it("unregisters a stale /notes/-scoped SW when running under /app/notes/", async () => {
    const stale = fakeRegistration("https://hub.example.com/notes/");
    const nav = fakeNavigator([stale]);
    const count = await cleanupStaleServiceWorker(nav, "/app/notes/");
    expect(count).toBe(1);
    expect(stale.unregister).toHaveBeenCalledTimes(1);
  });

  it("leaves the SW alone when its scope matches the runtime mount", async () => {
    const matching = fakeRegistration("https://hub.example.com/notes/");
    const nav = fakeNavigator([matching]);
    const count = await cleanupStaleServiceWorker(nav, "/notes/");
    expect(count).toBe(0);
    expect(matching.unregister).not.toHaveBeenCalled();
  });

  it("unregisters a stale /app/old-notes/ SW when the runtime mount is /app/notes/", async () => {
    // Operator renamed their app install — the previous slug's SW is now stale.
    const stale = fakeRegistration("https://hub.example.com/app/old-notes/");
    const nav = fakeNavigator([stale]);
    const count = await cleanupStaleServiceWorker(nav, "/app/notes/");
    expect(count).toBe(1);
    expect(stale.unregister).toHaveBeenCalledTimes(1);
  });

  it("does not touch SWs whose scope doesn't look like a parachute mount", async () => {
    // Defensive: don't clobber unrelated SWs on the same origin.
    const unrelated = fakeRegistration("https://hub.example.com/some-other-app/");
    const nav = fakeNavigator([unrelated]);
    const count = await cleanupStaleServiceWorker(nav, "/app/notes/");
    expect(count).toBe(0);
    expect(unrelated.unregister).not.toHaveBeenCalled();
  });

  it("handles environments without navigator.serviceWorker gracefully", async () => {
    const nav = {} as unknown as Navigator;
    const count = await cleanupStaleServiceWorker(nav, "/notes/");
    expect(count).toBe(0);
  });

  it("handles undefined navigator (SSR-style) gracefully", async () => {
    const count = await cleanupStaleServiceWorker(undefined, "/notes/");
    expect(count).toBe(0);
  });

  it("continues past a single unregister failure and reports the count of successes", async () => {
    const failing = fakeRegistration(
      "https://hub.example.com/notes/",
      vi.fn().mockRejectedValue(new Error("boom")),
    );
    const succeeding = fakeRegistration("https://hub.example.com/app/old-notes/");
    const nav = fakeNavigator([failing, succeeding]);
    const count = await cleanupStaleServiceWorker(nav, "/app/notes/");
    // Only the second one succeeds; the first throws inside the loop's
    // try/catch and bumps no counter.
    expect(count).toBe(1);
    expect(succeeding.unregister).toHaveBeenCalledTimes(1);
  });

  it("unregisters multiple stale SWs in one pass", async () => {
    const a = fakeRegistration("https://hub.example.com/notes/");
    const b = fakeRegistration("https://hub.example.com/app/other-notes/");
    const nav = fakeNavigator([a, b]);
    const count = await cleanupStaleServiceWorker(nav, "/app/notes/");
    expect(count).toBe(2);
    expect(a.unregister).toHaveBeenCalledTimes(1);
    expect(b.unregister).toHaveBeenCalledTimes(1);
  });
});
