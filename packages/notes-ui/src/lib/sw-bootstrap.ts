/**
 * Service-worker bootstrap gating for the Notes UI bundle.
 *
 * Why this file exists:
 *
 *   notes-ui 0.1.1 introduced runtime mount detection — the same built
 *   `dist/` works at any mount path (`/notes/`, `/app/notes/`,
 *   `/app/<custom-slug>/`). Asset URLs, the React Router basename, and
 *   the OAuth redirect URI all rebase at runtime via `detectMountBase()`.
 *
 *   But the service worker and PWA manifest are baked at *build time*.
 *   The manifest's `start_url`/`scope` and the SW's precache manifest
 *   (every `/notes/index.html`, `/notes/assets/...` entry) are hard
 *   `/notes/`-scoped in the default build. When the same bundle gets
 *   mounted at `/app/notes/`, the React app loads and routes work — but
 *   then `useRegisterSW()` registers the SW *with the page's current
 *   scope* (`/app/notes/`), and the SW immediately starts intercepting
 *   every fetch under that scope. The precache table doesn't contain
 *   `/app/notes/...` entries; navigations fall through to workbox's
 *   navigation route which serves `/notes/index.html` (HTML) for a
 *   request that the importing browser expected to be a JS module or a
 *   JSON manifest.
 *
 *   Result (Aaron's report 2026-05-23):
 *     - workbox throws `non-precached-url :: /notes/index.html`
 *     - browser logs `Failed to load module script: Expected
 *       JavaScript-or-Wasm module, got "text/html"`
 *     - manifest fetch fails JSON parse
 *     - OAuth callback navigation breaks because the SW intercepts the
 *       fetch and returns the wrong document
 *
 *   The right fix is mount-aware build-time PWA assets, but that needs
 *   a parachute-app manifest-rewrite hook + multi-scope SW generation —
 *   non-trivial work. The immediate fix is to gate registration: if the
 *   runtime mount doesn't match the build-time vite base, don't
 *   register the SW at all, and unregister any stale registration left
 *   over from a previous version that didn't gate.
 *
 *   PWA "Add to Home Screen" therefore remains a build-time-pinned
 *   feature (already acknowledged in 0.1.1's CHANGELOG). Operators who
 *   want PWA install at a non-default mount must build with
 *   `VITE_BASE_PATH=/app/<name>`. In-browser use works at any mount
 *   from the default bundle, no SW interference.
 */

import { detectMountBase } from "./base-url";

/**
 * The mount path the current bundle was built for. Trimmed of trailing
 * slash to match `detectMountBase()`'s no-trailing-slash contract.
 *
 * `import.meta.env.BASE_URL` reflects Vite's `base` config option at
 * build time. The current `vite.config.ts` sets `base: ""` for relative
 * asset URLs, in which case Vite still surfaces the canonical mount via
 * the `VITE_BASE_PATH` env arg through the manifest's `start_url` /
 * `scope`. We mirror that with our own env var read so the gate
 * compares against the same path the PWA manifest baked in.
 *
 * Resolution order:
 *   1. `import.meta.env.VITE_BASE_PATH` — explicit override (matches
 *      `vite.config.ts`'s `basePath` variable).
 *   2. `import.meta.env.BASE_URL` — Vite's own resolved base, used when
 *      no override is provided.
 *   3. `/notes/` — the historical daemon default.
 */
function buildTimeBase(): string {
  const envOverride =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env.VITE_BASE_PATH as string | undefined)
      : undefined;
  const baseUrl =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env.BASE_URL as string | undefined)
      : undefined;
  const raw = envOverride && envOverride.length > 0 ? envOverride : baseUrl;
  // When vite.config sets `base: ""`, BASE_URL becomes "/" — useless as a
  // mount comparator. Fall through to the legacy default in that case.
  const normalised = !raw || raw === "" || raw === "/" ? "/notes/" : raw;
  return normalised.replace(/\/$/, "") || "/notes";
}

/** Frozen for downstream comparison + log lines. */
export const BUILD_TIME_BASE = buildTimeBase();

/**
 * Predicate: should the SW be registered for the current page?
 *
 * Returns true iff the runtime mount (via `detectMountBase()`) matches
 * the build-time base. When false, callers must short-circuit any
 * `registerSW` / `useRegisterSW` invocation.
 *
 * @param pathname  Optional pathname passed through to `detectMountBase`
 *                  for tests that need to assert specific mounts without
 *                  touching `window.location`.
 */
export function shouldRegisterServiceWorker(pathname?: string): boolean {
  const runtime = detectMountBase(pathname);
  return runtime === BUILD_TIME_BASE;
}

/**
 * Unregister any service worker whose registered scope doesn't match the
 * current runtime mount.
 *
 * The shape we're cleaning up after: a user on 0.1.1 or earlier installed
 * Notes via parachute-app at `/app/notes/`, the bundle auto-registered
 * the SW (build-time-scoped to `/notes/` via `vite.config.ts`'s `basePath`)
 * at `/app/notes/`, and the SW now intercepts every fetch under
 * `/app/notes/` with a precache table built for `/notes/`. Result: HTML
 * served for JS-module requests, MIME errors, broken OAuth callbacks.
 *
 * We unregister any SW whose normalised scope-pathname differs from the
 * runtime mount AND looks like a parachute mount we recognise
 * (`/notes` or `/app/<slug>`). The "looks like ours" guard keeps us
 * from clobbering an unrelated SW that happens to be registered on the
 * same origin.
 *
 * Operators auto-recover on next page load: the stale SW unregisters,
 * the next reload is served fresh, and `shouldRegisterServiceWorker()`
 * declines to re-register at the wrong mount.
 *
 * @returns the number of registrations unregistered (for logging + tests).
 */
export async function cleanupStaleServiceWorker(
  navigatorRef: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
  pathname?: string,
): Promise<number> {
  if (!navigatorRef || !("serviceWorker" in navigatorRef)) return 0;
  const container = navigatorRef.serviceWorker;
  if (!container || typeof container.getRegistrations !== "function") return 0;
  const runtimeMount = detectMountBase(pathname);
  const registrations = await container.getRegistrations();
  let unregistered = 0;
  for (const registration of registrations) {
    try {
      const scopeUrl = new URL(registration.scope);
      const scopePath = scopeUrl.pathname.replace(/\/$/, "") || "/";
      if (scopePath === runtimeMount) continue;
      // Only touch SWs whose scope looks like a parachute mount we
      // recognise — be conservative about clobbering unrelated SWs on
      // the same origin.
      const looksLikeParachuteMount =
        /^\/notes$/.test(scopePath) || /^\/app\/[a-z0-9][a-z0-9_-]*$/.test(scopePath);
      if (!looksLikeParachuteMount) continue;
      await registration.unregister();
      unregistered += 1;
      if (typeof console !== "undefined") {
        console.info(
          `[notes-ui] unregistered stale service worker at scope ${registration.scope} ` +
            `(runtime mount is ${runtimeMount})`,
        );
      }
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn(`[notes-ui] failed to inspect/unregister SW: ${String(err)}`);
      }
    }
  }
  return unregistered;
}
